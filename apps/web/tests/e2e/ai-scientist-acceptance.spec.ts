import { expect, test } from "@playwright/test";

const question = "Is the structure shown in Figure 2 authoritative?";

test("Figure 2 evidence submission updates the conversation, Evidence Desk, and narrow layouts", async ({ page }) => {
  const projectId = process.env.CHEMDFT_ACCEPTANCE_PROJECT_ID;
  test.skip(!projectId, "Set CHEMDFT_ACCEPTANCE_PROJECT_ID to an existing indexed project.");

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/en/projects/${projectId}/workspace`);
  await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("ai-prompt-input")).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByText("Initializing project-scoped AI Scientist…")).toBeHidden({ timeout: 20_000 });

  const oldAnswers = await page.getByTestId("ai-message-assistant").count();
  const oldUserMessages = await page.getByTestId("ai-message-user").count();
  const input = page.getByTestId("ai-prompt-input");
  const ask = page.getByTestId("ai-ask-button");
  await input.fill(question);
  await page.route("**/ai/conversations/*/messages", async (route) => {
    const body = route.request().postDataJSON() as { content?: string; mode?: string };
    if (body.content === question && body.mode === "EVIDENCE") {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    await route.continue();
  });
  await ask.click();
  await expect(page.getByTestId("ai-pending-message")).toContainText(question);
  await expect(page.getByTestId("ai-pending-message")).toBeVisible();
  await expect(page.getByTestId("ai-working-state")).toContainText("Question submitted");
  await expect(ask).toBeDisabled();
  await expect(input).toHaveValue("");

  await expect(page.getByTestId("ai-pending-message")).toBeHidden({ timeout: 20_000 });
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("ai-message-user").last()).toContainText(question);
  const newestAnswer = page.getByTestId("ai-message-assistant").last();
  await expect(newestAnswer).toContainText("SUPPORTED");
  await expect(newestAnswer).toContainText("hypoth etical");
  await expect(newestAnswer).toContainText("no committed StructureVersion");
  await expect(newestAnswer).toContainText("cannot be used for calculation");
  await expect(newestAnswer.getByRole("button", { name: "Open evidence E1" })).toBeVisible();
  await expect(newestAnswer.getByRole("button", { name: "Open project record P1" })).toBeVisible();
  await expect(newestAnswer.getByTestId("citation-chip")).toHaveCount(2);
  await expect(page.getByTestId("ai-message-assistant")).toHaveCount(oldAnswers + 1);
  await expect(page.getByTestId("ai-message-user")).toHaveCount(oldUserMessages + 1);
  await page.getByTestId("ai-scientist-panel").screenshot({ path: "test-results/ai-scientist-panel-wide.png" });
  await newestAnswer.screenshot({ path: "test-results/figure-2-supported-answer.png" });

  const evidenceDesk = page.getByTestId("workspace-evidence");
  await expect(evidenceDesk.getByTestId("evidence-status")).toContainText("SUPPORTED");
  await expect(evidenceDesk.getByTestId("evidence-card").first()).toContainText("E1");
  await expect(evidenceDesk.getByTestId("evidence-project-record")).toContainText("P1");
  await evidenceDesk.screenshot({ path: "test-results/evidence-desk-newest-answer.png" });

  const failedQuestion = "Keyboard submission preserves edits after a failure";
  const failedQuestionWithNewline = `${failedQuestion.slice(0, 24)}\n${failedQuestion.slice(24)}`;
  await page.route("**/ai/conversations/*/messages", async (route) => {
    const body = route.request().postDataJSON() as { content?: string; mode?: string };
    if (body.content === failedQuestionWithNewline && body.mode === "EVIDENCE") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Controlled acceptance failure" }),
      });
      return;
    }
    await route.fallback();
  });
  await input.fill(failedQuestion.slice(0, 24));
  await input.press("Shift+Enter");
  await input.type(failedQuestion.slice(24));
  await expect(input).toHaveValue(failedQuestionWithNewline);
  await input.press("Enter");
  await expect(page.getByTestId("ai-submit-error")).toBeVisible();
  await expect(input).toHaveValue(failedQuestionWithNewline);
  await expect(input).toBeFocused();
  await expect(page.getByTestId("ai-message-user")).toHaveCount(oldUserMessages + 1);

  for (const width of [1600, 1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".ai-scientist-panel")!;
      const controls = [...document.querySelectorAll<HTMLElement>(".ai-investigation-heading, .ai-investigation-create")];
      const button = document.querySelector<HTMLElement>("[data-testid='ai-ask-button']")!;
      const chips = [...document.querySelectorAll<HTMLElement>(".citation-chip")];
      const overlaps = controls.some((item, index) => controls.slice(index + 1).some((other) => {
        const a = item.getBoundingClientRect();
        const b = other.getBoundingClientRect();
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      }));
      return {
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
        panelOverflow: panel.scrollWidth > panel.clientWidth,
        controlsOverlap: overlaps,
        buttonVisible: button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().right <= panel.getBoundingClientRect().right + 1,
        chipsFit: chips.every((chip) => chip.getBoundingClientRect().right <= panel.getBoundingClientRect().right + 1),
      };
    });
    expect(layout, `layout at ${width}px`).toMatchObject({
      pageOverflow: false,
      panelOverflow: false,
      controlsOverlap: false,
      buttonVisible: true,
      chipsFit: true,
    });
    if (width === 1024) {
      await page.getByTestId("ai-input-dock").screenshot({ path: "test-results/ai-scientist-composer-narrow.png" });
    }
  }

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByTestId("ai-scientist-panel").screenshot({ path: "test-results/ai-scientist-panel-narrow.png" });
  await page.getByTestId("ai-investigation-strip").screenshot({ path: "test-results/investigation-header.png" });
  await page.getByTestId("ai-citations-list").last().screenshot({ path: "test-results/figure-2-mixed-citations.png" });
  await page.screenshot({ path: "test-results/ai-scientist-acceptance-wide.png", fullPage: true });
  await page.getByRole("button", { name: "Hide Explorer" }).click();
  await page.getByRole("button", { name: "Show Explorer" }).waitFor({ state: "visible" });
  await page.screenshot({ path: "test-results/ai-scientist-acceptance-explorer-collapsed.png", fullPage: true });
});
