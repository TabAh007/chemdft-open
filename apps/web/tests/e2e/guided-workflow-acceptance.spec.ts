import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { openGuidedElectronicResult, preferGuidedMode } from "./guided-helpers";

/**
 * Guided journey acceptance against the real API and database (disposable evidence stack; no worker; nothing is
 * submitted). The journey is: Projects → open a project → Guided home → Structure → Configure → Review → published
 * results → Advanced and back. The AI Scientist part asks real questions, so it runs only when
 * CHEMDFT_E2E_AI_QUESTIONS=1 (deterministic fake provider or an explicitly authorized one).
 */

const WATER_PROJECT_ID = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
const WATER_PROJECT_NAME = /Electronic structure acceptance — water/;
const OUTPUT_DIR = "../../output/guided-workflow/acceptance";
const ASK_AI = process.env.CHEMDFT_E2E_AI_QUESTIONS === "1";

async function criticalAxeViolations(page: Page) {
  await page.evaluate(axe.source);
  const results = await page.evaluate(async () =>
    (window as unknown as { axe: typeof axe }).axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }),
  );
  console.log(`Axe violations found: ${results.violations.length}`);
  for (const violation of results.violations) {
    console.log(`- [${violation.impact}] ${violation.id}: ${violation.description} (nodes: ${violation.nodes.length})`);
  }
  return results.violations.filter((v: axe.Result) => v.impact === "critical");
}

