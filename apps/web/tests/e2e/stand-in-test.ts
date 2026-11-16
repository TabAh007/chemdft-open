import { expect, test as base } from "@playwright/test";

export { expect };
export type { APIRequestContext, Page } from "@playwright/test";
export { repositoryPath } from "./offline-test";

const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/**
 * Browser tests for the offline NVIDIA stand-in suite: the real HTTP gateway talks to a loopback
 * stand-in (tools/e2e_offline/nvidia_stub.py). No provider is contacted, no credential is real, the
 * compute worker is off, and the browser itself may reach loopback only. Nothing this suite shows is
 * evidence about any hosted model.
 */
export const test = base.extend<{ standInNetwork: void }>({
  standInNetwork: [async ({ context }, use) => {
    expect(process.env.CHEMDFT_E2E_OFFLINE, "run this suite with --offline").toBe("1");
    expect(process.env.CHEMDFT_ENVIRONMENT).toBe("test");
    expect(process.env.CHEMDFT_AI_PROVIDER).toBe("nvidia");
    expect(process.env.CHEMDFT_E2E_WORKER_MODE).toBe("disabled");
    for (const name of ["CHEMDFT_AI_API_BASE_URL", "CHEMDFT_E2E_STAND_IN_URL"]) {
      expect(LOCAL_HOSTS, `${name} must be loopback`).toContain(new URL(process.env[name] ?? "https://invalid.example").hostname);
    }
    const blocked: string[] = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && !LOCAL_HOSTS.includes(url.hostname)) {
        blocked.push(url.origin);
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    await use();
    expect(blocked, "unexpected non-local browser request").toEqual([]);
  }, { auto: true }],
});
