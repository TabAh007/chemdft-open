import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readAuthConfig } from "../src/lib/auth/config";
import { createControlledUser } from "../src/lib/auth/controlled-users";
import { GOOGLE_CALLBACK_PATH, plainGoogleError, plainGoogleSettingsError } from "../src/lib/auth/google";
import { createAuth, getMigrations } from "../src/lib/auth/server";

// Everything here is a mock: no request ever reaches Google. This is evidence about ChemDFT's rules around Better Auth, not about Google.
const SECRET = "k3Jx9QpL2vZr8T" + "nW5yBc7HdMfGaUe4SoXi6NtVq1";
const ORIGIN = "http://127.0.0.1:3101";
const BASE = { CHEMDFT_AUTH_MODE: "jwt", BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: ORIGIN } as const;
const GOOGLE = { ...BASE, GOOGLE_CLIENT_ID: "test-client-id", GOOGLE_CLIENT_SECRET: "test-client-secret" } as const;

type Profile = { sub: string; email: string; email_verified: boolean; name: string };
type Bundle = Awaited<ReturnType<typeof createAuth>>;

async function bundle(env: Record<string, string> = GOOGLE) {
  const created = await createAuth(env, new DatabaseSync(":memory:") as never);
  await (await getMigrations(created.auth.options)).runMigrations();
  return created;
}

/** Make the Google provider return `profile` instead of calling Google. */
function mockGoogle(created: Bundle, profile: Profile) {
  const options = (created.auth.options.socialProviders as unknown as { google: Record<string, unknown> }).google;
  options.getUserInfo = async () => ({ user: { id: profile.sub, name: profile.name, email: profile.email, emailVerified: profile.email_verified }, data: profile });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "mock-access", token_type: "Bearer", expires_in: 3600 })));
}

const cookiesOf = (response: Response) => response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

/** Drive the real authorize -> callback round trip against the mocked provider. Returns where the browser lands and any session cookie. */
async function signInWithGoogle(created: Bundle, cookie = "") {
  const start = await created.auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/social`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ provider: "google", callbackURL: "/en/projects", errorCallbackURL: "/en/login" }) }));
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state") as string;
  const jar = [cookie, cookiesOf(start)].filter(Boolean).join("; ");
  const callback = await created.auth.handler(new Request(`${ORIGIN}${GOOGLE_CALLBACK_PATH}?code=mock-code&state=${state}`, { headers: { cookie: jar, origin: ORIGIN } }));
  const location = callback.headers.get("location") ?? "";
  const session = callback.headers.getSetCookie().some((c) => /session_token=[^;]+;/.test(c));
  return { location, session, cookies: cookiesOf(callback), url };
}

const userCount = async (created: Bundle) => ((await (await created.auth.$context).adapter.findMany({ model: "user" })) as unknown[]).length;
afterEach(() => vi.unstubAllGlobals());

describe("Google sign-in: configured and not configured", () => {
  it("is off unless both the client id and the secret are set, and then registers no provider at all", async () => {
    expect(readAuthConfig({ ...BASE, GOOGLE_CLIENT_ID: "id" }).googleEnabled).toBe(false);
    expect(readAuthConfig({ ...BASE, GOOGLE_CLIENT_SECRET: "secret" }).googleEnabled).toBe(false);
    expect((await bundle(BASE)).auth.options.socialProviders).toBeUndefined();
    expect(readAuthConfig(GOOGLE).googleEnabled).toBe(true);
    expect((await bundle()).auth.options.socialProviders).toHaveProperty("google");
  });

  it("serves the callback at /api/auth/callback/google and asks only for openid, email and profile", async () => {
    expect(GOOGLE_CALLBACK_PATH).toBe("/api/auth/callback/google");
    const created = await bundle();
    mockGoogle(created, { sub: "g1", email: "a@example.test", email_verified: true, name: "A" });
    const { url } = await signInWithGoogle(created);
    const authorize = new URL(url);
    expect(authorize.origin + authorize.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${ORIGIN}${GOOGLE_CALLBACK_PATH}`);
    expect(authorize.searchParams.get("scope")?.split(" ").sort()).toEqual(["email", "openid", "profile"]);
  });
});

