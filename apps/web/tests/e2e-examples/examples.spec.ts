import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const artifacts = resolve("../../output/pf5-review");
const secret = process.env.CHEMDFT_E2E_EXAMPLE_AUTH_SECRET;
const password = "pf5-controlled-fixture-password";
async function capture(page: Page, name: string, fullPage = false) {
  if (fullPage) {
    await page.mouse.click(12, 70);
    await page.mouse.move(12, 150);
    await page.mouse.wheel(0, -50000);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  }
  await page.screenshot({
    path: resolve(artifacts, name),
    fullPage,
    animations: "disabled",
  });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function ordinaryBottom(page: Page) {
  await page.mouse.click(12, 70);
  await page.mouse.move(30, 550);
  for (let i = 0; i < 14; i++) await page.mouse.wheel(0, 600);
  await page.waitForTimeout(350);
  await page.keyboard.press("PageDown");
  await page.keyboard.press("End");
  await expect(page.getByTestId("project-navigator")).toBeVisible();
  const bottom = await page
    .getByTestId("project-navigator")
    .evaluate((el) => el.getBoundingClientRect().bottom);
  expect(bottom).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
}

test.beforeAll(async ({ request }) => {
  mkdirSync(artifacts, { recursive: true });
  await request.get("/api/auth/ok");
  for (const name of ["Alice", "Bob"]) {
    try {
      execFileSync(
        "pnpm",
        [
          "exec",
          "tsx",
          "scripts/create-controlled-user.ts",
          "--email",
          `pf5-${name.toLowerCase()}@example.test`,
          "--name",
          `PF5 ${name}`,
        ],
        {
          env: {
            ...process.env,
            CHEMDFT_AUTH_MODE: "jwt",
            BETTER_AUTH_SECRET: secret,
            BETTER_AUTH_URL: "http://127.0.0.1:3105",
            CHEMDFT_AUTH_DATABASE_URL:
              "file:/tmp/chemdft-e2e-examples-users.db",
            CHEMDFT_NEW_USER_PASSWORD: password,
          },
          stdio: "pipe",
        },
      );
    } catch (error) {
      const stderr = String((error as { stderr?: Buffer }).stderr ?? "");
      if (!stderr.includes("An account with this email already exists."))
        throw error;
    }
  }
});

test("anonymous catalogue is curated, keyboard reachable, and excludes private and deferred Water data", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/en/examples");
  await expect(
    page.getByRole("heading", { name: "Scientific examples" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open example", exact: true }),
  ).toHaveCount(3);
  expect((await request.get("/api/chemdft/v1/examples")).status()).toBe(200);
  expect((await request.get("/api/chemdft/v1/projects")).status()).toBe(401);
  expect(
    (await request.post("/api/chemdft/v1/examples/benzene/copy")).status(),
  ).toBe(401);
  expect(
    (await request.get("/api/chemdft/v1/examples/water-hf-sto3g")).status(),
  ).toBe(404);
  await noOverflow(page);
  await capture(page, "01-index-desktop.png", true);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  for (const action of await page
    .getByRole("link", { name: "Open example", exact: true })
    .all())
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await capture(page, "02-index-mobile.png", true);
  await page
    .getByRole("link", { name: "Open example", exact: true })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    /\/examples\/(benzene|caffeine|cr2o3-eskolaite)$/,
  );
});

test("crystal supports real 3D views, original provenance, conservative Navigator and normal mobile scrolling", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const source = await (
    await request.get("/api/chemdft/v1/examples/cr2o3-eskolaite")
  ).json();
  await page.goto("/en/examples/cr2o3-eskolaite");
  await expect(
    page.getByText("Sealed reference · read-only", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in to copy", exact: true }),
  ).toBeVisible();
  const view = page.getByTestId("example-viewport");
  await expect(view.locator("canvas")).toBeVisible();
  await page.waitForTimeout(600);
  const box = (await view.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 90,
    box.y + box.height / 2 + 30,
    { steps: 12 },
  );
  await page.mouse.up();
  await capture(page, "03-crystal-public-top.png");
  await page
    .getByRole("combobox", { name: "Representation", exact: true })
    .selectOption("unit-cell");
  await capture(page, "04-crystal-unit-cell.png");
  await page
    .getByRole("combobox", { name: "Display supercell", exact: true })
    .selectOption("2x2x1");
  await capture(page, "05-crystal-supercell.png");
  await page
    .getByRole("combobox", { name: "Representation", exact: true })
    .selectOption("polyhedra");
  await expect(
    page.getByRole("status").filter({ hasText: "Coordination geometry" }),
  ).toBeVisible();
  await capture(page, "06-crystal-polyhedra.png");
  await page
    .getByRole("combobox", { name: "Representation", exact: true })
    .selectOption("space-fill");
  await expect(page.getByTestId("example-radius-model")).toContainText(
    "Shannon effective ionic radii",
  );
  await page
    .getByRole("combobox", { name: "Representation", exact: true })
    .selectOption("polyhedra");
  await page
    .getByRole("combobox", { name: "Presentation", exact: true })
    .selectOption("publication");
  await page.getByLabel("Atom labels", { exact: true }).check();
  await capture(page, "07-crystal-publication.png");
  await page.getByText("Source coordinates", { exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(30);
  await capture(page, "08-crystal-provenance.png", true);
  await page.getByText("Source coordinates", { exact: true }).click();
  await ordinaryBottom(page);
  await capture(page, "09-crystal-navigator.png");
  const state = await (
    await request.get("/api/chemdft/v1/examples/cr2o3-eskolaite/navigator")
  ).json();
  expect(state.facts_summary).toMatchObject({ can_write: false, sealed: true });
  expect(
    state.next.some((a: { category: string }) => a.category === "calculation"),
  ).toBe(false);
  expect(
    state.blocked.some((a: { reasons: { code: string }[] }) =>
      a.reasons.some((r) => r.code === "periodic_compute_unsupported"),
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (await page
      .getByRole("link", { name: "Sign in to copy", exact: true })
      .boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  await noOverflow(page);
  await ordinaryBottom(page);
  await capture(page, "10-crystal-mobile-bottom.png");
  expect(
    (
      await (
        await request.get("/api/chemdft/v1/examples/cr2o3-eskolaite")
      ).json()
    ).structure,
  ).toEqual(source.structure);
});

test("renderer fallback keeps geometry, coordinates, source and copy guidance readable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...args: unknown[]
    ) {
      if (/webgl/i.test(kind)) return null;
      return original.apply(this, [kind, ...args] as Parameters<
        typeof original
      >);
    } as typeof original;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/examples/caffeine");
  await expect(
    page.getByText(/Static view of the same reference geometry/),
  ).toBeVisible();
  await expect(
    page.getByTestId("example-viewport").locator("svg"),
  ).toBeVisible();
  await expect(
    page.getByTestId("example-viewport").locator("canvas"),
  ).toHaveCount(0);
  await page.getByText("Source coordinates", { exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(24);
  await noOverflow(page);
  await capture(page, "11-caffeine-fallback-mobile.png", true);
});

test("real signed-in copy becomes a private mutable normal project, while canonical template stays sealed", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/en/login?next=%2Fen%2Fexamples%2Fbenzene");
  await page.getByTestId("login-email").fill("pf5-alice@example.test");
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/en\/examples\/benzene$/);
  await expect(
    page.getByRole("button", { name: "Copy to my projects", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByTestId("example-viewport").locator("canvas"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reset view", exact: true }),
  ).toBeEnabled();
  await page.waitForTimeout(400);
  await capture(page, "12-signed-in-copy.png");
  await page.goto("/en/examples/cr2o3-eskolaite");
  await expect(
    page.getByRole("button", { name: "Copy to my projects", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Reset view", exact: true }),
  ).toBeEnabled();
  await page.waitForTimeout(400);
  await capture(page, "14-crystal-signed-in-copy.png");
  await page.goto("/en/examples/benzene");
  await expect(
    page.getByRole("button", { name: "Copy to my projects", exact: true }),
  ).toBeEnabled();
  const original = await (
    await page.request.get("/api/chemdft/v1/examples/benzene")
  ).json();
  await page
    .getByRole("button", { name: "Copy to my projects", exact: true })
    .click();
  await expect(page).toHaveURL(/\/en\/projects\/[^/]+\/overview$/);
  const pid = new URL(page.url()).pathname.split("/")[3]!;
  const project = await (
    await page.request.get(`/api/chemdft/v1/projects/${pid}`)
  ).json();
  const me = await (await page.request.get("/api/chemdft/v1/me")).json();
  expect(project).toMatchObject({
    role: "owner",
    organization_id: me.organization.id,
  });
  expect(pid).not.toBe(original.example.template_project_id);
  await expect(page.getByTestId("project-navigator")).toBeVisible();
  const state = await (
    await page.request.get(`/api/chemdft/v1/projects/${pid}/navigator`)
  ).json();
  expect(state.facts_summary).toMatchObject({ can_write: true, sealed: false });
  const jobs = await (
    await page.request.get(`/api/chemdft/v1/projects/${pid}/compute/jobs`)
  ).json();
  expect(jobs.jobs).toEqual([]);
  await expect(
    page.getByText("Checking saved project items…", { exact: true }),
  ).toHaveCount(0);
  await page.getByTestId("ai-dock-close").click();
  await capture(page, "13-copied-project-navigator.png");
  const second = await page.request.post(
    "/api/chemdft/v1/examples/benzene/copy",
  );
  expect(second.status()).toBe(201);
  expect((await second.json()).project_id).not.toBe(pid);
  const bob = await browser.newContext();
  const bobPage = await bob.newPage();
  await bobPage.goto("http://127.0.0.1:3105/en/login");
  await bobPage.getByTestId("login-email").fill("pf5-bob@example.test");
  await bobPage.getByTestId("login-password").fill(password);
  await bobPage.getByTestId("login-submit").click();
  await expect(bobPage).toHaveURL(/\/en\/projects$/);
  expect(
    (
      await bob.request.get(
        `http://127.0.0.1:3105/api/chemdft/v1/projects/${pid}`,
      )
    ).status(),
  ).toBe(404);
  await bob.close();
  expect(
    (await (await page.request.get("/api/chemdft/v1/examples/benzene")).json())
      .structure,
  ).toEqual(original.structure);
});

test("new public surfaces meet automated WCAG checks", async ({ page }) => {
  const { default: axe } = await import("axe-core");
  for (const path of ["/en/examples", "/en/examples/cr2o3-eskolaite"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (path.includes("eskolaite"))
      await expect(
        page
          .getByTestId("project-navigator")
          .getByRole("heading", { name: "HAVE", exact: true }),
      ).toBeVisible();
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(
      async () =>
        (
          await (window as typeof window & { axe: typeof axe }).axe.run(
            document,
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            },
          )
        ).violations,
    );
    expect(
      violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
});
