import { describe, expect, it, vi } from "vitest";
import { forwardApiRequest, isPublicExampleRead } from "../src/lib/api-proxy";

const env = {
  CHEMDFT_AUTH_MODE: "jwt",
  CHEMDFT_API_BASE_URL: "http://api.internal",
};
describe("published example read boundary", () => {
  it("permits only the closed GET catalogue, specimen, source and Navigator paths", () => {
    for (const tail of [
      [],
      ["cr2o3-eskolaite"],
      ["benzene", "navigator"],
      ["caffeine", "source"],
    ]) {
      expect(isPublicExampleRead("GET", ["v1", "examples", ...tail])).toBe(
        true,
      );
      for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"])
        expect(isPublicExampleRead(method, ["v1", "examples", ...tail])).toBe(
          false,
        );
    }
    for (const path of [
      ["v1", "projects"],
      ["v1", "examples", "benzene", "copy"],
      ["v1", "examples", ".."],
      ["v1", "examples", "benzene", "source", "private"],
      ["v1", "examples", "a/b"],
      ["v1", "examples", "X"],
      ["v1", "examples", "a".repeat(97)],
    ])
      expect(isPublicExampleRead("GET", path)).toBe(false);
  });
  it("public reads carry no identity or cookie, even for a signed-in or spoofing browser", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json([]);
      },
    );
    const resolver = vi.fn(async () => "private-token");
    const response = await forwardApiRequest(
      new Request("http://web/api/chemdft/v1/examples", {
        headers: {
          Authorization: "Bearer spoof",
          Cookie: "secret",
          "X-ChemDFT-Organization-ID": "foreign",
        },
      }),
      ["v1", "examples"],
      env,
      fetcher,
      resolver,
    );
    expect(response.status).toBe(200);
    expect(resolver).not.toHaveBeenCalled();
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect([...headers.keys()]).toEqual([]);
  });
  it("copy and private project reads still require the trusted session token", async () => {
    const fetcher = vi.fn(async () => Response.json({}));
    for (const [method, path] of [
      ["POST", ["v1", "examples", "benzene", "copy"]],
      ["GET", ["v1", "projects", "private"]],
    ] as const) {
      const response = await forwardApiRequest(
        new Request("http://web/api/chemdft/x", { method }),
        path,
        env,
        fetcher,
        async () => null,
      );
      expect(response.status).toBe(401);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
