import { expect, test as base } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export { expect };
export type { APIRequestContext, Page, Request } from "@playwright/test";

/** Resolve repository-owned fixture tools from the runner, never the disposable web cwd. */
export function repositoryPath(...parts: string[]) {
  const root = process.env.CHEMDFT_E2E_REPOSITORY_ROOT;
  if (!root) throw new Error("TEST_REPOSITORY_ROOT_REQUIRED");
  return resolve(root, ...parts);
}

export function testPython(code: string, ...args: string[]) {
  return execFileSync(repositoryPath(".venv/bin/python"), ["-B", "-c", code, ...args], { env: process.env, encoding: "utf8" });
}

export const test = base.extend<{ offlineNetwork: void }>({
  offlineNetwork: [async ({ context }, use) => {
    expect(process.env.CHEMDFT_E2E_OFFLINE, "run this suite with --offline").toBe("1");
    expect(process.env.CHEMDFT_AI_PROVIDER).toBe("fake");
    expect(process.env.CHEMDFT_E2E_WORKER_MODE).toBe("disabled");
    const blocked: string[] = [];
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
        blocked.push(url.origin);
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    await use();
    expect(blocked, "unexpected non-local browser request").toEqual([]);
  }, { auto: true }],
});
