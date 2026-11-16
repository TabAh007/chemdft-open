import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

const artifacts = resolve("../../output/pf6-review");
const password = "pf6-controlled-fixture-password";
const users = ["new", "returning", "foreign"];
const pid = "00000000-0000-4000-8000-0000000000aa";
async function signIn(page: Page, who = "new", next?: string) {
  await page.goto(
    `/en/login${next ? `?next=${encodeURIComponent(next)}` : ""}`,
  );
  await page.getByTestId("login-email").fill(`pf6-${who}@example.test`);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function capture(page: Page, name: string, fullPage = false) {
  await expect(page.locator(".state-code")).toHaveCount(0);
  if (fullPage) {
    await page.mouse.click(5, 80);
    await page.mouse.move(5, 150);
    await page.mouse.wheel(0, -50000);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.waitForTimeout(200);
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
async function audit(page: Page, selector = "main") {
  await expect(page.locator(".state-code")).toHaveCount(0);
  await page.addScriptTag({ content: axe.source });
  const failures = await page.evaluate(
    async (scope) =>
      (
        await (window as typeof window & { axe: typeof axe }).axe.run(scope, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
    selector,
  );
  expect(failures).toEqual([]);
}

test.beforeAll(async ({ request }) => {
  mkdirSync(artifacts, { recursive: true });
  await request.get("/api/auth/ok");
  for (const who of users) {
    try {
      execFileSync(
        "pnpm",
        [
          "exec",
          "tsx",
          "scripts/create-controlled-user.ts",
          "--email",
          `pf6-${who}@example.test`,
          "--name",
          `PF6 ${who}`,
        ],
        {
          env: {
            ...process.env,
            CHEMDFT_AUTH_MODE: "jwt",
            BETTER_AUTH_SECRET: process.env.CHEMDFT_E2E_ONBOARD_AUTH_SECRET,
            BETTER_AUTH_URL: "http://127.0.0.1:3106",
            CHEMDFT_AUTH_DATABASE_URL:
              "file:/tmp/chemdft-e2e-onboarding-users.db",
            CHEMDFT_NEW_USER_PASSWORD: password,
          },
          stdio: "pipe",
        },
      );
    } catch (error) {
      if (
        !String((error as { stderr?: Buffer }).stderr).includes(
          "An account with this email already exists.",
        )
      )
        throw error;
    }
  }
});

test("anonymous welcome is denied; signup stays closed; public learning has a closed catalogue and locale fallback", async ({
  page,
  request,
}) => {
  await page.goto("/de/welcome?path=molecule");
  await expect(page).toHaveURL(/\/de\/login\?next=/);
  await expect(page.getByTestId("signup-closed")).toBeVisible();
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        headers: { origin: "http://127.0.0.1:3106" },
        data: {
          email: "not-allowed@example.test",
          password,
          name: "Not allowed",
        },
      })
    ).status(),
  ).toBe(400);
  await page.goto("/de/learn");
  await expect(
    page.getByRole("heading", { name: "Learn ChemDFT", exact: true }),
  ).toBeVisible();
  const links = await page.locator("main a[data-learn-topic]").all();
  expect(links.length).toBe(16);
  const guides = await page.locator("main a[data-learn-guide]").all();
  expect(guides.length).toBe(3);
  for (const link of [...links, ...guides])
    expect(
      (await request.get((await link.getAttribute("href"))!)).status(),
    ).toBe(200);
  expect((await request.get("/en/learn/unknown")).status()).toBe(404);
  expect((await request.get("/api/chemdft/v1/projects")).status()).toBe(401);
});

test("no-project user reaches optional welcome; all six paths create nothing and examples do not auto-copy", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await expect(page).toHaveURL(/\/en\/welcome$/);
  await expect(page.locator("[data-welcome-path]")).toHaveCount(6);
  await capture(page, "01-welcome-desktop.png", false);
  await capture(page, "02-six-paths-desktop.png");
  for (const path of [
    "molecule",
    "calculation",
    "experimental",
    "compare",
    "unsure",
  ]) {
    await page.locator(`[data-welcome-path="${path}"]`).click();
    expect(
      await (await page.request.get("/api/chemdft/v1/projects")).json(),
    ).toEqual([]);
  }
  await page.locator('[data-welcome-path="examples"]').click();
  await expect(page).toHaveURL(/\/en\/examples$/);
  await expect(
    page.getByRole("link", { name: "Open example", exact: true }),
  ).toHaveCount(3);
  expect(
    await (await page.request.get("/api/chemdft/v1/projects")).json(),
  ).toEqual([]);
  await page.goto("/en/welcome");
  await page.getByRole("link", { name: "Go to projects", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/projects\?welcome=skip$/);
  await expect(
    page.getByRole("heading", { name: "No projects yet" }),
  ).toBeVisible();
  await page.getByTestId("new-project-toggle-btn").click();
  await expect(page).toHaveURL(/\/en\/welcome$/);
  await audit(page);
});

test("two deterministic questions preserve crystal/experiment/molecular distinctions and genuine ambiguity with AI forbidden", async ({
  page,
}) => {
  let aiRequests = 0;
  await page.route(
    /\/api\/chemdft\/.*\/(?:ai|investigations|chat|explain)(?:\/|$)/,
    (route) => {
      aiRequests++;
      return route.abort();
    },
  );
  await signIn(page, "new", "/en/welcome");
  await page.locator('[data-welcome-path="unsure"]').click();
  await page.mouse.move(20, 700); await page.mouse.wheel(0, 800); await page.waitForTimeout(250);
  await capture(page, "03-helper-question-desktop.png");
  await page.locator('[data-onboarding-have="nothing"]').click();
  await page.locator('[data-onboarding-goal="compare"]').click();
  await expect(
    page
      .getByTestId("recommendation")
      .getByRole("button", { name: /Choose this goal/ }),
  ).toHaveCount(2);
  await page.mouse.wheel(0, 800); await page.waitForTimeout(250);
  await capture(page, "04-helper-recommendation-desktop.png");
  await page.getByRole("button", { name: "Change answers" }).click();
  await page.locator('[data-onboarding-have="crystal"]').click();
  await expect(page.locator("[data-onboarding-goal]")).toHaveCount(1);
  await page.locator('[data-onboarding-goal="crystal"]').click();
  await expect(page.getByTestId("recommendation")).toContainText(
    "single-point periodic PBE or PBE+U",
  );
  await page.getByRole("button", { name: "Change answers" }).click();
  await page.locator('[data-onboarding-have="spectrum"]').click();
  await expect(page.locator("[data-onboarding-goal]")).toHaveCount(2);
  await page.locator('[data-onboarding-goal="compare"]').click();
  await page.getByRole("button", { name: /Choose this goal/ }).click();
  await expect(page.getByTestId("project-destination")).toContainText(
    "Analyze experimental data",
  );
  expect(
    await (await page.request.get("/api/chemdft/v1/projects")).json(),
  ).toEqual([]);
  expect(aiRequests).toBe(0);
});

test("returning history is not forced; explicit creation makes one normal owner project and hands off to real Navigator", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "returning");
  const me = await (await page.request.get("/api/chemdft/v1/me")).json();
  const prior = await (
    await page.request.post("/api/chemdft/v1/projects", {
      data: { name: "Existing research", slug: "existing-research" },
    })
  ).json();
  await page.goto("/en/projects");
  await expect(page).toHaveURL(/\/en\/projects$/);
  await expect(
    page.getByRole("link", { name: /Existing research/ }),
  ).toBeVisible();
  await capture(page, "08-returning-entry-desktop.png");
  await page.getByTestId("new-project-toggle-btn").click();
  await page.locator('[data-welcome-path="compare"]').click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Confirmed PF6 comparison");
  expect(
    (await (await page.request.get("/api/chemdft/v1/projects")).json()).length,
  ).toBe(1);
  await page.mouse.move(20, 700); await page.mouse.wheel(0, 800); await page.waitForTimeout(250);
  await capture(page, "13-before-confirmation-desktop.png");
  await page
    .getByRole("button", { name: "Create project and continue" })
    .click();
  await expect(page).toHaveURL(/\/overview\?navigator_goal=compare$/);
  const project = (
    await (await page.request.get("/api/chemdft/v1/projects")).json()
  ).find((p: { id: string }) => p.id !== prior.id);
  expect(project).toMatchObject({
    organization_id: me.organization.id,
    role: "owner",
    name: "Confirmed PF6 comparison",
  });
  const state = await (
    await page.request.get(
      `/api/chemdft/v1/projects/${project.id}/navigator?goal=compare`,
    )
  ).json();
  expect(state.have).toEqual([]);
  expect(state.facts_summary.running_jobs).toBe(0);
  await expect(
    page.getByTestId("project-navigator").getByLabel("Goal", { exact: true }),
  ).toHaveValue("compare");
  await expect(
    page.locator('[data-reason-code="experimental_spectrum_required"]').first(),
  ).toBeVisible();
  await capture(page, "14-created-project-navigator-desktop.png");
  await page
    .locator('[data-help-trigger="spectra.experimental"]')
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture(page, "05-context-help-desktop.png", false);
  await audit(page, '[role="dialog"]');
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator('[data-help-trigger="spectra.experimental"]').first(),
  ).toBeFocused();
  const returnPath = new URL(page.url()).pathname + new URL(page.url()).search;
  await page
    .locator('[data-help-trigger="spectra.experimental"]')
    .first()
    .click();
  await page.getByRole("link", { name: "Learn more", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Experimental spectra and association",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Return to workspace" }),
  ).toHaveAttribute("href", returnPath);
});

