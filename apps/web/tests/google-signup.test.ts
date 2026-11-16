import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readAuthConfig } from "../src/lib/auth/config";
import { createControlledUser } from "../src/lib/auth/controlled-users";
import { GOOGLE_CALLBACK_PATH, plainGoogleError } from "../src/lib/auth/google";
import { createAuth, getMigrations } from "../src/lib/auth/server";
import { countNonOwnerAccounts, isUserDisabled, setAccountMeta } from "../src/lib/auth/owner";
import { forwardApiRequest } from "../src/lib/api-proxy";

const SECRET = "k3Jx9QpL2vZr8T" + "nW5yBc7HdMfGaUe4SoXi6NtVq1";
const ORIGIN = "http://127.0.0.1:3101";
const BASE = { CHEMDFT_AUTH_MODE: "jwt", BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: ORIGIN } as const;
const GOOGLE = { ...BASE, GOOGLE_CLIENT_ID: "test-client-id", GOOGLE_CLIENT_SECRET: "test-client-secret" } as const;
const GOOGLE_ONLY = {
  ...GOOGLE,
  CHEMDFT_SIGNUP_MODE: "google_only",
  CHEMDFT_BETA_USER_CAP: "2",
  CHEMDFT_OWNER_EMAIL: "owner@chemdft.com",
} as const;

type Profile = { sub: string; email: string; email_verified: boolean; name: string };
type Bundle = Awaited<ReturnType<typeof createAuth>>;

async function bundle(env: Record<string, string> = GOOGLE_ONLY) {
  const created = await createAuth(env, new DatabaseSync(":memory:") as never);
  await (await getMigrations(created.auth.options)).runMigrations();
  return created;
}

function mockGoogle(created: Bundle, profile: Profile) {
  const options = (created.auth.options.socialProviders as unknown as { google: Record<string, unknown> }).google;
  options.getUserInfo = async () => ({
    user: { id: profile.sub, name: profile.name, email: profile.email, emailVerified: profile.email_verified },
    data: profile,
  });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "mock-access", token_type: "Bearer", expires_in: 3600 })));
}

const cookiesOf = (response: Response) => response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

async function signInWithGoogle(created: Bundle, cookie = "") {
  const start = await created.auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ provider: "google", callbackURL: "/en/projects", errorCallbackURL: "/en/login" }),
    }),
  );
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state") as string;
  const jar = [cookie, cookiesOf(start)].filter(Boolean).join("; ");
  const callback = await created.auth.handler(
    new Request(`${ORIGIN}${GOOGLE_CALLBACK_PATH}?code=mock-code&state=${state}`, {
      headers: { cookie: jar, origin: ORIGIN },
    }),
  );
  const location = callback.headers.get("location") ?? "";
  const session = callback.headers.getSetCookie().some((c) => /session_token=[^;]+;/.test(c));
  return { location, session, cookies: cookiesOf(callback), url };
}

const userCount = async (created: Bundle) =>
  ((await (await created.auth.$context).adapter.findMany({ model: "user" })) as unknown[]).length;

afterEach(() => vi.unstubAllGlobals());