test.describe("Guided ChemDFT journey", () => {
  test.setTimeout(150_000);

  test("projects → Guided home → Structure → Configure → Review → results → Advanced and back", async ({ page, request }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("PAGE ERROR LOG:", msg.text());
    });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await preferGuidedMode(page);

    // 1. The project list is the entry point; a project opens into its Guided workspace
    await page.goto("/en/projects");
    await expect(page.getByText("Loading projects")).toBeHidden({ timeout: 15_000 });
    await page.screenshot({ path: `${OUTPUT_DIR}/01-projects.png` });
    await page.getByRole("link", { name: WATER_PROJECT_NAME }).first().click();
    await page.goto(`/en/projects/${WATER_PROJECT_ID}/workspace`);

    // 2. Guided home: one recommended next action and the project's identity
    const modeToggle = page.getByTestId("workspace-mode-toggle");
    await expect(modeToggle).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("mode-toggle-guided")).toHaveAttribute("aria-pressed", "true");
    const projectHome = page.getByTestId("guided-project-home");
    await expect(projectHome).toBeVisible({ timeout: 25_000 });
    await expect(projectHome).toContainText(/recommended next action/i);
    await expect(projectHome).toContainText("Charge: 0");
    await expect(projectHome).toContainText("Multiplicity: 1");
    await page.screenshot({ path: `${OUTPUT_DIR}/05-guided-project-home.png` });

    // The Project Navigator is a collapsed disclosure, mounted only when opened
    const navigator = page.getByTestId("guided-navigator-details");
    await expect(navigator).toBeVisible();
    await expect(page.getByTestId("project-navigator")).toHaveCount(0);

    // 3. Structure stage: committed structure, scientific-review state, electronic-state inputs
    await page.getByTestId("guided-nav-structure").click();
    const structureView = page.getByTestId("guided-structure-view");
    await expect(structureView).toBeVisible({ timeout: 20_000 });
    await expect(structureView).toContainText("Not reviewed");
    await expect(page.getByTestId("guided-stages")).toContainText("Structure");
    await expect(page.getByTestId("guided-stages")).toContainText("Configure");
    await expect(page.getByTestId("guided-stages")).toContainText("Review & Submit");
    await page.screenshot({ path: `${OUTPUT_DIR}/06-guided-water-structure.png` });

    // Configure and Review are not reachable until the electronic-state inputs are confirmed
    const confirmInputs = page.getByTestId("guided-primary-confirm-inputs");
    await expect(confirmInputs).toBeVisible();
    await confirmInputs.click();
    await page.getByTestId("guided-primary-to-configure").click();

    // 4. Configure: calculation family, engine availability from the capability contract
    await expect(page.getByTestId("guided-calculation-setup")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("guided-engine-pyscf-btn")).toBeVisible();
    await expect(page.getByTestId("guided-engine-xtb-btn")).toBeVisible();
    await page.screenshot({ path: `${OUTPUT_DIR}/07-configure.png` });

    // 5. Review & Submit: the exact configuration; submission needs the researcher's explicit confirmation
    await page.getByTestId("guided-primary-to-review").click();
    await expect(page.getByTestId("guided-review-stage")).toBeVisible();
    await expect(page.getByTestId("review-configuration")).toBeVisible();
    const submit = page.getByTestId("run-calculation-btn");
    await expect(submit).toBeDisabled();
    await expect(page.getByTestId("setup-confirm-checkbox")).not.toBeChecked();
    await page.screenshot({ path: `${OUTPUT_DIR}/15-review.png` });

    // Going back never discards the draft
    await page.getByTestId("guided-stage-configure").click();
    await expect(page.getByTestId("guided-calculation-setup")).toBeVisible();
    await page.getByTestId("guided-stage-review").click();
    await expect(submit).toBeDisabled();

    // 6. Published results are read from the stored records
    await openGuidedElectronicResult(page);
    const resultView = page.getByTestId("guided-result-view");
    await expect(resultView).toContainText("Electronic structure");
    await expect(resultView).toContainText("HF / STO-3G");
    await expect(resultView).toContainText("-74.9629");
    await page.screenshot({ path: `${OUTPUT_DIR}/12-electronic-structure.png` });
    await page.getByTestId("tab-electron-density").click();
    await expect(resultView).toContainText("Valence electron distribution");
    await page.screenshot({ path: `${OUTPUT_DIR}/13-electron-density.png` });

    // 7. The project goals on Guided home lead into Configure with the family preselected
    await page.getByTestId("guided-nav-overview").click();
    await page.getByTestId("guided-goal-opt").click();
    await expect(page.getByTestId("guided-workspace")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("guided-stage-configure").click();
    await expect(page.getByTestId("guided-calculation-setup")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("guided-family")).toHaveValue(/opt/i);

    // 8. Advanced Workbench keeps the explorer; Guided keeps the draft
    const advancedBtn = page.getByTestId("mode-toggle-advanced");
    await advancedBtn.click();
    await expect(page.getByTestId("project-explorer-panel")).toBeVisible();
    await page.screenshot({ path: `${OUTPUT_DIR}/16-advanced-workbench.png` });
    await modeToggle.screenshot({ path: `${OUTPUT_DIR}/17-guided-vs-advanced-comparison.png` });
    await page.getByTestId("mode-toggle-guided").click();
    await page.getByTestId("guided-nav-calculations").click();
    await page.getByTestId("guided-stage-configure").click();
    await expect(page.getByTestId("guided-family")).toHaveValue(/opt/i);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUTPUT_DIR}/18-responsive-1024.png` });

    // 9. Accessibility: no critical WCAG failure in the Guided workspace or on the welcome page
    expect(await criticalAxeViolations(page)).toHaveLength(0);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const projectsBefore = ((await (await request.get("/api/chemdft/v1/projects")).json()) as unknown[]).length;
    await page.goto("/en/welcome");
    await expect(page.getByRole("heading", { name: "Where would you like to begin?" })).toBeVisible();
    await page.screenshot({ path: `${OUTPUT_DIR}/03-welcome.png` });
    expect(await criticalAxeViolations(page)).toHaveLength(0);
    expect(((await (await request.get("/api/chemdft/v1/projects")).json()) as unknown[]).length).toBe(projectsBefore);
  });

  test("AI Scientist answers in the context of the structure and the result", async ({ page }) => {
    test.skip(!ASK_AI, "Asks real AI questions; set CHEMDFT_E2E_AI_QUESTIONS=1 against the fake or an authorized provider.");
    await page.setViewportSize({ width: 1600, height: 1000 });
    await preferGuidedMode(page);
    await page.goto(`/en/projects/${WATER_PROJECT_ID}/workspace`);
    await page.getByTestId("guided-nav-structure").click();
    await expect(page.getByTestId("guided-structure-view")).toBeVisible({ timeout: 20_000 });

    const aiPanel = page.getByTestId("ai-scientist-panel");
    if (!(await aiPanel.isVisible())) await page.getByTestId("ai-dock-toggle").click();
    await expect(aiPanel).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("ai-current-context-header")).toContainText(/water/i);
    await page.screenshot({ path: `${OUTPUT_DIR}/08-ai-scientist-clean-idle-state.png` });

    const input = page.getByTestId("ai-prompt-input");
    const ask = page.getByTestId("ai-ask-button");
    await input.fill("What am I looking at?");
    let releaseMessage: () => void = () => {};
    const messageGate = new Promise<void>((resolve) => { releaseMessage = resolve; });
    await page.route("**/ai/conversations/*/messages", async (route) => {
      await messageGate;
      await route.continue();
    });
    await ask.click();
    await expect(page.getByTestId("ai-working-state")).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: `${OUTPUT_DIR}/09-ai-scientist-working-state.png` });
    releaseMessage();
    await page.unrouteAll({ behavior: "ignoreErrors" });

    await expect(page.getByTestId("ai-working-state")).toBeHidden({ timeout: 30_000 });
    const answer = page.getByTestId("ai-message-assistant").last();
    await expect(answer).toBeVisible();
    await expect(answer).toContainText(/water/i);
    await expect(answer).not.toContainText("INSUFFICIENT PROJECT EVIDENCE");
    await expect(answer.getByTestId("citation-chip").first()).toBeVisible();
    await page.screenshot({ path: `${OUTPUT_DIR}/10-what-am-i-looking-at-answer.png` });

    await input.fill("What can I do next?");
    await ask.click();
    await expect(page.getByTestId("ai-working-state")).toBeHidden({ timeout: 30_000 });
    const next = page.getByTestId("ai-message-assistant").last();
    await expect(next.getByTestId("ai-typed-actions-bar")).toBeVisible();
    await next.getByTestId("ai-typed-actions-bar").screenshot({ path: `${OUTPUT_DIR}/11-ai-typed-action-buttons.png` });
  });
});