test("all project-producing paths resolve real server actions and existing read-only work stays guarded", async ({
  page,
  browser,
}) => {
  await signIn(page, "returning", "/en/welcome");
  const projects = await (
    await page.request.get("/api/chemdft/v1/projects")
  ).json();
  const owned = projects[0];
  for (const [path, launch] of [
    ["molecule", "navigator_action=structure.draw"],
    ["calculation", "navigator_action=evidence.import_calculation"],
    ["experimental", "navigator_action=spectra.upload_experimental"],
  ] as const) {
    await page.goto(`/de/welcome?path=${path}`);
    await page
      .getByTestId("project-destination")
      .getByLabel("Which project?", { exact: true })
      .selectOption(owned.id);
    await page
      .getByRole("button", { name: "Continue in this project" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(
        `/de/projects/${owned.id}/workspace\\?.*${launch.replace(".", "\\.")}`,
      ),
    );
    if (path === "calculation") await expect(page.getByRole("dialog", { name: "Import calculation", exact: true })).toBeVisible();
    if (path === "experimental") await expect(page.getByTestId("import-spectrum-dialog")).toBeVisible();
  }
  expect(
    (await (await page.request.get("/api/chemdft/v1/projects")).json()).length,
  ).toBe(projects.length);
  const foreign = await browser.newContext();
  const other = await foreign.newPage();
  await signIn(
    other,
    "foreign",
    `/en/projects/${owned.id}/overview?navigator_goal=compare`,
  );
  const denied = await other.request.get(
    `/api/chemdft/v1/projects/${owned.id}/navigator?goal=compare`,
  );
  expect([403, 404]).toContain(denied.status());
  expect(
    await (await other.request.get("/api/chemdft/v1/projects")).json(),
  ).toEqual([]);
  await foreign.close();
});

test("creation response uncertainty cannot produce duplicate projects; failed guidance recovers to created Navigator", async ({
  page,
}) => {
  await signIn(page, "returning", "/en/welcome?path=compare");
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Guidance failure recovery");
  let creations = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/v1/projects"))
      creations++;
  });
  await page.route("**/v1/projects/*/navigator?**", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page
    .getByRole("button", { name: "Create project and continue" })
    .click();
  await expect(
    page.getByTestId("project-destination").getByRole("alert"),
  ).toContainText("no second project");
  await expect(
    page.getByRole("button", { name: "Create project and continue" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open Project Navigator" }),
  ).toHaveAttribute("href", /\/overview\?navigator_goal=compare$/);
  expect(creations).toBe(1);
});

test("a lost creation response recovers the committed boundary instead of creating an orphan duplicate", async ({
  page,
}) => {
  await signIn(page, "returning", "/en/welcome?path=compare");
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Lost response recovery");
  const before = (
    await (await page.request.get("/api/chemdft/v1/projects")).json()
  ).length;
  let creations = 0;
  await page.route("**/v1/projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    creations++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Create project and continue" })
    .click();
  await expect(page).toHaveURL(/\/overview\?navigator_goal=compare$/);
  expect(
    (await (await page.request.get("/api/chemdft/v1/projects")).json()).length,
  ).toBe(before + 1);
  expect(creations).toBe(1);
});

test("keyboard help escapes and returns context without focus trapping; public learn never discloses private facts", async ({
  page,
}) => {
  await signIn(page, "returning", "/en/welcome?path=molecule");
  const trigger = page.locator('[data-help-trigger="provenance.authority"]');
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close help" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Learn more" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("dialog")).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const context = `/de/projects/${pid}/workspace?navigator_version=${pid}&navigator_goal=ir&source=original`;
  await page.goto(
    `/de/learn/calculation.frequency?return_to=${encodeURIComponent(context)}`,
  );
  await expect(
    page.getByRole("link", { name: "Return to workspace" }),
  ).toHaveAttribute("href", context);
  expect(await page.content()).not.toContain("Confirmed PF6 comparison");
  await page.goto(
    "/de/learn/calculation.frequency?return_to=https://evil.test",
  );
  await expect(
    page.getByRole("link", { name: "Return to workspace" }),
  ).toHaveCount(0);
});

