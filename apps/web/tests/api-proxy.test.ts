import { describe, expect, it, vi } from "vitest";

import * as route from "../src/app/api/chemdft/[...path]/route";
import { FORWARDED_METHODS, forwardApiRequest } from "../src/lib/api-proxy";

const DEV_ENV = {
  CHEMDFT_DEV_IDENTITY_ENABLED: "true",
  CHEMDFT_DEV_USER_ID: "00000000-0000-4000-8000-000000000001",
  CHEMDFT_DEV_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000010",
  CHEMDFT_API_BASE_URL: "http://api.internal:9000",
} as const;

type Call = { url: URL; init: RequestInit };

function upstream(response: () => Response = () => Response.json({ ok: true })) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    return response();
  });
  return { calls, fetch: fetchMock as unknown as typeof fetch };
}

const PATH = ["v1", "projects", "p1", "experimental", "spectra", "datasets", "d1", "association"];

describe("API forwarding Route Handler (not Next proxy.ts)", () => {
  it("exports a handler for every method the API uses, so Next never answers 405", () => {
    for (const method of FORWARDED_METHODS) {
      expect(typeof (route as Record<string, unknown>)[method], method).toBe("function");
    }
  });

  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"] as const)(
    "%s reaches the API with its method, path, query string, body and content type",
    async (method) => {
      const { calls, fetch } = upstream();
      const hasBody = method !== "GET";
      const request = new Request("http://web.local/api/chemdft/x?a=1&b=two%20words", {
        method,
        headers: { "content-type": "application/json", accept: "application/json" },
        ...(hasBody ? { body: JSON.stringify({ state: "ASSOCIATED_WITH_SAMPLE", n: 1 }) } : {}),
      });

      const response = await forwardApiRequest(request, PATH, DEV_ENV, fetch);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(calls).toHaveLength(1);
      const { url, init } = calls[0]!;
      expect(init.method).toBe(method);
      expect(url.origin).toBe("http://api.internal:9000");
      expect(url.pathname).toBe(`/${PATH.join("/")}`);
      expect(url.search).toBe("?a=1&b=two%20words");
      const headers = new Headers(init.headers);
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("accept")).toBe("application/json");
      if (hasBody) {
        expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(
          JSON.stringify({ state: "ASSOCIATED_WITH_SAMPLE", n: 1 }),
        );
      } else {
        expect(init.body).toBeUndefined();
      }
    },
  );

  it("forwards a DELETE that carries a body and a multipart upload untouched", async () => {
    const { calls, fetch } = upstream();
    const body = new Uint8Array([0, 1, 2, 250, 251]);
    await forwardApiRequest(
      new Request("http://web.local/api/chemdft/x", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=zz" },
        body,
      }),
      ["v1", "uploads"],
      DEV_ENV,
      fetch,
    );
    expect(new Uint8Array(calls[0]!.init.body as ArrayBuffer)).toEqual(body);
    expect(new Headers(calls[0]!.init.headers).get("content-type")).toBe("multipart/form-data; boundary=zz");
  });

  it.each([200, 201, 204, 400, 404, 409, 422, 500])("preserves upstream status %i, body and content type", async (status) => {
    const { fetch } = upstream(
      () => new Response(status === 204 ? null : JSON.stringify({ detail: `s${status}` }), {
        status,
        headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="r.json"', "set-cookie": "leak=1", "x-internal": "1" },
      }),
    );
    const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x", { method: "PUT", body: "{}" }), PATH, DEV_ENV, fetch);
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="r.json"');
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.has("x-internal")).toBe(false);
    if (status !== 204) expect(await response.json()).toEqual({ detail: `s${status}` });
  });

  it("drops every client-supplied identity, service, authorization and internal header", async () => {
    const { calls, fetch } = upstream();
    const spoofed: Record<string, string> = {
      "X-ChemDFT-User-ID": "00000000-0000-4000-8000-0000000000f1",
      "X-ChemDFT-Organization-ID": "00000000-0000-4000-8000-0000000000f0",
      "X-ChemDFT-Service-Principal": "compute-worker",
      "X-ChemDFT-Service": "billing-webhook",
      "X-ChemDFT-Trusted-Producer-ID": "browser",
      "X-ChemDFT-Internal-Auth": "secret",
      Authorization: "Bearer forged",
      Cookie: "session=forged",
      "X-Forwarded-User": "admin",
      "X-Forwarded-For": "10.0.0.1",
      "X-Internal-Token": "x",
      "Proxy-Authorization": "Basic Zm9v",
      "X-Original-URL": "/admin",
    };
    for (const env of [DEV_ENV, { CHEMDFT_API_BASE_URL: "http://api.internal:9000" }]) {
      for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
        await forwardApiRequest(new Request("http://web.local/api/chemdft/x", { method, headers: { ...spoofed, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: "{}" }) }), PATH, env, fetch);
      }
    }
    for (const { init } of calls) {
      const names = [...new Headers(init.headers).keys()];
      const serverOwned = ["x-chemdft-user-id", "x-chemdft-organization-id"]; // exact values asserted below
      for (const spoof of Object.keys(spoofed)) {
        if (!serverOwned.includes(spoof.toLowerCase())) expect(names, spoof).not.toContain(spoof.toLowerCase());
      }
      // nothing but the allowlist and (in dev) the server's own identity headers survives
      expect(names.filter((n) => !["accept", "content-type", "x-chemdft-user-id", "x-chemdft-organization-id"].includes(n))).toEqual([]);
    }
    // with dev identity the identity headers are the server's, never the client's
    const devCalls = calls.slice(0, 4);
    for (const { init } of devCalls) {
      const headers = new Headers(init.headers);
      expect(headers.get("x-chemdft-user-id")).toBe(DEV_ENV.CHEMDFT_DEV_USER_ID);
      expect(headers.get("x-chemdft-organization-id")).toBe(DEV_ENV.CHEMDFT_DEV_ORGANIZATION_ID);
    }
    // without dev identity the web layer adds no identity at all
    for (const { init } of calls.slice(4)) {
      const names = [...new Headers(init.headers).keys()];
      expect(names).not.toContain("x-chemdft-user-id");
      expect(names).not.toContain("x-chemdft-organization-id");
    }
  });

  it("never follows upstream redirects and rejects traversal paths without calling the API", async () => {
    const { calls, fetch } = upstream();
    await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, DEV_ENV, fetch);
    expect(calls[0]!.init.redirect).toBe("manual");
    for (const bad of [[], ["v1", ".."], ["..", "health"], ["v1", ""], ["v1", "a/b"]]) {
      const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), bad, DEV_ENV, fetch);
      expect(response.status).toBe(400);
    }
    expect(calls).toHaveLength(1);
  });

  it("answers 502 when the API is unreachable and refuses dev identity in production", async () => {
    const failing = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const unreachable = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, DEV_ENV, failing);
    expect(unreachable.status).toBe(502);
    const never = vi.fn() as unknown as typeof fetch;
    const production = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, { ...DEV_ENV, NODE_ENV: "production" }, never);
    expect(production.status).toBe(500);
    expect(never).not.toHaveBeenCalled();
  });

  it.each([
    ["VERCEL", { VERCEL: "1" }],
    ["VERCEL_ENV", { VERCEL_ENV: "preview" }],
    ["VERCEL_URL", { VERCEL_URL: "chemdft-abc.vercel.app" }],
    ["a non-local CHEMDFT_ENV", { CHEMDFT_ENV: "staging" }],
    ["CHEMDFT_ENV=production", { CHEMDFT_ENV: "production" }],
  ])("never injects the fixed development identity on %s, even when NODE_ENV is not production", async (_name, extra) => {
    const { calls, fetch } = upstream();
    const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, { ...DEV_ENV, ...extra }, fetch);
    expect(response.status).toBe(500);
    expect((await response.json()).detail).toContain("explicitly local environment");
    expect(calls).toHaveLength(0);
  });

  it("still serves the local development workflow (no marker, or an explicit local CHEMDFT_ENV)", async () => {
    for (const extra of [{}, { CHEMDFT_ENV: "local" }, { CHEMDFT_ENV: "development" }]) {
      const { calls, fetch } = upstream();
      const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, { ...DEV_ENV, ...extra }, fetch);
      expect(response.status).toBe(200);
      expect(new Headers(calls[0]!.init.headers).get("x-chemdft-user-id")).toBe(DEV_ENV.CHEMDFT_DEV_USER_ID);
    }
  });

  it("keeps nosniff on inline document responses and still drops every other upstream header", async () => {
    const { fetch } = upstream(
      () => new Response("%PDF-1.7", {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'inline; filename="paper.pdf"',
          "x-content-type-options": "nosniff",
          etag: '"abc"', "cache-control": "public, max-age=1", "accept-ranges": "bytes", "retry-after": "5", location: "http://internal/x", "x-powered-by": "uvicorn",
        },
      }),
    );
    const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, DEV_ENV, fetch);
    expect([...response.headers.keys()].sort()).toEqual(["cache-control", "content-disposition", "content-type", "x-content-type-options"]);
    expect(response.headers.get("cache-control")).toBe("no-store"); // never the upstream "public, max-age=1"
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="paper.pdf"');
  });

  describe("scientific evidence-standing headers", () => {
    const evidence = (headers: Record<string, string>) =>
      upstream(() => new Response("# cube", { headers: { "content-type": "chemical/x-cube", "content-disposition": 'attachment; filename="f.cube"', ...headers } }));

    it("forwards evidence use and the related standing tokens, and forces no-store", async () => {
      const { fetch } = evidence({
        "x-chemdft-evidence-use": "HISTORICAL_ONLY", "x-chemdft-effective-authority": "CANDIDATE",
        "x-chemdft-source-lineage": "SUPERSEDED", "x-chemdft-verification": "UNVERIFIED", "cache-control": "no-store",
      });
      const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, DEV_ENV, fetch);
      expect(response.headers.get("x-chemdft-evidence-use")).toBe("HISTORICAL_ONLY");
      expect(response.headers.get("x-chemdft-effective-authority")).toBe("CANDIDATE");
      expect(response.headers.get("x-chemdft-source-lineage")).toBe("SUPERSEDED");
      expect(response.headers.get("x-chemdft-verification")).toBe("UNVERIFIED");
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("never lets a permissive upstream cache policy through on an evidence response", async () => {
      const { fetch } = evidence({ "x-chemdft-evidence-use": "CURRENT", "cache-control": "public, max-age=31536000" });
      const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, DEV_ENV, fetch);
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("RW-3: report and evidence-archive downloads keep their type, filename, standing and no-store", async () => {
      for (const [type, name] of [["text/html; charset=utf-8", "chemdft-report-2026-10-12.html"], ["application/zip", "calc-1234abcd-provenance-archive.zip"]] as [string, string][]) {
        const { fetch } = upstream(() => new Response("x", { headers: {
          "content-type": type, "content-disposition": `attachment; filename="${name}"`, "x-chemdft-evidence-use": "HISTORICAL_ONLY", "cache-control": "no-store",
        } }));
        const response = await forwardApiRequest(
          new Request("http://web.local/api/chemdft/v1/projects/p/scientific-report?format=html&result_id=r"), ["v1", "projects", "p", "scientific-report"], DEV_ENV, fetch);
        expect(response.headers.get("content-type")).toBe(type);
        expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${name}"`);
        expect(response.headers.get("x-chemdft-evidence-use")).toBe("HISTORICAL_ONLY");
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    });

    it("rejects values that are not bare tokens, so nothing can be injected", async () => {
      const { fetch } = evidence({ "x-chemdft-evidence-use": "CURRENT, HISTORICAL_ONLY", "x-chemdft-verification": "verified\tby me", "x-chemdft-source-lineage": "<script>" });
      const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, DEV_ENV, fetch);
      expect(response.headers.has("x-chemdft-evidence-use")).toBe(false);
      expect(response.headers.has("x-chemdft-verification")).toBe(false);
      expect(response.headers.has("x-chemdft-source-lineage")).toBe(false);
      expect(response.headers.get("cache-control")).toBe("no-store"); // protected route: independent of standing
    });

    it("does not widen forwarding: other x-chemdft headers and cookies are still dropped", async () => {
      const { fetch } = evidence({ "x-chemdft-evidence-use": "NO_RESULT", "x-chemdft-internal": "1", "set-cookie": "a=b", "access-control-expose-headers": "*" });
      const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, DEV_ENV, fetch);
      expect([...response.headers.keys()].sort()).toEqual(["cache-control", "content-disposition", "content-type", "x-chemdft-evidence-use"]);
    });

    it.each([
      ["lineage JSON without standing headers", { "content-type": "application/json", "content-disposition": 'attachment; filename="l.json"' }, 200],
      ["all standing headers missing, permissive upstream policy", { "cache-control": "public, max-age=600", "etag": '"x"' }, 200],
      ["every standing header invalid", { "x-chemdft-evidence-use": "ok ok", "x-chemdft-verification": "a\tb" }, 200],
      ["historical CUBE with standing headers", { "x-chemdft-evidence-use": "HISTORICAL_ONLY", "x-chemdft-source-lineage": "SUPERSEDED" }, 200],
      ["404 error", { "content-type": "application/json" }, 404],
      ["422 error", { "content-type": "application/json", "cache-control": "max-age=60" }, 422],
      ["500 error", {}, 500],
    ])("protected project response is no-store: %s", async (_label, headers, status) => {
      const { fetch } = upstream(() => new Response(status === 200 ? "x" : JSON.stringify({ detail: "d" }), { status, headers }));
      const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), ["v1", "projects", "p1", "results", "r1", "export"], DEV_ENV, fetch);
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.has("etag")).toBe(false);
      expect(response.headers.has("set-cookie")).toBe(false);
    });

    it("non-standing-valued headers are still rejected even though no-store is now unconditional", async () => {
      const { fetch } = evidence({ "x-chemdft-evidence-use": "CURRENT, HISTORICAL_ONLY" });
      const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, DEV_ENV, fetch);
      expect(response.headers.has("x-chemdft-evidence-use")).toBe(false);
    });

    it("the public published-example reads keep their previous header behavior", async () => {
      const { fetch } = upstream(() => new Response("{}", { headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } }));
      const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/v1/examples"), ["v1", "examples"], DEV_ENV, fetch);
      expect(response.headers.has("cache-control")).toBe(false);
    });

    it("authorization is unchanged: an unauthenticated jwt-mode request is still refused before any upstream call", async () => {
      const { fetch, calls } = upstream(() => new Response("{}"));
      const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), ["v1", "projects", "p1", "results"], { CHEMDFT_AUTH_MODE: "jwt" }, fetch, async () => null);
      expect(response.status).toBe(401);
      expect(calls).toHaveLength(0);
    });

    it("a 404 for a project the caller cannot see carries no standing headers", async () => {
      const { fetch } = upstream(() => Response.json({ detail: "Project not found" }, { status: 404 }));
      const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, DEV_ENV, fetch);
      expect(response.status).toBe(404);
      expect(response.headers.has("x-chemdft-evidence-use")).toBe(false);
    });
  });

  describe("every response path is protected (central finalizer)", () => {
    const PROTECTED = ["v1", "projects", "p1", "results", "r1", "export"];
    const get = () => new Request("http://web.local/api/chemdft/x");
    const JWT = { CHEMDFT_AUTH_MODE: "jwt", CHEMDFT_API_BASE_URL: "http://api.internal:9000" } as const;
    const token = "SECRET-TOKEN-VALUE";

    it.each([
      ["upstream 200 without any standing header", () => new Response("ok", { headers: { "content-type": "application/json" } })],
      ["upstream 200 with a permissive cache policy", () => new Response("ok", { headers: { "cache-control": "public, max-age=3600", etag: '"e"' } })],
      ["upstream 404", () => Response.json({ detail: "n" }, { status: 404 })],
      ["upstream 422", () => Response.json({ detail: "n" }, { status: 422 })],
      ["upstream 500", () => Response.json({ detail: "n" }, { status: 500 })],
      ["missing standing headers", () => new Response("x", { headers: { "content-disposition": 'attachment; filename="l.json"' } })],
      ["invalid standing headers", () => new Response("x", { headers: { "x-chemdft-evidence-use": "a b", "x-chemdft-verification": "<x>" } })],
      ["historical CUBE download", () => new Response("# cube", { headers: { "content-type": "chemical/x-cube", "x-chemdft-evidence-use": "HISTORICAL_ONLY", "x-chemdft-source-lineage": "SUPERSEDED" } })],
    ])("upstream: %s", async (_name, make) => {
      const { fetch } = upstream(make);
      const response = await forwardApiRequest(get(), PROTECTED, DEV_ENV, fetch);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.has("etag")).toBe(false);
      expect(response.headers.has("set-cookie")).toBe(false);
    });

    it.each([
      ["400 invalid path", async () => forwardApiRequest(get(), ["v1", "..", "x"], DEV_ENV, vi.fn() as unknown as typeof fetch), 400],
      ["401 no session token (jwt)", async () => forwardApiRequest(get(), PROTECTED, JWT, vi.fn() as unknown as typeof fetch, async () => null), 401],
      ["401 token resolver throws (jwt)", async () => forwardApiRequest(get(), PROTECTED, JWT, vi.fn() as unknown as typeof fetch, async () => { throw new Error("db down"); }), 401],
      ["500 dev identity in production", async () => forwardApiRequest(get(), PROTECTED, { ...DEV_ENV, NODE_ENV: "production" }, vi.fn() as unknown as typeof fetch), 500],
      ["500 dev identity outside a local environment", async () => forwardApiRequest(get(), PROTECTED, { ...DEV_ENV, CHEMDFT_ENV: "staging" }, vi.fn() as unknown as typeof fetch), 500],
      ["500 incomplete dev identity", async () => forwardApiRequest(get(), PROTECTED, { ...DEV_ENV, CHEMDFT_DEV_USER_ID: "" }, vi.fn() as unknown as typeof fetch), 500],
      ["502 API unreachable", async () => forwardApiRequest(get(), PROTECTED, DEV_ENV, vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch), 502],
      ["500 unexpected proxy exception", async () => forwardApiRequest(get(), PROTECTED, DEV_ENV, vi.fn(async () => ({ status: 200 })) as unknown as typeof fetch), 500],
    ])("proxy-generated: %s", async (_name, run, status) => {
      const response = await run();
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect([...response.headers.keys()].filter((k) => !["cache-control", "content-type"].includes(k))).toEqual([]);
      expect(JSON.stringify(await response.json())).not.toContain("SECRET");
    });

    it("does not leak the session token or identity through a failed upstream call", async () => {
      const failing = vi.fn(async () => { throw new TypeError(`fetch failed for ${token}`); }) as unknown as typeof fetch;
      const response = await forwardApiRequest(get(), PROTECTED, JWT, failing, async () => token);
      expect(response.status).toBe(502);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain(token);
      expect(response.headers.has("authorization")).toBe(false);
    });

    it("public published-example reads keep their own policy, and private paths are never classed as public", async () => {
      const { fetch } = upstream(() => new Response("{}", { headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } }));
      const publicRead = await forwardApiRequest(get(), ["v1", "examples", "water-basics"], DEV_ENV, fetch);
      expect(publicRead.headers.has("cache-control")).toBe(false);
      for (const path of [["v1", "projects", "p1", "examples"], ["v1", "examples", "water-basics", "copy"], ["v1", "me"]]) {
        const response = await forwardApiRequest(get(), path, DEV_ENV, fetch);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      const post = await forwardApiRequest(new Request("http://web.local/api/chemdft/x", { method: "POST", body: "{}" }), ["v1", "examples"], DEV_ENV, fetch);
      expect(post.headers.get("cache-control")).toBe("no-store");
    });
  });

  describe("jwt mode", () => {
    const JWT_ENV = { CHEMDFT_AUTH_MODE: "jwt", CHEMDFT_API_BASE_URL: "http://api.internal:9000" } as const;

    it("forwards the server-resolved token as the only credential and never adds dev identity headers", async () => {
      const { calls, fetch } = upstream();
      const response = await forwardApiRequest(
        new Request("http://web.local/api/chemdft/x", {
          headers: { Authorization: "Bearer from-the-browser", Cookie: "better-auth.session_token=abc", "X-ChemDFT-User-ID": "spoof", "X-ChemDFT-Organization-ID": "spoof" },
        }),
        PATH,
        // a mis-set dev flag must be irrelevant in jwt mode
        { ...JWT_ENV, CHEMDFT_DEV_IDENTITY_ENABLED: "true" },
        fetch,
        async () => "server-minted-token",
      );
      expect(response.status).toBe(200);
      const headers = new Headers(calls[0]!.init.headers);
      expect(headers.get("authorization")).toBe("Bearer server-minted-token");
      expect(headers.has("x-chemdft-user-id")).toBe(false);
      expect(headers.has("x-chemdft-organization-id")).toBe(false);
      expect(headers.has("cookie")).toBe(false);
      expect([...headers.keys()].sort()).toEqual(["authorization"]);
    });

    it.each([
      ["no resolver", undefined],
      ["no session", async (): Promise<string | null> => null],
      ["a resolver that fails", async () => { throw new Error("db down"); }],
    ] as const)("answers 401 and never calls the API with %s (no fallback to the dev identity)", async (_name, resolver) => {
      const { calls, fetch } = upstream();
      const response = await forwardApiRequest(new Request("http://web.local/api/chemdft/x"), PATH, { ...JWT_ENV, CHEMDFT_DEV_IDENTITY_ENABLED: "true" }, fetch, resolver);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ detail: "authentication_required" });
      expect(calls).toHaveLength(0);
    });

    it("keeps forwarding every method with the token (a saved association PUT included)", async () => {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const { calls, fetch } = upstream();
        await forwardApiRequest(new Request("http://web.local/api/chemdft/x", { method, ...(method === "GET" ? {} : { body: "{}", headers: { "content-type": "application/json" } }) }), PATH, JWT_ENV, fetch, async () => "t");
        expect(calls[0]!.init.method).toBe(method);
        expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer t");
      }
    });
  });
});
