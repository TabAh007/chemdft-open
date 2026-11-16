import { createPublicKey, verify } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { AuthConfigError, readAuthConfig } from "../src/lib/auth/config";
import { createControlledUser, ControlledUserError } from "../src/lib/auth/controlled-users";
import { devOutbox, getEmailTransport } from "../src/lib/auth/email";
import { isHostedEnvironment, isLocalEnvironment } from "../src/lib/auth/environment";
import { safeRedirectPath } from "../src/lib/auth/safe-redirect";
import { createAuth, getMigrations } from "../src/lib/auth/server";

const SECRET = "k3Jx9QpL2vZr8T" + "nW5yBc7HdMfGaUe4SoXi6NtVq1";
const LOCAL = { CHEMDFT_AUTH_MODE: "jwt", BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: "http://127.0.0.1:3101" } as const;
const HOSTED = { ...LOCAL, VERCEL: "1", CHEMDFT_ENV: "preview", BETTER_AUTH_URL: "https://chemdft-preview.vercel.app", CHEMDFT_AUTH_DATABASE_URL: "postgres://user@host/db" } as const;

async function bundle(environment: Record<string, string>) {
  const { auth, config } = await createAuth(environment, new DatabaseSync(":memory:") as never);
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  return { auth, config };
}

const post = (auth: { handler: (request: Request) => Promise<Response> }, path: string, body: unknown, origin = "http://127.0.0.1:3101") =>
  auth.handler(new Request(`${origin}/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }));

describe("auth configuration", () => {
  it("defaults to dev mode, closed signup and no Google, and only in a local environment", () => {
    const config = readAuthConfig({});
    expect(config).toMatchObject({ authMode: "dev", signupMode: "closed", publicSignupEnabled: false, googleEnabled: false, emailProvider: "none", local: true });
    expect(() => readAuthConfig({ VERCEL: "1" })).toThrow(AuthConfigError); // dev identity never runs hosted
    expect(() => readAuthConfig({ CHEMDFT_ENV: "production" })).toThrow(AuthConfigError);
  });

  it("rejects unknown modes and weak or missing secrets", () => {
    expect(() => readAuthConfig({ CHEMDFT_AUTH_MODE: "oauth" })).toThrow(/dev or jwt/);
    expect(() => readAuthConfig({ CHEMDFT_SIGNUP_MODE: "everyone" })).toThrow(/closed, invite or open/);
    for (const secret of [undefined, "", "short", "x".repeat(40), "a".repeat(64), "changemechangemechangemechangeme12"]) {
      expect(() => readAuthConfig({ ...LOCAL, BETTER_AUTH_SECRET: secret })).toThrow(/BETTER_AUTH_SECRET/);
    }
    expect(() => readAuthConfig(LOCAL)).not.toThrow();
  });

  it("gates public signup by launch state (prelaunch by default), never by host", () => {
    const LAUNCH = { ...LOCAL, CHEMDFT_EMAIL_PROVIDER: "dev" } as const; // local env with the dev email sink
    // default state is prelaunch; closed and invite never allow public signup
    expect(readAuthConfig(LOCAL).launchState).toBe("prelaunch");
    for (const signup of ["closed", "invite"]) {
      for (const state of ["prelaunch", "public"]) {
        const config = readAuthConfig({ ...LOCAL, CHEMDFT_SIGNUP_MODE: signup, CHEMDFT_LAUNCH_STATE: state });
        expect(config.publicSignupEnabled, `${state}+${signup}`).toBe(false);
      }
    }
    // prelaunch + open is refused everywhere (local and hosted)
    expect(() => readAuthConfig({ ...LAUNCH, CHEMDFT_SIGNUP_MODE: "open" })).toThrow(/prelaunch/);
    expect(() => readAuthConfig({ ...HOSTED, CHEMDFT_SIGNUP_MODE: "open" })).toThrow(/prelaunch/);
    expect(() => readAuthConfig({ ...HOSTED, CHEMDFT_SIGNUP_MODE: "open", CHEMDFT_LAUNCH_STATE: "prelaunch" })).toThrow(/prelaunch/);
    // public + open is architecturally allowed, but needs working verification email
    expect(readAuthConfig({ ...LAUNCH, CHEMDFT_SIGNUP_MODE: "open", CHEMDFT_LAUNCH_STATE: "public" })).toMatchObject({ publicSignupEnabled: true, launchState: "public" });
    expect(() => readAuthConfig({ ...LOCAL, CHEMDFT_SIGNUP_MODE: "open", CHEMDFT_LAUNCH_STATE: "public" })).toThrow(/email provider/);
    expect(() => readAuthConfig({ ...HOSTED, CHEMDFT_SIGNUP_MODE: "open", CHEMDFT_LAUNCH_STATE: "public" })).toThrow(/email provider/);
    expect(() => readAuthConfig({ ...HOSTED, CHEMDFT_SIGNUP_MODE: "open", CHEMDFT_LAUNCH_STATE: "public", CHEMDFT_EMAIL_PROVIDER: "dev" })).toThrow(/production email provider|development email sink/);
    expect(() => readAuthConfig({ ...LOCAL, CHEMDFT_LAUNCH_STATE: "soon" })).toThrow(/prelaunch or public/);
    // the hosted dev identity is refused whatever the launch state
    for (const state of ["prelaunch", "public"]) {
      expect(() => readAuthConfig({ VERCEL: "1", CHEMDFT_LAUNCH_STATE: state })).toThrow(/only operates locally/);
    }
  });

  it("requires https, a database and a hosted-safe email setup outside local", () => {
    expect(readAuthConfig(HOSTED)).toMatchObject({ secureCookies: true, local: false, authMode: "jwt" });
    expect(() => readAuthConfig({ ...HOSTED, BETTER_AUTH_URL: "http://example.test" })).toThrow(/https/);
    expect(() => readAuthConfig({ ...HOSTED, CHEMDFT_AUTH_DATABASE_URL: undefined } as never)).toThrow(/CHEMDFT_AUTH_DATABASE_URL/);
    // a hosted deployment may only use an explicitly configured persistent PostgreSQL database
    for (const url of ["file:./auth.db", "file:/tmp/auth.db", "sqlite:auth.db", ":memory:", "file::memory:", "./auth.db", "/tmp/auth.db", "mysql://u@h/d", "postgres://", ""]) {
      expect(() => readAuthConfig({ ...HOSTED, CHEMDFT_AUTH_DATABASE_URL: url }), url).toThrow(/CHEMDFT_AUTH_DATABASE_URL/);
    }
    for (const url of ["postgres://user:pw@db.internal:5432/chemdft", "postgresql://user@host/db?sslmode=require"]) {
      expect(() => readAuthConfig({ ...HOSTED, CHEMDFT_AUTH_DATABASE_URL: url })).not.toThrow();
    }
    // locally the lightweight SQLite default is fine
    expect(readAuthConfig(LOCAL).databaseUrl).toBe("file:./.chemdft/auth.db");
    expect(() => readAuthConfig({ ...HOSTED, CHEMDFT_EMAIL_PROVIDER: "dev" })).toThrow(/development email sink/);
    expect(() => readAuthConfig({ ...LOCAL, CHEMDFT_EMAIL_PROVIDER: "resend" })).toThrow(/none or dev/);
  });

  it("enables Google only when both credentials are configured", () => {
    expect(readAuthConfig(LOCAL).googleEnabled).toBe(false);
    expect(readAuthConfig({ ...LOCAL, GOOGLE_CLIENT_ID: "id" }).googleEnabled).toBe(false);
    expect(readAuthConfig({ ...LOCAL, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }).googleEnabled).toBe(true);
  });

  it("treats hosted markers and non-local CHEMDFT_ENV as non-local", () => {
    expect(isLocalEnvironment({})).toBe(true);
    for (const marker of ["VERCEL", "VERCEL_ENV", "K_SERVICE", "FLY_APP_NAME"]) expect(isHostedEnvironment({ [marker]: "1" })).toBe(true);
    expect(isLocalEnvironment({ CHEMDFT_ENV: "staging" })).toBe(false);
  });
});

describe("redirect safety", () => {
  it.each([
    "https://evil.test/en/projects", "//evil.test/en/projects", "/\\evil.test", "javascript:alert(1)", "/en/projects\r\nSet-Cookie: a=b",
    "/%2F%2Fevil.test", "/xx/projects", "evil", "", "/en/login?next=/en/login", "/en/../../etc/passwd",
  ])("falls back to the project list for %j", (candidate) => {
    expect(safeRedirectPath(candidate, "en")).toBe("/en/projects");
  });
  it("keeps same-origin application paths with their query", () => {
    expect(safeRedirectPath("/en/projects/abc/workspace?x=1", "en")).toBe("/en/projects/abc/workspace?x=1");
    expect(safeRedirectPath(null, "de")).toBe("/de/projects");
  });
});

describe("Better Auth foundation (real instance, in-memory database)", () => {
  it("rejects public signup over HTTP and through the server API, for email and for Google", async () => {
    const { auth } = await bundle({ ...LOCAL });
    const response = await post(auth, "/sign-up/email", { email: "x@example.test", password: "correct horse battery", name: "X" });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
    await expect(auth.api.signUpEmail({ body: { email: "y@example.test", password: "correct horse battery", name: "Y" } })).rejects.toThrow();
    const google = await createAuth({ ...LOCAL, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }, new DatabaseSync(":memory:") as never);
    expect((google.auth.options.socialProviders as { google: { disableSignUp: boolean } }).google.disableSignUp).toBe(true);
    const none = await createAuth({ ...LOCAL }, new DatabaseSync(":memory:") as never);
    expect(none.auth.options.socialProviders).toBeUndefined();
  });

  it("creates controlled users only locally, signs them in with HttpOnly SameSite cookies, and mints a 15-minute EdDSA token the API can verify", async () => {
    const created = await bundle({ ...LOCAL });
    const { auth } = created;
    expect(await createControlledUser({ email: "Alice@Example.test", name: "Alice", password: "correct horse battery" }, LOCAL, created)).toMatchObject({ email: "alice@example.test" });
    await expect(createControlledUser({ email: "alice@example.test", name: "A", password: "correct horse battery" }, LOCAL, created)).rejects.toThrow(/already exists/);
    await expect(createControlledUser({ email: "z@example.test", name: "Z", password: "short" }, LOCAL, created)).rejects.toThrow(ControlledUserError);
    await expect(createControlledUser({ email: "h@example.test", name: "H", password: "correct horse battery" }, HOSTED, created)).rejects.toThrow(/explicitly local/);

    const bad = await post(auth, "/sign-in/email", { email: "alice@example.test", password: "wrong password here" });
    expect(bad.status).toBe(401);
    const response = await post(auth, "/sign-in/email", { email: "alice@example.test", password: "correct horse battery" });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^better-auth\.session_token=/);
    expect(cookies[0]).toMatch(/HttpOnly/i);
    expect(cookies[0]).toMatch(/SameSite=Lax/i);
    expect(cookies[0]).not.toMatch(/;\s*Secure/i); // plain http on loopback only
    expect(await response.text()).not.toContain("eyJ"); // the body carries no bearer token

    const headers = new Headers({ cookie: cookies.map((c) => c.split(";")[0]).join("; ") });
    const session = await auth.api.getSession({ headers });
    expect(session?.user.email).toBe("alice@example.test");
    const { token } = (await auth.api.getToken({ headers })) as { token: string };
    const [h, p, s] = token.split(".");
    const header = JSON.parse(Buffer.from(h!, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(header.alg).toBe("EdDSA");
    expect(payload).toMatchObject({ iss: "http://127.0.0.1:3101", aud: "chemdft-api", sub: session!.user.id, email: "alice@example.test", name: "Alice" });
    expect(payload.exp - payload.iat).toBe(900);
    expect(Object.keys(payload).sort()).toEqual(["aud", "email", "email_verified", "exp", "iat", "iss", "name", "sub"]);
    const jwks = (await auth.api.getJwks()) as { keys: Array<Record<string, string>> };
    const key = createPublicKey({ key: jwks.keys.find((k) => k.kid === header.kid)!, format: "jwk" });
    expect(verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s!, "base64url"))).toBe(true);
    expect(JSON.stringify(jwks)).not.toMatch(/"d"\s*:/); // public keys only

    await expect(auth.api.getToken({ headers: new Headers() })).rejects.toThrow();
  });

  it("marks session cookies Secure with the __Secure- prefix when hosted", async () => {
    const { auth, config } = await bundle({ ...HOSTED });
    expect(config.secureCookies).toBe(true);
    expect(auth.options.advanced?.useSecureCookies).toBe(true);
    const context = await auth.$context;
    expect(context.authCookies.sessionToken.name).toBe("__Secure-better-auth.session_token");
    expect(context.authCookies.sessionToken.attributes).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true });
  });

  it("has no email transport (and so no reset/verification mail) unless the dev sink is enabled locally", async () => {
    expect(getEmailTransport(readAuthConfig(LOCAL), LOCAL)).toBeNull();
    const dev = { ...LOCAL, CHEMDFT_EMAIL_PROVIDER: "dev" };
    const transport = getEmailTransport(readAuthConfig(dev), dev);
    expect(transport).not.toBeNull();
    await transport!.send({ to: "a@example.test", kind: "password-reset", subject: "s", text: "https://link?token=secret" });
    expect(devOutbox).toHaveLength(1);
    const { auth } = await bundle({ ...LOCAL });
    expect((auth.options.emailAndPassword as { sendResetPassword?: unknown }).sendResetPassword).toBeUndefined();
  });
});

describe("secrets never reach the browser", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
  const sources = walk(join(__dirname, "..", "src")).map((path) => [path, readFileSync(path, "utf8")] as const);

  it("has no NEXT_PUBLIC variable for auth secrets, tokens or keys", () => {
    for (const [path, text] of sources) {
      // Exclude public integration site keys (e.g. Cloudflare Turnstile public site key)
      const sanitized = text.replaceAll("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
      expect(sanitized, path).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SECRET|TOKEN|KEY|JWT|AUTH_URL)/);
    }
  });
  it("never stores tokens in localStorage or sessionStorage", () => {
    for (const [path, text] of sources.filter(([p]) => p.includes("/lib/auth/") || p.includes("/login/") || p.includes("/account/"))) {
      expect(text, path).not.toMatch(/(local|session)Storage/);
    }
  });
  it("keeps server-only auth modules out of client components", () => {
    for (const [path, text] of sources) {
      if (!/^\s*["']use client["']/.test(text)) continue;
      expect(text, path).not.toMatch(/lib\/auth\/(server|session|controlled-users|config)"/);
    }
  });
});