test("desktop learn and mobile welcome/helper/help/topic are readable, touch usable and accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/en/learn");
  await capture(page, "06-learn-index-desktop.png");
  await audit(page);
  await page.goto("/en/learn/calculation.frequency");
  await capture(page, "07-learn-topic-desktop.png");
  await audit(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "new", "/en/welcome");
  await capture(page, "09-welcome-mobile.png");
  await noOverflow(page);
  for (const action of await page.locator("[data-welcome-path]").all())
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.locator('[data-welcome-path="unsure"]').click();
  await page.locator('[data-onboarding-have="molecule"]').click();
  await page.locator('[data-onboarding-goal="thermochemistry"]').click();
  await page.mouse.move(8, 550); await page.mouse.wheel(0, 1200); await page.waitForTimeout(250);
  await capture(page, "10-helper-mobile.png");
  await noOverflow(page);
  await page.getByRole("button", { name: /Choose this goal/ }).click();
  const trigger = page.locator('[data-help-trigger="provenance.authority"]');
  await expect(trigger).toBeVisible();
  expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await trigger.tap();
  await expect(page.getByRole("dialog")).toBeVisible();
  const box = (await page.getByRole("dialog").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await capture(page, "11-help-mobile.png", false);
  await audit(page, '[role="dialog"]');
  await page.getByRole("button", { name: "Close help" }).tap();
  await page.goto("/en/learn/thermochemistry.frequency_requirement");
  await capture(page, "12-learn-topic-mobile.png");
  await audit(page);
  await noOverflow(page);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 650);
  await expect(
    page
      .getByRole("link", { name: "Choose a starting path", exact: true })
      .last(),
  ).toBeInViewport();
});
