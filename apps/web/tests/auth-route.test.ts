import { afterEach, describe, expect, it } from "vitest";

import { GET, POST } from "../src/app/api/auth/[...all]/route";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("/api/auth route", () => {
  it("serves nothing in dev mode (the fixed development identity needs no session)", async () => {
    delete process.env.CHEMDFT_AUTH_MODE;
    for (const handler of [GET, POST]) {
      const response = await handler(new Request("http://127.0.0.1:3000/api/auth/sign-in/email", { method: handler === GET ? "GET" : "POST" }));
      expect(response.status).toBe(404);
    }
  });

  it("reports a misconfigured jwt mode instead of serving", async () => {
    process.env.CHEMDFT_AUTH_MODE = "jwt";
    delete process.env.BETTER_AUTH_SECRET;
    const response = await GET(new Request("http://127.0.0.1:3000/api/auth/jwks"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/secret/i);
  });

  it("does not run the fixed dev identity in a hosted environment, whatever else is set", async () => {
    process.env.VERCEL = "1";
    delete process.env.CHEMDFT_AUTH_MODE;
    const response = await GET(new Request("https://chemdft-preview.vercel.app/api/auth/jwks"));
    expect(response.status).toBe(500); // dev mode is refused when hosted: nothing is served
  });
});