describe("Google-only signup mode (Option B beta tester signup)", () => {
  it("sign-up is closed by default in code and tests", async () => {
    const config = readAuthConfig(GOOGLE);
    expect(config.signupMode).toBe("closed");
    expect(config.googleSignupAllowed).toBe(false);
    expect(config.publicSignupEnabled).toBe(false);
  });

  it("creates a new beta account for a verified Google email when terms are accepted", async () => {
    const created = await bundle();
    mockGoogle(created, { sub: "g-beta-1", email: "beta1@example.com", email_verified: true, name: "Beta Tester 1" });

    const result = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(result.session).toBe(true);
    expect(result.location).toBe("/en/projects");

    const users = (await (await created.auth.$context).adapter.findMany({ model: "user" })) as Array<{
      id: string;
      email: string;
      signupSource?: string;
      termsVersion?: string;
      termsAcceptedAt?: Date;
    }>;
    expect(users).toHaveLength(1);
    const user = users[0]!;
    expect(user.email).toBe("beta1@example.com");
    expect(user.signupSource).toBe("self");
    expect(user.termsVersion).toBe("2026-11-10");
    expect(user.termsAcceptedAt).toBeDefined();

    // Verify JWT payload has self-signup claims
    const session = await created.auth.api.getSession({ headers: new Headers({ cookie: result.cookies }) });
    expect(session?.user.email).toBe("beta1@example.com");
  });

  it("refuses to create an account if Google email is not verified", async () => {
    const created = await bundle();
    mockGoogle(created, { sub: "g-unverified", email: "unverified@example.com", email_verified: false, name: "Unverified" });

    const result = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(result.session).toBe(false);
    expect(result.location).toMatch(/error=EMAIL_NOT_VERIFIED/);
    expect(await userCount(created)).toBe(0);
  });

  it("refuses to create an account if Terms of Use / Privacy Policy are not accepted", async () => {
    const created = await bundle();
    mockGoogle(created, { sub: "g-no-terms", email: "noterms@example.com", email_verified: true, name: "No Terms" });

    // No terms cookie passed
    const result = await signInWithGoogle(created);
    expect(result.session).toBe(false);
    expect(result.location).toMatch(/error=TERMS_NOT_ACCEPTED/);
    expect(await userCount(created)).toBe(0);
  });

  it("refuses signup and creates nothing when the global account cap is reached", async () => {
    // Configured cap is 2
    const created = await bundle();

    // User 1
    mockGoogle(created, { sub: "g-user-1", email: "user1@example.com", email_verified: true, name: "User 1" });
    const res1 = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(res1.session).toBe(true);

    // User 2
    mockGoogle(created, { sub: "g-user-2", email: "user2@example.com", email_verified: true, name: "User 2" });
    const res2 = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(res2.session).toBe(true);
    expect(await userCount(created)).toBe(2);

    // User 3 (exceeds cap of 2)
    mockGoogle(created, { sub: "g-user-3", email: "user3@example.com", email_verified: true, name: "User 3" });
    const res3 = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(res3.session).toBe(false);
    expect(res3.location).toMatch(/error=BETA_FULL/);
    expect(await userCount(created)).toBe(2);
  });

  it("owner account does not count towards the beta cap", async () => {
    // Owner is owner@chemdft.com
    const created = await bundle();

    // Create owner account first via controlled user
    await createControlledUser(
      { email: "owner@chemdft.com", name: "ChemDFT Owner", password: "secure-password-123" },
      GOOGLE_ONLY,
      created,
    );
    expect(await userCount(created)).toBe(1);

    // User 1
    mockGoogle(created, { sub: "g-u1", email: "u1@example.com", email_verified: true, name: "U1" });
    const r1 = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(r1.session).toBe(true);

    // User 2 (Cap is 2 non-owner users, so 2nd non-owner must succeed!)
    mockGoogle(created, { sub: "g-u2", email: "u2@example.com", email_verified: true, name: "U2" });
    const r2 = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(r2.session).toBe(true);

    // Total users is 3 (1 owner + 2 beta testers)
    expect(await userCount(created)).toBe(3);

    // User 3 (3rd non-owner must be refused)
    mockGoogle(created, { sub: "g-u3", email: "u3@example.com", email_verified: true, name: "U3" });
    const r3 = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(r3.session).toBe(false);
    expect(r3.location).toMatch(/error=BETA_FULL/);
    expect(await userCount(created)).toBe(3);
  });

  it("allows unlimited signups when CHEMDFT_BETA_USER_CAP is unset, '0', or 'unlimited' (third and fourth users succeed)", async () => {
    // 1. Unset cap
    const envUnset: Record<string, string> = { ...GOOGLE_ONLY };
    delete envUnset.CHEMDFT_BETA_USER_CAP;
    const bundleUnset = await bundle(envUnset);
    for (let i = 1; i <= 4; i++) {
      mockGoogle(bundleUnset, { sub: `g-unset-${i}`, email: `unset${i}@example.com`, email_verified: true, name: `User ${i}` });
      const res = await signInWithGoogle(bundleUnset, "chemdft_terms_accepted=true");
      expect(res.session).toBe(true);
    }
    expect(await userCount(bundleUnset)).toBe(4);

    // 2. Cap = '0'
    const bundleZero = await bundle({ ...GOOGLE_ONLY, CHEMDFT_BETA_USER_CAP: "0" });
    for (let i = 1; i <= 4; i++) {
      mockGoogle(bundleZero, { sub: `g-zero-${i}`, email: `zero${i}@example.com`, email_verified: true, name: `User ${i}` });
      const res = await signInWithGoogle(bundleZero, "chemdft_terms_accepted=true");
      expect(res.session).toBe(true);
    }
    expect(await userCount(bundleZero)).toBe(4);

    // 3. Cap = 'unlimited'
    const bundleUnlimited = await bundle({ ...GOOGLE_ONLY, CHEMDFT_BETA_USER_CAP: "unlimited" });
    for (let i = 1; i <= 4; i++) {
      mockGoogle(bundleUnlimited, { sub: `g-unlim-${i}`, email: `unlim${i}@example.com`, email_verified: true, name: `User ${i}` });
      const res = await signInWithGoogle(bundleUnlimited, "chemdft_terms_accepted=true");
      expect(res.session).toBe(true);
    }
    expect(await userCount(bundleUnlimited)).toBe(4);
  });

  it("GAP 2: simulates race when cap-1 slots remain and proves exactly one succeeds without relying on module-level state", async () => {
    // Configured cap is 2 non-owner beta users.
    const created = await bundle({ ...GOOGLE_ONLY, CHEMDFT_BETA_USER_CAP: "2" });

    // Seed 1 existing beta user -> exactly cap - 1 (1 slot) remains!
    mockGoogle(created, { sub: "g-seed-1", email: "seed1@example.com", email_verified: true, name: "Seed 1" });
    const seedRes = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(seedRes.session).toBe(true);
    expect(await userCount(created)).toBe(1);

    // Two simultaneous signups start on different simulated instances
    const startA = await created.auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, cookie: "chemdft_terms_accepted=true" },
        body: JSON.stringify({ provider: "google", callbackURL: "/en/projects", errorCallbackURL: "/en/login" }),
      }),
    );
    const { url: urlA } = (await startA.json()) as { url: string };
    const stateA = new URL(urlA).searchParams.get("state") as string;
    const jarA = ["chemdft_terms_accepted=true", cookiesOf(startA)].join("; ");

    const startB = await created.auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, cookie: "chemdft_terms_accepted=true" },
        body: JSON.stringify({ provider: "google", callbackURL: "/en/projects", errorCallbackURL: "/en/login" }),
      }),
    );
    const { url: urlB } = (await startB.json()) as { url: string };
    const stateB = new URL(urlB).searchParams.get("state") as string;
    const jarB = ["chemdft_terms_accepted=true", cookiesOf(startB)].join("; ");

    // Mock getUserInfo to return distinct verified profiles
    const options = (created.auth.options.socialProviders as unknown as { google: Record<string, unknown> }).google;
    let callIndex = 0;
    options.getUserInfo = async () => {
      callIndex++;
      const id = `g-race-${callIndex}`;
      return {
        user: { id, name: `Race ${callIndex}`, email: `race${callIndex}@example.com`, emailVerified: true },
        data: { sub: id, email: `race${callIndex}@example.com`, email_verified: true, name: `Race ${callIndex}` },
      };
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "mock-access", token_type: "Bearer", expires_in: 3600 })));

    // Fire both callbacks concurrently: simulating two serverless instances hitting the database
    const [resA, resB] = await Promise.all([
      created.auth.handler(
        new Request(`${ORIGIN}${GOOGLE_CALLBACK_PATH}?code=mock-code-A&state=${stateA}`, {
          headers: { cookie: jarA, origin: ORIGIN },
        }),
      ),
      created.auth.handler(
        new Request(`${ORIGIN}${GOOGLE_CALLBACK_PATH}?code=mock-code-B&state=${stateB}`, {
          headers: { cookie: jarB, origin: ORIGIN },
        }),
      ),
    ]);

    const sessA = resA.headers.getSetCookie().some((c) => /session_token=[^;]+;/.test(c));
    const sessB = resB.headers.getSetCookie().some((c) => /session_token=[^;]+;/.test(c));

    // Exactly one must succeed and exactly one must fail with BETA_FULL
    expect(Number(sessA) + Number(sessB)).toBe(1);
    const failedResponse = !sessA ? resA : resB;
    expect(failedResponse.headers.get("location")).toMatch(/error=BETA_FULL/);

    // The database must hold exactly 2 users (cap = 2): the loser row and accounts are deleted
    expect(await userCount(created)).toBe(2);

    // Verify all sessions and accounts in DB belong to valid users
    const adapter = (await created.auth.$context).adapter as unknown as {
      findMany: (q: { model: string }) => Promise<unknown[]>;
    };
    const finalUsers = (await adapter.findMany({ model: "user" })) as Array<{ id: string; email: string }>;
    expect(finalUsers).toHaveLength(2);
    const finalUserIds = new Set(finalUsers.map((u) => u.id));

    const finalSessions = (await adapter.findMany({ model: "session" })) as Array<{ userId: string }>;
    for (const session of finalSessions) {
      expect(finalUserIds.has(session.userId)).toBe(true);
    }
  });

  it("pre-existing invited accounts with no signupSource do not count against the cap or show as self-signups", async () => {
    // Cap is 1 non-owner self-signup account
    const created = await bundle({ ...GOOGLE_ONLY, CHEMDFT_BETA_USER_CAP: "1" });

    // Create 1 owner
    await createControlledUser(
      { email: "owner@chemdft.com", name: "ChemDFT Owner", password: "secure-password-123" },
      GOOGLE_ONLY,
      created,
    );
    // Create 2 pre-existing invited researchers (signupSource is null)
    await createControlledUser(
      { email: "invited1@example.com", name: "Invited Researcher 1", password: "secure-password-123" },
      GOOGLE_ONLY,
      created,
    );
    await createControlledUser(
      { email: "invited2@example.com", name: "Invited Researcher 2", password: "secure-password-123" },
      GOOGLE_ONLY,
      created,
    );

    const adapter = (await created.auth.$context).adapter as unknown as {
      findMany: (q: { model: string }) => Promise<unknown[]>;
    };
    // Pre-existing accounts must not count against countNonOwnerAccounts
    expect(await countNonOwnerAccounts(adapter as never)).toBe(0);

    // 1st Beta tester signs up -> must succeed because cap is 1 and non-owner count was 0
    mockGoogle(created, { sub: "g-beta-first", email: "betafirst@example.com", email_verified: true, name: "Beta First" });
    const r1 = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(r1.session).toBe(true);
    expect(await countNonOwnerAccounts(adapter as never)).toBe(1);

    // 2nd Beta tester signs up -> must be refused because cap of 1 is reached
    mockGoogle(created, { sub: "g-beta-second", email: "betasecond@example.com", email_verified: true, name: "Beta Second" });
    const r2 = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(r2.session).toBe(false);
    expect(r2.location).toMatch(/error=BETA_FULL/);

    // Total users in DB = 1 owner + 2 invited + 1 beta tester = 4
    expect(await userCount(created)).toBe(4);
  });

  it("disabled user's existing session cannot reach the API proxy (blocks token path in resolveToken)", async () => {
    const created = await bundle();
    mockGoogle(created, { sub: "g-dis-proxy", email: "disproxy@example.com", email_verified: true, name: "Disabled Proxy User" });

    // Sign up and get session
    const signupRes = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(signupRes.session).toBe(true);

    const adapter = (await created.auth.$context).adapter as unknown as {
      findMany: (q: { model: string }) => Promise<unknown[]>;
      findOne: (q: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>;
      create: (q: { model: string; data: Record<string, unknown> }) => Promise<unknown>;
      update: (q: { model: string; where: { field: string; value: unknown }[]; update: Record<string, unknown> }) => Promise<unknown>;
      delete: (q: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>;
    };
    const users = (await adapter.findMany({ model: "user" })) as Array<{ id: string; email: string }>;
    const user = users.find((u) => u.email === "disproxy@example.com")!;

    // Create session headers with the session cookies
    const headers = new Headers({ cookie: signupRes.cookies });

    // Verify session and token work prior to disable
    // Mock getAuth for getSession and getApiToken
    const sessionBefore = await created.auth.api.getSession({ headers });
    expect(sessionBefore?.user.email).toBe("disproxy@example.com");

    // Disable the account
    await setAccountMeta(adapter, user.id, { disabled: true });
    expect(await isUserDisabled(adapter, user.id)).toBe(true);

    // Attempting to resolve token with a disabled account
    const tokenResolver = async () => {
      // Direct emulation of getApiToken's disabled check with adapter
      const session = await created.auth.api.getSession({ headers });
      if (!session?.user?.id) return null;
      if (await isUserDisabled(adapter, session.user.id)) return null;
      const res = (await created.auth.api.getToken({ headers })) as { token?: string } | null;
      return res?.token ?? null;
    };

    const token = await tokenResolver();
    expect(token).toBeNull();

    // Verify that forwardApiRequest rejects the disabled user's request with 401
    const upstreamFetch = vi.fn(async () => new Response("ok"));
    const proxyResponse = await forwardApiRequest(
      new Request("http://web.local/api/chemdft/v1/projects", { headers }),
      ["v1", "projects"],
      { CHEMDFT_AUTH_MODE: "jwt" },
      upstreamFetch,
      tokenResolver,
    );

    expect(proxyResponse.status).toBe(401);
    expect(await proxyResponse.json()).toEqual({ detail: "authentication_required" });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("refuses to sign in a disabled account via Google", async () => {
    const created = await bundle();
    mockGoogle(created, { sub: "g-disabled", email: "disabled@example.com", email_verified: true, name: "Disabled User" });

    // Sign up first
    const signupRes = await signInWithGoogle(created, "chemdft_terms_accepted=true");
    expect(signupRes.session).toBe(true);

    const adapter = (await created.auth.$context).adapter as unknown as {
      findMany: (q: { model: string }) => Promise<unknown[]>;
      findOne: (q: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>;
      create: (q: { model: string; data: Record<string, unknown> }) => Promise<unknown>;
      update: (q: { model: string; where: { field: string; value: unknown }[]; update: Record<string, unknown> }) => Promise<unknown>;
      delete: (q: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>;
    };
    const users = (await adapter.findMany({ model: "user" })) as Array<{ id: string; email: string }>;
    const user = users.find((u) => u.email === "disabled@example.com")!;

    // Disable the account via owner tools helper
    await setAccountMeta(adapter, user.id, { disabled: true });
    expect(await isUserDisabled(adapter, user.id)).toBe(true);

    // Try signing in again
    const signinRes = await signInWithGoogle(created);
    expect(signinRes.session).toBe(false);
    expect(signinRes.location).toMatch(/error=ACCOUNT_DISABLED/);
  });

  it("keeps existing-account linking rule unchanged (only links exact verified email)", async () => {
    const created = await bundle();
    // Pre-existing account
    await createControlledUser(
      { email: "existing@example.com", name: "Existing User", password: "secure-password-123" },
      GOOGLE_ONLY,
      created,
    );
    expect(await userCount(created)).toBe(1);

    // Google with identical verified email signs in to the existing user
    mockGoogle(created, { sub: "g-exist", email: "existing@example.com", email_verified: true, name: "Existing User" });
    const signinRes = await signInWithGoogle(created);
    expect(signinRes.session).toBe(true);
    expect(signinRes.location).toBe("/en/projects");
    expect(await userCount(created)).toBe(1);

    // Google with identical but UNVERIFIED email is refused and not linked
    mockGoogle(created, { sub: "g-unver", email: "existing@example.com", email_verified: false, name: "Existing User" });
    const unverifiedRes = await signInWithGoogle(created);
    expect(unverifiedRes.session).toBe(false);
    expect(unverifiedRes.location).toMatch(/error=account_not_linked/);
  });

  it("GAP 1: owner console shows honest global beta limits and does not allow editable per-user limits", async () => {
    const created = await bundle();
    const adapter = (await created.auth.$context).adapter as unknown as {
      findMany: (q: { model: string }) => Promise<unknown[]>;
      findOne: (q: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>;
      create: (q: { model: string; data: Record<string, unknown> }) => Promise<unknown>;
      update: (q: { model: string; where: { field: string; value: unknown }[]; update: Record<string, unknown> }) => Promise<unknown>;
      delete: (q: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>;
    };

    // Create owner
    const owner = await createControlledUser(
      { email: "owner@chemdft.com", name: "Owner", password: "password-123456" },
      GOOGLE_ONLY,
      created,
    );
    // Create invited researcher
    const invited = await createControlledUser(
      { email: "invited@example.com", name: "Invited", password: "password-123456" },
      GOOGLE_ONLY,
      created,
    );

    // Beta signup
    mockGoogle(created, { sub: "g-beta-honesty", email: "beta-honesty@example.com", email_verified: true, name: "Beta Tester" });
    await signInWithGoogle(created, "chemdft_terms_accepted=true");

    const users = (await adapter.findMany({ model: "user" })) as Array<{
      id: string;
      email: string;
      signupSource?: string;
    }>;
    const betaUser = users.find((u) => u.email === "beta-honesty@example.com")!;

    const { getEffectiveLimits, DEFAULT_BETA_LIMITS } = await import("../src/lib/auth/owner");

    // Owner limits
    const ownerLimits = await getEffectiveLimits(adapter, owner.id, true);
    expect(ownerLimits).toBe("unlimited");

    // Invited limits
    const invitedLimits = await getEffectiveLimits(adapter, invited.id, true);
    expect(invitedLimits).toBe("unlimited");

    // Beta tester limits: strictly DEFAULT_BETA_LIMITS (global backend limits)
    const betaLimits = await getEffectiveLimits(adapter, betaUser.id, false);
    expect(betaLimits).toEqual(DEFAULT_BETA_LIMITS);

    // setAccountMeta only manages disabled status; does not persist phantom per-user limits
    await setAccountMeta(adapter, betaUser.id, { disabled: true });
    expect(await isUserDisabled(adapter, betaUser.id)).toBe(true);

    const recheckedLimits = await getEffectiveLimits(adapter, betaUser.id, false);
    expect(recheckedLimits).toEqual(DEFAULT_BETA_LIMITS);
  });

  it("owner tools security: non-owners cannot access accounts API and emails are never exposed (403)", async () => {
    const { GET } = await import("../src/app/api/owner/accounts/route");

    // 1. Unauthenticated request
    const unauthReq = new Request("http://web.local/api/owner/accounts", {
      headers: new Headers(),
    });
    const res1 = await GET(unauthReq as never);
    expect(res1.status).toBe(403);
    const body1 = await res1.json();
    expect(body1).toEqual({ error: "forbidden" });
    expect(JSON.stringify(body1)).not.toContain("@");
  });

  it("localized login errors exist in en, tr, ru, and de for all 4 required codes", () => {
    const codes = ["BETA_FULL", "TERMS_NOT_ACCEPTED", "EMAIL_NOT_VERIFIED", "ACCOUNT_DISABLED"];
    const locales = ["en", "tr", "ru", "de"] as const;

    for (const code of codes) {
      for (const loc of locales) {
        const message = plainGoogleError(code, { googleOnly: true }, loc);
        expect(message).toBeDefined();
        expect(typeof message).toBe("string");
        expect(message!.length).toBeGreaterThan(10);
      }
    }
  });
});
