import { expect, type Page } from "@playwright/test";

/**
 * Selects the composer's Plan calculation mode (UI-1 2A). Plan defaults to the scoped PySCF energy
 * proposal whenever the server resolves a saved structure version; the general planner (find, draft or
 * import structures, extract figures) is an explicit opt-in, and without a version it is the only way
 * to send (UI-1 pass 4). `general: true` reproduces the general planning request these specs used.
 */
export async function choosePlanMode(page: Page, { general }: { general: boolean }) {
  if (general) {
    const generalToggle = page.getByTestId("ai-plan-general");
    if (!(await generalToggle.isVisible())) {
      await page.getByTestId("ai-composer-options").click();
    }
    await generalToggle.check();
  }
  await expect(page.getByTestId("ai-prepare-calculation-button")).toBeVisible({ timeout: 40_000 });
}

export type AiPanelTab = "chat" | "tools" | "evidence" | "runs" | "settings";

/**
 * Opens an AI Scientist panel tab. Chat, Evidence and Runs are always in the tab row; Tools and Settings sit behind the
 * overflow menu and join the row while they are the active tab.
 */
export async function openAiPanelTab(page: Page, tab: AiPanelTab) {
  const button = page.getByTestId(`ai-nav-${tab}`);
  if ((tab === "tools" || tab === "settings") && !(await button.isVisible())) {
    await page.getByTestId("ai-nav-more").click();
    await page.getByTestId(`ai-menu-${tab}`).click();
  } else await button.click();
  await expect(button).toHaveAttribute("aria-selected", "true");
}
