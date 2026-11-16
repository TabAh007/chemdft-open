import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { readAuthConfig, selfServiceSignupEnabled } from "../src/lib/auth/config";
import { isDisposableEmailDomain } from "../src/lib/auth/disposable-domains";
import { devOutbox } from "../src/lib/auth/email";
import { createAuth, getMigrations } from "../src/lib/auth/server";
import { SIGNUP_LIMITS, TERMS_VERSION, checkSignupInput, consumeEmailAllowance, hashRef, logSignupEvent } from "../src/lib/auth/signup-policy";
import { LEGAL_VERSION, SUPPORT_EMAIL } from "../src/content/legal";

const SECRET = "k3Jx9QpL2vZr8T" + "nW5yBc7HdMfGaUe4SoXi6NtVq1";
const LOCAL = { CHEMDFT_AUTH_MODE: "jwt", BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: "http://127.0.0.1:3102" } as const;
const OPEN = { ...LOCAL, CHEMDFT_EMAIL_PROVIDER: "dev", CHEMDFT_SIGNUP_OPEN: "true" } as const;
const HOSTED = { ...LOCAL, VERCEL: "1", CHEMDFT_ENV: "preview", BETTER_AUTH_URL: "https://chemdft-preview.vercel.app", CHEMDFT_AUTH_DATABASE_URL: "postgres://user@host/db" } as const;