describe("Google sign-in with signup closed", () => {
  it("signs in an existing account whose verified email matches, and creates nothing", async () => {
    const created = await bundle();
    const user = await createControlledUser({ email: "owner@example.test", name: "Owner", password: "correct horse battery" }, GOOGLE, created);
    mockGoogle(created, { sub: "g-owner", email: "Owner@Example.test", email_verified: true, name: "Owner" });
    const result = await signInWithGoogle(created);
    expect(result.location).toBe("/en/projects");
    expect(result.session).toBe(true);
    const session = await created.auth.api.getSession({ headers: new Headers({ cookie: result.cookies }) });
    expect(session?.user.id).toBe(user.id);
    expect(await userCount(created)).toBe(1);
  });

  it("refuses an address with no ChemDFT account and creates no user, session or account", async () => {
    const created = await bundle();
    await createControlledUser({ email: "owner@example.test", name: "Owner", password: "correct horse battery" }, GOOGLE, created);
    mockGoogle(created, { sub: "g-stranger", email: "stranger@example.test", email_verified: true, name: "Stranger" });
    const result = await signInWithGoogle(created);
    expect(result.session).toBe(false);
    expect(result.location).toMatch(/\/en\/login\?error=signup_disabled/);
    expect(await userCount(created)).toBe(1);
    expect(((await (await created.auth.$context).adapter.findMany({ model: "account" })) as { providerId: string }[]).filter((a) => a.providerId === "google")).toHaveLength(0);
  });

  it("refuses a matching address that Google reports as NOT verified, and does not link it", async () => {
    const created = await bundle();
    await createControlledUser({ email: "owner@example.test", name: "Owner", password: "correct horse battery" }, GOOGLE, created);
    mockGoogle(created, { sub: "g-evil", email: "owner@example.test", email_verified: false, name: "Impostor" });
    const result = await signInWithGoogle(created);
    expect(result.session).toBe(false);
    expect(result.location).toMatch(/error=account_not_linked/);
    expect(((await (await created.auth.$context).adapter.findMany({ model: "account" })) as { providerId: string }[]).some((a) => a.providerId === "google")).toBe(false);
  });

  it("refuses a Google sign-in when the ChemDFT account's own address is not verified", async () => {
    const created = await bundle();
    const context = await created.auth.$context;
    await context.internalAdapter.createUser({ email: "unverified@example.test", name: "U", emailVerified: false } as never, undefined as never);
    mockGoogle(created, { sub: "g-u", email: "unverified@example.test", email_verified: true, name: "U" });
    expect((await signInWithGoogle(created)).session).toBe(false);
  });

  it("keeps working for an account that was linked, and never signs in a different Google subject for it", async () => {
    const created = await bundle();
    await createControlledUser({ email: "owner@example.test", name: "Owner", password: "correct horse battery" }, GOOGLE, created);
    mockGoogle(created, { sub: "g-owner", email: "owner@example.test", email_verified: true, name: "Owner" });
    expect((await signInWithGoogle(created)).session).toBe(true);
    mockGoogle(created, { sub: "g-owner", email: "owner@example.test", email_verified: true, name: "Owner" });
    expect((await signInWithGoogle(created)).session).toBe(true);
    expect(await userCount(created)).toBe(1);
  });
});

