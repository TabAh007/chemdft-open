import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { mockAi } from "./ai-context-mock";

const URL = "/en/projects/00000000-0000-4000-8000-0000000000a1/jobs";
const OUTPUT_DIR = resolve(process.cwd(), "../../output");

async function openPage(page: Page, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(URL);
  await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-testid="ai-prompt-input"], [data-testid="ai-approval-card"]')).toBeVisible({ timeout: 60_000 });
}

test.describe("0.0.60 Impeccable UI Review & E2E Validation", () => {
  test.setTimeout(120_000);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  test("Desktop viewports (1280, 1440, 1920): no overflow and clean layout", async ({ page }) => {
    await mockAi(page, { emptyInventory: true });
    for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080]] as const) {
      await openPage(page, w, h);
      const doc = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        sh: document.documentElement.scrollHeight,
        ch: document.documentElement.clientHeight,
      }));
      expect(doc.sw, `No horizontal overflow at ${w}x${h}`).toBeLessThanOrEqual(doc.cw + 1);
      expect(doc.sh, `No vertical page overflow at ${w}x${h}`).toBeLessThanOrEqual(doc.ch + 1);

      await page.screenshot({ path: resolve(OUTPUT_DIR, `0.0.60-desktop-${w}.png`) });
    }
  });

  test("AI Dock widths (340, 379, 460) at 1440x900", async ({ page }) => {
    await mockAi(page, { emptyInventory: true });
    await openPage(page, 1440, 900);

    for (const dockW of [340, 379, 460]) {
      await page.evaluate((w) => {
        document.documentElement.style.setProperty("--guided-dock-w", `${w}px`);
        document.documentElement.style.setProperty("--cdf-dock-w", `${w}px`);
      }, dockW);

      await page.waitForTimeout(200);

      // Verify prompt input and ask button remain reachable and aligned
      await expect(page.getByTestId("ai-prompt-input")).toBeVisible();
      await expect(page.getByTestId("ai-ask-button")).toBeVisible();

      await page.screenshot({ path: resolve(OUTPUT_DIR, `0.0.60-dock-${dockW}.png`) });
    }
  });

  test("Periodic proposal approval card rendering and source badge", async ({ page }) => {
    const periodicApproval = {
      id: "approval-periodic-test",
      run_id: "run-periodic-test",
      project_id: "00000000-0000-4000-8000-0000000000a1",
      tool_name: "calculation.submit",
      tool_version: "1.0.0",
      action_fingerprint: "exact-fp-periodic",
      scientific_summary: "Periodic calculation proposal for crystal structure. (settings source: copied from calculation calc-qe-1)",
      reason: "Plan periodic calculation for Cr2O3",
      status: "PENDING",
      expires_at: "2099-01-01T00:00:00Z",
      created_at: "2026-11-15T00:00:00Z",
      normalized_arguments: {
        structure_version: { entity_id: "00000000-0000-4000-8000-0000000000e5", project_id: "00000000-0000-4000-8000-0000000000a1" },
        specification: {
          charge: 0,
          multiplicity: 1,
          task_type: "PERIODIC_ENERGY",
          engine_preference: { engine: "qe" },
          method: { identifier: "pbe" },
          basis: { identifier: "sssp_efficiency" },
          periodic: {
            k_mesh: [4, 4, 4],
            ecutwfc_ry: 50.0,
            ecutrho_ry: 400.0,
            pseudopotential_family: "sssp_efficiency",
            spin_polarized: true,
            magnetic_ordering: "AFM",
            hubbard_u: { Cr: 3.5 },
          },
        },
      },
      proposal_provenance: { provider: "mock", model: "mock-model", eligibility: "STANDARD", repair_attempts: 0 },
      request_match: [],
    };

    const runPeriodic = {
      id: "run-periodic-test",
      status: "WAITING_FOR_APPROVAL",
      pending_approval: periodicApproval,
      steps: [{ step_type: "APPROVAL_REQUEST", status: "PENDING", tool_name: "calculation.submit" }],
      created_at: "2026-11-15T00:00:00Z",
      updated_at: "2026-11-15T00:00:00Z",
      events: [],
    };

    await mockAi(page, { emptyInventory: true, latestRun: runPeriodic });

    await openPage(page, 1440, 900);

    // Wait for the approval card to appear
    await expect(page.getByTestId("ai-approval-card")).toBeVisible();
    await expect(page.getByTestId("ai-periodic-settings-source")).toContainText("copied from calculation calc-qe-1");

    await page.screenshot({ path: resolve(OUTPUT_DIR, "0.0.60-periodic-proposal-card.png") });
  });

  test("Structure edit proposal approval card rendering and diff notice", async ({ page }) => {
    const editApproval = {
      id: "approval-edit-test",
      run_id: "run-edit-test",
      project_id: "00000000-0000-4000-8000-0000000000a1",
      tool_name: "structure.edit.propose",
      tool_version: "1.0.0",
      action_fingerprint: "exact-fp-edit",
      scientific_summary: "Propose structure edit: add atom O, remove atom H",
      reason: "User requested structure modification",
      status: "PENDING",
      expires_at: "2099-01-01T00:00:00Z",
      created_at: "2026-11-15T00:00:00Z",
      normalized_arguments: {
        structure_version_id: "00000000-0000-4000-8000-0000000000e5",
        operations: [
          { op_type: "add_atom", element: "O", coordinates: [0.0, 1.2, 0.0] },
          { op_type: "remove_atom", index: 1 },
        ],
        diff: {
          parent_version_id: "00000000-0000-4000-8000-0000000000e5",
          formula_before: "H2O",
          formula_after: "O2",
          atom_count_before: 3,
          atom_count_after: 2,
          atoms_added: [{ index: 2, element: "O", coordinates: [0.0, 1.2, 0.0] }],
          atoms_removed: [{ index: 1, element: "H", coordinates: [0.0, 0.0, 1.0] }],
          atoms_moved: [],
          elements_replaced: [],
          min_distance_before: 0.96,
          min_distance_after: 1.2,
          distance_warnings: [],
        },
      },
      proposal_provenance: { provider: "mock", model: "mock-model", eligibility: "STANDARD", repair_attempts: 0 },
      request_match: [],
    };

    const runEdit = {
      id: "run-edit-test",
      status: "WAITING_FOR_APPROVAL",
      pending_approval: editApproval,
      steps: [{ step_type: "APPROVAL_REQUEST", status: "PENDING", tool_name: "structure.edit.propose" }],
      created_at: "2026-11-15T00:00:00Z",
      updated_at: "2026-11-15T00:00:00Z",
      events: [],
    };

    await mockAi(page, { emptyInventory: true, latestRun: runEdit });

    await openPage(page, 1440, 900);

    // Wait for the approval card to appear
    await expect(page.getByTestId("ai-approval-card")).toBeVisible();
    await expect(page.getByTestId("ai-structure-edit-immutability-notice")).toContainText("Committed versions are immutable; approving creates a new AI-proposed version (unverified). Parent version is unchanged.");
    await expect(page.getByTestId("ai-structure-edit-distance-ok")).toBeVisible();
    await expect(page.getByTestId("ai-structure-edit-added-atom")).toContainText("Add O at [0.000, 1.200, 0.000]");
    await expect(page.getByTestId("ai-structure-edit-removed-atom")).toContainText("Remove atom #1 (H)");
    await expect(page.getByTestId("ai-approve-button")).toContainText("Approve and create new structure version");

    await page.screenshot({ path: resolve(OUTPUT_DIR, "0.0.60-structure-edit-card.png") });
  });
});