const post = (auth: { handler: (request: Request) => Promise<Response> }, path: string, body: unknown) =>
  auth.handler(new Request(`http://127.0.0.1:3102/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:3102" }, body: JSON.stringify(body) }));

async function open(environment: Record<string, string>) {
  const bundle = await createAuth(environment, new DatabaseSync(":memory:") as never, { migrate: true });
  return bundle;
}

describe("self-service signup switch (ADR-045)", () => {
  it("is off by default and the switch alone never opens signup on a hosted deployment", () => {
    expect(selfServiceSignupEnabled(readAuthConfig(LOCAL))).toBe(false);
    for (const provider of ["none", "ses"]) {
      const config = readAuthConfig({ ...HOSTED, CHEMDFT_SIGNUP_OPEN: "true", CHEMDFT_EMAIL_PROVIDER: provider });
      expect(selfServiceSignupEnabled(config), provider).toBe(false);
      expect(config.signupBlockedReason).toBeTruthy();
    }
    expect(() => readAuthConfig({ ...HOSTED, CHEMDFT_EMAIL_PROVIDER: "dev" })).toThrow(/development email sink/);
  });

  it("opens only locally with the dev email sink", () => {
    expect(selfServiceSignupEnabled(readAuthConfig(OPEN))).toBe(true);
  });

  it("the legal version matches the signup policy version and the support contact is set", () => {
    expect(LEGAL_VERSION).toBe(TERMS_VERSION);
    expect(SUPPORT_EMAIL).toBe("tab@chemdft.com");
  });
});

describe("signup policy helpers", () => {
  it("blocks disposable domains (and their subdomains), invalid addresses, and missing terms", () => {
    expect(isDisposableEmailDomain("mailinator.com")).toBe(true);
    expect(isDisposableEmailDomain("x.Mailinator.com")).toBe(true);
    expect(isDisposableEmailDomain("university.edu")).toBe(false);
    expect(isDisposableEmailDomain("custom.test", "custom.test")).toBe(true);
    expect(checkSignupInput({ email: "a@yopmail.com", termsAccepted: true })).toBe("disposable_email");
    expect(checkSignupInput({ email: "nope", termsAccepted: true })).toBe("invalid_email");
    expect(checkSignupInput({ email: "a@uni.edu", termsAccepted: false })).toBe("terms_not_accepted");
    expect(checkSignupInput({ email: "a@uni.edu", termsAccepted: "true" })).toBe("terms_not_accepted");
    expect(checkSignupInput({ email: "a@uni.edu", termsAccepted: true })).toBeNull();
  });

  it("audit lines never contain the address", () => {
    const lines: string[] = [];
    logSignupEvent({ event: "signup", outcome: "REFUSED", reason: "disposable_email", emailRef: hashRef("Person@Mailinator.com") }, (l) => lines.push(l));
    expect(lines[0]).not.toMatch(/person|mailinator/i);
    expect(hashRef("A@b.test")).toBe(hashRef(" a@B.test "));
  });

  it("per-email allowance stops after the limit and resets after the window", async () => {
    const rows = new Map<string, { key: string; count: number; lastRequest: number }>();
    const adapter = {
      findOne: async ({ where }: { where: { value: unknown }[] }) => rows.get(String(where[0]!.value)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => void rows.set(String(data.key), data as never),
      update: async ({ where, update }: { where: { value: unknown }[]; update: Record<string, unknown> }) => void Object.assign(rows.get(String(where[0]!.value))!, update),
    };
    const t0 = 1_000_000;
    for (let i = 0; i < SIGNUP_LIMITS.perEmailMax; i += 1) expect(await consumeEmailAllowance(adapter, "a@uni.edu", t0 + i)).toBe(true);
    expect(await consumeEmailAllowance(adapter, "a@uni.edu", t0 + 10)).toBe(false);
    expect(await consumeEmailAllowance(adapter, "b@uni.edu", t0 + 10)).toBe(true);
    expect(await consumeEmailAllowance(adapter, "a@uni.edu", t0 + SIGNUP_LIMITS.perEmailWindowSeconds * 1000 + 100)).toBe(true);
  });
});

describe("self-service signup flow against real Better Auth (local, dev email sink)", () => {
  it("refuses signup entirely while the switch is off", async () => {
    const { auth } = await open({ ...LOCAL, CHEMDFT_EMAIL_PROVIDER: "dev" });
    const response = await post(auth, "/sign-up/email", { email: "a@uni.edu", password: "correct horse battery", name: "A" });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
  });

  it("requires terms, refuses disposable domains, verifies email before sign-in, marks the account and answers generically for an existing address", async () => {
    devOutbox.length = 0;
    const { auth } = await open({ ...OPEN });
    const body = { email: "Ada@uni.edu", password: "correct horse battery", name: "Ada", termsAccepted: true };

    expect((await post(auth, "/sign-up/email", { ...body, termsAccepted: false })).status).toBe(400);
    const disposable = await post(auth, "/sign-up/email", { ...body, email: "x@mailinator.com" });
    expect(disposable.status).toBe(400);
    expect((await disposable.json()).code).toBe("DISPOSABLE_EMAIL");

    const created = await post(auth, "/sign-up/email", body);
    expect(created.status).toBe(200);
    expect(devOutbox.filter((m) => m.kind === "email-verification")).toHaveLength(1);

    // Unverified: no session, no sign-in.
    const early = await post(auth, "/sign-in/email", { email: "ada@uni.edu", password: "correct horse battery" });
    expect(early.status).toBe(403);
    expect((await early.json()).code).toBe("EMAIL_NOT_VERIFIED");

    // Verify through the emailed link, then sign in; the token carries the self-signup marker.
    const link = new URL(devOutbox.find((m) => m.kind === "email-verification")!.text);
    const verify = await auth.handler(new Request(link.toString().replace(/^https?:\/\/[^/]+/, "http://127.0.0.1:3102"), { headers: { origin: "http://127.0.0.1:3102" } }));
    expect([200, 302]).toContain(verify.status);
    const signedIn = await post(auth, "/sign-in/email", { email: "ada@uni.edu", password: "correct horse battery" });
    expect(signedIn.status).toBe(200);
    const headers = new Headers({ cookie: signedIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
    const { token } = (await auth.api.getToken({ headers })) as { token: string };
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
    expect(payload).toMatchObject({ email: "ada@uni.edu", email_verified: true, signup_source: "self", terms_version: TERMS_VERSION });
    expect(typeof payload.terms_accepted_at).toBe("string");

    // Existing address: same status and same body shape as a new one, and no second account.
    const again = await post(auth, "/sign-up/email", body);
    expect(again.status).toBe(200);
    expect(Object.keys((await again.json()).user).sort()).toEqual(Object.keys((await (await post(auth, "/sign-up/email", { ...body, email: "grace@uni.edu" })).json()).user).sort());
  });

  it("a browser cannot choose its own signup marker or terms version", async () => {
    const { auth } = await open({ ...OPEN });
    // Better Auth refuses server-only fields (input:false) in the request body outright.
    const response = await post(auth, "/sign-up/email", { email: "mal@uni.edu", password: "correct horse battery", name: "M", termsAccepted: true, signupSource: "owner", termsVersion: "x" });
    expect(response.status).toBe(400);
    const context = await auth.$context;
    expect(await context.internalAdapter.findUserByEmail("mal@uni.edu")).toBeNull();
  });

  it("fails closed when the authentication database is not migrated", async () => {
    const bundle = await createAuth({ ...OPEN }, new DatabaseSync(":memory:") as never, { migrate: false });
    expect(bundle.config.publicSignupEnabled).toBe(false);
    expect(bundle.config.signupBlockedReason).toMatch(/not been migrated/);
    expect((await getMigrations(bundle.auth.options)).toBeCreated.length).toBeGreaterThan(0);
  });
});