describe("Link and unlink Google while signed in", () => {
  async function signedIn(created: Bundle, email: string) {
    await createControlledUser({ email, name: "Person", password: "correct horse battery" }, GOOGLE, created);
    const response = await created.auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email, password: "correct horse battery" }) }));
    expect(response.status).toBe(200);
    return cookiesOf(response);
  }
  const accounts = async (created: Bundle, cookie: string) => (await created.auth.api.listUserAccounts({ headers: new Headers({ cookie }) })) as { id: string; providerId: string }[];

  it("links Google (same verified email), then unlinks it, keeping the password sign-in", async () => {
    const created = await bundle();
    const cookie = await signedIn(created, "linker@example.test");
    mockGoogle(created, { sub: "g-linker", email: "linker@example.test", email_verified: true, name: "Person" });
    const start = await created.auth.handler(new Request(`${ORIGIN}/api/auth/link-social`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie }, body: JSON.stringify({ provider: "google", callbackURL: "/en/settings/general?google=linked" }) }));
    const { url } = (await start.json()) as { url: string };
    const jar = [cookie, cookiesOf(start)].join("; ");
    const callback = await created.auth.handler(new Request(`${ORIGIN}${GOOGLE_CALLBACK_PATH}?code=mock&state=${new URL(url).searchParams.get("state")}`, { headers: { cookie: jar, origin: ORIGIN } }));
    expect(callback.headers.get("location")).toBe("/en/settings/general?google=linked");
    const linked = await accounts(created, cookie);
    expect(linked.map((a) => a.providerId).sort()).toEqual(["credential", "google"]);
    const google = linked.find((a) => a.providerId === "google") as { id: string };
    const unlink = await created.auth.api.unlinkAccount({ headers: new Headers({ cookie }), body: { accountId: google.id } });
    expect(unlink.status).toBe(true);
    expect((await accounts(created, cookie)).map((a) => a.providerId)).toEqual(["credential"]);
  });

  it("refuses to link a Google account with a different email address", async () => {
    const created = await bundle();
    const cookie = await signedIn(created, "linker@example.test");
    mockGoogle(created, { sub: "g-other", email: "someone-else@example.test", email_verified: true, name: "Other" });
    const start = await created.auth.handler(new Request(`${ORIGIN}/api/auth/link-social`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie }, body: JSON.stringify({ provider: "google", callbackURL: "/en/settings/general" }) }));
    const { url } = (await start.json()) as { url: string };
    const callback = await created.auth.handler(new Request(`${ORIGIN}${GOOGLE_CALLBACK_PATH}?code=mock&state=${new URL(url).searchParams.get("state")}`, { headers: { cookie: [cookie, cookiesOf(start)].join("; "), origin: ORIGIN } }));
    expect(callback.headers.get("location")).toMatch(/error=email_does_not_match/);
    expect((await accounts(created, cookie)).map((a) => a.providerId)).toEqual(["credential"]);
  });

  it("refuses to unlink the last sign-in method", async () => {
    const created = await bundle();
    const cookie = await signedIn(created, "solo@example.test");
    const only = (await accounts(created, cookie))[0] as { id: string };
    await expect(created.auth.api.unlinkAccount({ headers: new Headers({ cookie }), body: { accountId: only.id } })).rejects.toMatchObject({ body: { code: "FAILED_TO_UNLINK_LAST_ACCOUNT" } });
    expect(await accounts(created, cookie)).toHaveLength(1);
  });
});

describe("Google error wording", () => {
  it("names the real signup mode and never shows a raw code", () => {
    expect(plainGoogleError("signup_disabled")).toMatch(/No ChemDFT account uses this Google address\. Sign-up is closed: ask the owner for access/);
    expect(plainGoogleError("account_not_linked", { selfService: true })).toMatch(/Create an account with your email and password first/);
    expect(plainGoogleError("access_denied")).toBe("Google sign-in was cancelled. Nothing was changed.");
    expect(plainGoogleError("email_not_verified")).toMatch(/has not verified/);
    for (const code of ["server_error", "invalid_code", "unable_to_get_user_info", "state_not_found"]) {
      const text = plainGoogleError(code) as string;
      expect(text).toMatch(/did not complete/);
      expect(text).not.toContain(code);
    }
    expect(plainGoogleError(null)).toBeNull();
    expect(plainGoogleError("configuration")).toBeNull();
    expect(plainGoogleSettingsError("FAILED_TO_UNLINK_LAST_ACCOUNT")).not.toContain("FAILED_TO_UNLINK");
  });
});
