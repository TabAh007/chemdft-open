import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { betterAuth, getCurrentAdapter, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { jwt } from "better-auth/plugins";

import { emailFeaturesEnabled, readAuthConfig, selfServiceSignupEnabled, type AuthConfig } from "./config.ts";
import { countNonOwnerAccounts, isOwner, isUserDisabled } from "./owner.ts";
import { SIGNUP_LIMITS, TERMS_VERSION, checkSignupInput, consumeEmailAllowance, hashRef, logSignupEvent } from "./signup-policy.ts";
import { getEmailTransport } from "./email.ts";
import { orcidSignIn } from "./orcid-plugin.ts";
import type { Environment } from "./environment.ts";

/**
 * The Better Auth instance of the trusted Next.js server layer. It owns credentials, sessions and the
 * signing keys; ChemDFT's own `users`/`organizations` tables are NOT mapped onto it. The FastAPI side
 * only ever sees the short-lived JWT minted by the `jwt` plugin and verifies it against `/api/auth/jwks`.
 *
 * Nothing here is exposed to the client bundle; none of its settings are NEXT_PUBLIC_*.
 */
export async function openDatabase(config: AuthConfig) {
  const url = config.databaseUrl;
  if (!url) throw new Error("No authentication database is configured.");
  if (/^postgres(ql)?:\/\//.test(url)) {
    // `pg` is CommonJS: under native Node ESM (the create-user script) its named exports are not
    // visible, so fall back to the default export. Serverless-friendly limits keep a Neon free
    // database (use its pooled connection string, sslmode=require) from running out of connections.
    const pg = (await import("pg")) as unknown as { Pool?: typeof import("pg").Pool; default?: { Pool: typeof import("pg").Pool } };
    const Pool = (pg.Pool ?? pg.default?.Pool) as typeof import("pg").Pool;
    return new Pool({
      connectionString: url,
      max: Number(process.env.CHEMDFT_AUTH_DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  const path = url.replace(/^(file|sqlite):/, "");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  return new DatabaseSync(path);
}

export async function createAuth(
  environment: Environment = process.env,
  databaseOverride?: Awaited<ReturnType<typeof openDatabase>>,
  options: { migrate?: boolean } = {},
) {
  const config = readAuthConfig(environment);
  const database = databaseOverride ?? (await openDatabase(config));
  // Self-service signup needs extra user columns and the rate-limit table. If the switch is on but the
  // authentication database was not migrated, signup stays closed (fail closed) instead of breaking sign-in.
  let selfService = selfServiceSignupEnabled(config);
  if (selfService && !options.migrate) {
    const pending = await getMigrations(buildOptions(config, environment, database, true));
    if (pending.toBeAdded.length > 0 || pending.toBeCreated.length > 0) {
      selfService = false;
      config.publicSignupEnabled = false;
      config.signupBlockedReason = "The authentication database has not been migrated for self-service signup (run the auth migration).";
      console.warn(`[chemdft-auth] ${config.signupBlockedReason}`);
    }
  }
  const authOptions = buildOptions(config, environment, database, selfService);
  // Apply the schema BEFORE initialising Better Auth, so first use does not log a spurious schema-mismatch error.
  if (options.migrate) await (await getMigrations(authOptions)).runMigrations();
  const auth = betterAuth(authOptions);
  return { auth, config };
}

type DatabaseUser = Parameters<NonNullable<NonNullable<NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["user"]>["create"]>["before"]>>[0];
type HookContext = Parameters<NonNullable<NonNullable<NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["user"]>["create"]>["before"]>>[1];
type SessionData = Parameters<NonNullable<NonNullable<NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["session"]>["create"]>["before"]>>[0];

function buildOptions(config: AuthConfig, environment: Environment, database: Awaited<ReturnType<typeof openDatabase>>, selfService: boolean) {
  if (config.authMode !== "jwt") throw new Error("Better Auth is only active when CHEMDFT_AUTH_MODE=jwt.");
  const transport = getEmailTransport(config, environment);
  const google = config.googleEnabled
    ? {
        google: {
          clientId: environment.GOOGLE_CLIENT_ID as string,
          clientSecret: environment.GOOGLE_CLIENT_SECRET as string,
          // Closed signup applies to Google too unless google_only signup is allowed or public signup is open.
          disableSignUp: !config.googleSignupAllowed && !config.publicSignupEnabled,
        },
      }
    : undefined;
  const authOptions = {
    appName: "ChemDFT",
    baseURL: config.baseURL,
    secret: environment.BETTER_AUTH_SECRET as string,
    trustedOrigins: [config.baseURL],
    database,
    ...(selfService || config.googleSignupAllowed
      ? {
          user: {
            additionalFields: {
              // Set by the server only (input:false): the API treats `signup_source: "self"` as a quota-limited researcher.
              signupSource: { type: "string" as const, required: false, input: false },
              termsVersion: { type: "string" as const, required: false, input: false },
              termsAcceptedAt: { type: "date" as const, required: false, input: false },
              // The only field the browser supplies: the acceptance checkbox.
              termsAccepted: { type: "boolean" as const, required: false, input: true },
            },
          },
          ...(selfService
            ? {
                emailVerification: {
                  sendOnSignUp: true,
                  autoSignInAfterVerification: true,
                  expiresIn: 60 * 60,
                  sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
                    if (transport) await transport.send({ to: user.email, kind: "email-verification", subject: "Verify your ChemDFT email address", text: url });
                    logSignupEvent({ event: "verification_sent", outcome: "ACCEPTED", emailRef: hashRef(user.email) });
                  },
                },
              }
            : {}),
        }
      : {}),
    emailAndPassword: {
      enabled: true,
      // Public registration is off unless explicitly `open` in a local environment. This also blocks the
      // server-side signUpEmail API; controlled accounts are created with `createControlledUser`.
      disableSignUp: !config.publicSignupEnabled,
      requireEmailVerification: selfService,
      minPasswordLength: 12,
      ...(transport && emailFeaturesEnabled(config)
        ? {
            sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
              await transport.send({ to: user.email, kind: "password-reset", subject: "Reset your ChemDFT password", text: url });
            },
          }
        : {}),
    },
    ...(google ? { socialProviders: google } : {}),
    // Google may only sign in an account that already exists, and only on a verified address. `trustedProviders` stays
    // empty ON PURPOSE: Better Auth then links a Google sign-in to an existing user only when Google reports
    // email_verified AND the ChemDFT address is verified and identical. Different-email linking and unlinking the last
    // sign-in method are refused. No migration: the `account` table already exists.
    account: { accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: false, allowUnlinkingAll: false } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    advanced: {
      useSecureCookies: config.secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: config.secureCookies },
    },
    // Rate limiting is meaningful only with shared storage; locally it would just slow tests down.
    rateLimit: {
      enabled: !config.local,
      // Serverless instances do not share memory: the counters live in the authentication database.
      ...(selfService ? { storage: "database" as const } : {}),
      customRules: {
        "/sign-up/email": { window: SIGNUP_LIMITS.perIpWindowSeconds, max: SIGNUP_LIMITS.perIpMax },
        "/send-verification-email": { window: SIGNUP_LIMITS.perEmailWindowSeconds, max: 10 },
        "/request-password-reset": { window: SIGNUP_LIMITS.perEmailWindowSeconds, max: 10 },
        "/forget-password": { window: SIGNUP_LIMITS.perEmailWindowSeconds, max: 10 },
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-in/social": { window: 60, max: 15 },
        "/callback/google": { window: 60, max: 15 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user: DatabaseUser, context: HookContext) => {
            // Internal server script (no request context), e.g. createControlledUser
            if (!context?.path) {
              return { data: user };
            }

            const path = String(context.path ?? "");
            const isGoogleCallback =
              (path === "/callback/:id" && context.params?.id === "google") ||
              path.includes("callback/google") ||
              path.endsWith("/callback/google");

            if (isGoogleCallback) {
              // 1. Email verification check (Requirement 2)
              if (!user.emailVerified) {
                logSignupEvent({
                  event: "signup",
                  outcome: "REFUSED",
                  reason: "email_not_verified",
                  emailRef: hashRef(String(user.email ?? "")),
                });
                throw new APIError("BAD_REQUEST", {
                  code: "EMAIL_NOT_VERIFIED",
                  message: "Google has not verified this email address, so it cannot be used to sign up.",
                });
              }

              // 2. Terms acceptance check (Requirement 5)
              const cookieHeader =
                context.headers?.get?.("cookie") ??
                (context.request as Request | undefined)?.headers?.get("cookie") ??
                "";
              const termsAcceptedCookie = /(?:^|;\s*)chemdft_terms_accepted=true/.test(cookieHeader);
              const termsAccepted = Boolean(user.termsAccepted || termsAcceptedCookie);
              if (!termsAccepted) {
                logSignupEvent({
                  event: "signup",
                  outcome: "REFUSED",
                  reason: "terms_not_accepted",
                  emailRef: hashRef(String(user.email ?? "")),
                });
                throw new APIError("BAD_REQUEST", {
                  code: "TERMS_NOT_ACCEPTED",
                  message: "Accept the Terms of Use and Privacy Policy to create an account.",
                });
              }

              // 3. Pre-check: Global account cap check (fails fast before creation)
              const rawAdapter = context.context?.adapter;
              if (rawAdapter && !isOwner(user)) {
                const adapter = await getCurrentAdapter(rawAdapter);
                const nonOwnerCount = await countNonOwnerAccounts(adapter as never);
                if (config.betaUserCap !== null && nonOwnerCount >= config.betaUserCap) {
                  logSignupEvent({
                    event: "signup",
                    outcome: "REFUSED",
                    reason: "beta_full",
                    emailRef: hashRef(String(user.email ?? "")),
                  });
                  throw new APIError("BAD_REQUEST", {
                    code: "BETA_FULL",
                    message: "The ChemDFT beta is currently full. Accounts are limited during this test period.",
                  });
                }
              }

              return {
                data: {
                  ...user,
                  signupSource: "self",
                  termsVersion: TERMS_VERSION,
                  termsAcceptedAt: new Date(),
                },
              };
            }

            if (selfService) {
              return {
                data: {
                  ...user,
                  signupSource: "self",
                  termsVersion: TERMS_VERSION,
                  termsAcceptedAt: new Date(),
                },
              };
            }

            return { data: user };
          },
          after: async (user: DatabaseUser, context: HookContext) => {
            // Post-create verification: cross-instance cap hold using the database itself.
            if (!context?.path) return;
            if (isOwner(user)) return;
            if (user.signupSource !== "self") return;

            const rawAdapter = context.context?.adapter;
            if (!rawAdapter) return;
            const adapter = await getCurrentAdapter(rawAdapter);

            const users = (await adapter.findMany({ model: "user" })) as Array<{
              id: string;
              email: string;
              createdAt?: Date | string | null;
              signupSource?: string | null;
            }>;

            const nonOwnerSelfUsers = users.filter((u) => !isOwner(u) && u.signupSource === "self");

            // Sort non-owner accounts ordered by createdAt then id. Ties are deterministic.
            nonOwnerSelfUsers.sort((a, b) => {
              const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              if (timeA !== timeB) return timeA - timeB;
              return String(a.id).localeCompare(String(b.id));
            });

            const position = nonOwnerSelfUsers.findIndex((u) => u.id === user.id);
            if (config.betaUserCap !== null && position >= config.betaUserCap) {
              // User is beyond the cap: delete user, account, session, verification rows and refuse with BETA_FULL
              await adapter.delete({ model: "session", where: [{ field: "userId", value: user.id }] });
              await adapter.delete({ model: "account", where: [{ field: "userId", value: user.id }] });
              await adapter.delete({ model: "verification", where: [{ field: "identifier", value: `chemdft:meta:${user.id}` }] });
              await adapter.delete({ model: "user", where: [{ field: "id", value: user.id }] });

              logSignupEvent({
                event: "signup",
                outcome: "REFUSED",
                reason: "beta_full",
                emailRef: hashRef(String(user.email ?? "")),
              });

              throw new APIError("BAD_REQUEST", {
                code: "BETA_FULL",
                message: "The ChemDFT beta is currently full. Accounts are limited during this test period.",
              });
            }

            logSignupEvent({
              event: "signup",
              outcome: "ACCEPTED",
              emailRef: hashRef(String(user.email ?? "")),
            });
          },
        },
      },
      session: {
        create: {
          before: async (session: SessionData, context: HookContext) => {
            const rawAdapter = context?.context?.adapter;
            if (rawAdapter && session?.userId) {
              const adapter = await getCurrentAdapter(rawAdapter);
              const disabled = await isUserDisabled(adapter as never, session.userId);
              if (disabled) {
                throw new APIError("FORBIDDEN", {
                  code: "ACCOUNT_DISABLED",
                  message: "This ChemDFT account has been disabled. Contact the owner for assistance.",
                });
              }
            }
            return { data: session };
          },
        },
      },
    },
    ...(selfService
      ? {
          hooks: {
            before: createAuthMiddleware(async (ctx) => {
              const body = (ctx.body ?? {}) as { email?: string; termsAccepted?: unknown };
              const email = typeof body.email === "string" ? body.email : "";
              const guarded = ["/sign-up/email", "/send-verification-email", "/request-password-reset", "/forget-password"];
              if (!guarded.includes(ctx.path) || !email) return;
              const event = ctx.path === "/sign-up/email" ? "signup" : ctx.path === "/send-verification-email" ? "verification_sent" : "reset_requested";
              if (ctx.path === "/sign-up/email") {
                const refusal = checkSignupInput({ email, termsAccepted: body.termsAccepted });
                if (refusal) {
                  logSignupEvent({ event, outcome: "REFUSED", reason: refusal, emailRef: hashRef(email) });
                  const message = refusal === "terms_not_accepted" ? "Accept the Terms of Use and Privacy Policy to create an account." : refusal === "disposable_email" ? "Please use a permanent email address; disposable addresses are not accepted." : "Enter a valid email address.";
                  throw new APIError("BAD_REQUEST", { message, code: refusal.toUpperCase() });
                }
              }
              const allowed = await consumeEmailAllowance((await ctx.context).adapter as never, email);
              if (!allowed) {
                logSignupEvent({ event, outcome: "REFUSED", reason: "rate_limited_email", emailRef: hashRef(email) });
                throw new APIError("TOO_MANY_REQUESTS", { message: "Too many messages for this address. Try again in an hour.", code: "RATE_LIMITED_EMAIL" });
              }
              logSignupEvent({ event, outcome: "ACCEPTED", emailRef: hashRef(email) });
            }),
          },
        }
      : {}),
    plugins: [
      ...(config.orcidEnabled ? [orcidSignIn(config, environment)] : []),
      jwt({
        jwt: {
          issuer: config.issuer,
          audience: config.audience,
          expirationTime: config.tokenLifetime,
          // The API needs only a stable subject and the profile fields it provisions a user from.
          definePayload: ({ user }) => {
            const extra = user as unknown as Record<string, unknown>;
            return {
              email: user.email,
              name: user.name,
              email_verified: user.emailVerified,
              // Present only for self-service accounts (set by the server at creation, never by the browser).
              ...(extra.signupSource === "self"
                ? {
                    signup_source: "self",
                    terms_version: extra.termsVersion ?? null,
                    terms_accepted_at: extra.termsAcceptedAt instanceof Date ? extra.termsAcceptedAt.toISOString() : (extra.termsAcceptedAt ?? null),
                  }
                : {}),
            };
          },
        },
      }),
    ],
  } satisfies BetterAuthOptions;
  return authOptions;
}

/**
 * The additive schema change self-service signup needs (new nullable `user` columns, the `rateLimit` table), computed
 * for the CURRENT database. `apply:false` only returns the SQL; `apply:true` runs it. Used by `pnpm auth:migrate`.
 */
export async function authMigrationPlan(environment: Environment, apply: boolean) {
  const config = readAuthConfig(environment);
  const database = await openDatabase(config);
  const migrations = await getMigrations(buildOptions(config, environment, database, true));
  const sql = await migrations.compileMigrations();
  if (apply && (migrations.toBeAdded.length > 0 || migrations.toBeCreated.length > 0)) await migrations.runMigrations();
  return { sql, tables: migrations.toBeCreated.map((t) => t.table), columns: migrations.toBeAdded.map((t) => `${t.table}.${Object.keys(t.fields).join(",")}`) };
}

type AuthBundle = Awaited<ReturnType<typeof createAuth>>;
const globalForAuth = globalThis as unknown as { __chemdftAuth?: AuthBundle; __chemdftAuthReady?: Promise<void> };

/** The process-wide instance. In a local/test environment the Better Auth schema is applied on first use. */
export async function getAuth(): Promise<AuthBundle> {
  if (!globalForAuth.__chemdftAuthReady) {
    // In a local/test environment the Better Auth schema is applied on first use; hosted deployments
    // migrate explicitly (their database is persistent and managed outside the request path).
    globalForAuth.__chemdftAuthReady = createAuth(process.env, undefined, { migrate: readAuthConfig(process.env).local }).then((bundle) => {
      globalForAuth.__chemdftAuth = bundle;
    });
  }
  await globalForAuth.__chemdftAuthReady;
  return globalForAuth.__chemdftAuth as AuthBundle;
}

export { getMigrations };
