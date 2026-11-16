import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createControlledUser } from "../src/lib/auth/controlled-users";
import { createAuth, getMigrations } from "../src/lib/auth/server";
import { orcidFlowOf, orcidIdUrl, plainOrcidError } from "../src/lib/orcid";

const SECRET = "k3Jx9QpL2vZr8T" + "nW5yBc7HdMfGaUe4SoXi6NtVq1";
const ENV = { CHEMDFT_AUTH_MODE: "jwt", BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: "http://127.0.0.1:3101", CHEMDFT_ORCID_ENABLED: "true", CHEMDFT_API_BASE_URL: "http://api.invalid" } as const;
const ORIGIN = "http://127.0.0.1:3101";

async function bundle() {
  const created = await createAuth(ENV, new DatabaseSync(":memory:") as never);
  await (await getMigrations(created.auth.options)).runMigrations();
  return created;
}

const complete = (auth: { handler: (request: Request) => Promise<Response> }, cookie?: string) =>
  auth.handler(new Request(`${ORIGIN}/api/auth/orcid/complete`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ code: "c", state: "s.x" }) }));

afterEach(() => vi.unstubAllGlobals());

describe("Sign in with ORCID (Better Auth plugin; the API is replaced by a stub, so this is not evidence about ORCID)", () => {
  it("creates a normal session for the subject the API names, and clears the binding cookie", async () => {
    const created = await bundle();
    const user = await createControlledUser({ email: "linked@example.test", name: "Linked", password: "correct horse battery" }, ENV, created);
    let calledUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => { calledUrl = String(input); return Response.json({ subject: user.id }); }));
    const response = await complete(created.auth, "chemdft_orcid_binding=" + "b".repeat(64));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, next: "/en/projects" });
    expect(calledUrl).toBe("http://api.invalid/v1/orcid/signin/complete");
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toMatch(/session_token=/);
    const session = await created.auth.api.getSession({ headers: new Headers({ cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") }) });
    expect(session?.user.id).toBe(user.id);
  });

  it("refuses an unlinked iD without a session and without creating an account", async () => {
    const created = await bundle();
    const context = await created.auth.$context;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: "not_linked" }, { status: 403 })));
    const response = await complete(created.auth, "chemdft_orcid_binding=" + "b".repeat(64));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "not_linked" });
    expect(response.headers.getSetCookie().join("\n")).not.toMatch(/session_token=[^;]+;/);
    expect(await context.internalAdapter.findUserByEmail("anyone@example.test", { includeAccounts: false })).toBeNull();
    // a different browser (no binding cookie) never even reaches the API
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    expect((await complete(created.auth)).status).toBe(400);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("refuses a subject that is not a user of this auth database", async () => {
    const created = await bundle();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ subject: "no-such-user" })));
    expect((await complete(created.auth, "chemdft_orcid_binding=" + "b".repeat(64))).status).toBe(403);
  });
});

describe("ORCID display helpers", () => {
  it("builds the full iD URL for the environment and reads the flow from the state", () => {
    expect(orcidIdUrl("0000-0002-1825-0097", "production")).toBe("https://orcid.org/0000-0002-1825-0097");
    expect(orcidIdUrl("0000-0002-1825-0097", "sandbox")).toBe("https://sandbox.orcid.org/0000-0002-1825-0097");
    expect(orcidFlowOf("l.abc")).toBe("link");
    expect(orcidFlowOf("s.abc")).toBe("signin");
    expect(orcidFlowOf("abc")).toBeNull();
    expect(orcidFlowOf(null)).toBeNull();
  });

  it("gives a plain sentence and never echoes the raw code", () => {
    expect(plainOrcidError("not_linked")).toMatch(/No ChemDFT account is linked/);
    expect(plainOrcidError("whatever_new_code")).not.toMatch(/whatever_new_code/);
  });
});
