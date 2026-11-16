import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "../src/app/api/chemdft/[...path]/route";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("development identity proxy", () => {
  it("strips browser-supplied identity and trusted producer headers", async () => {
    process.env.CHEMDFT_DEV_IDENTITY_ENABLED = "true";
    process.env.CHEMDFT_DEV_USER_ID = "00000000-0000-4000-8000-000000000001";
    process.env.CHEMDFT_DEV_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000010";
    let proxiedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      proxiedInit = init;
      return new Response("[]", {
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const request = new NextRequest("http://localhost/api/chemdft/v1/projects", {
      headers: {
        "X-ChemDFT-User-ID": "00000000-0000-4000-8000-000000000999",
        "X-ChemDFT-Organization-ID": "00000000-0000-4000-8000-000000000999",
        "X-ChemDFT-Trusted-Producer-ID": "browser-worker",
      },
    });
    await GET(request, { params: Promise.resolve({ path: ["v1", "projects"] }) });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (!proxiedInit) throw new Error("Expected proxied fetch options.");
    const headers = new Headers(proxiedInit.headers);
    expect(headers.get("X-ChemDFT-User-ID")).toBe("00000000-0000-4000-8000-000000000001");
    expect(headers.get("X-ChemDFT-Organization-ID")).toBe("00000000-0000-4000-8000-000000000010");
    expect(headers.has("X-ChemDFT-Trusted-Producer-ID")).toBe(false);
  });

  it("does not activate development identity in production mode", async () => {
    process.env.CHEMDFT_DEV_IDENTITY_ENABLED = "true";
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await GET(
      new NextRequest("http://localhost/api/chemdft/v1/projects"),
      { params: Promise.resolve({ path: ["v1", "projects"] }) },
    );
    const payload = await response.json() as { detail: string };

    expect(response.status).toBe(500);
    expect(payload.detail).toBe("Development identity is disabled in production builds.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
