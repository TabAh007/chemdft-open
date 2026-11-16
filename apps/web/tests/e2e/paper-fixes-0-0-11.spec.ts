import { expect, test } from "@playwright/test";
import {
  PAPER_PROJECT_ID,
  PAPER_PROJECT_NAME,
  HNO3_CALC_ID,
  HNO3_RESULT_ID,
  preferAdvancedWorkbench,
  preferGuidedWorkbench,
  setupPaperFixesMocks,
} from "./helpers/paper-fixes-mocks";
import { pickTemplate } from "./helpers/molecule-editor-mocks";

test.describe("Release 0.0.11 paper-test fixes (mock transport)", () => {
  test.beforeEach(async ({ page }) => {
    page.on("console", (msg) => console.log(`[BROWSER ${msg.type()}]`, msg.text()));
    page.on("pageerror", (err) => console.log("[PAGEERROR]", err.message, err.stack));
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("1. hosted-limit messages shown before Run (12-atom opt/orbital limits, CREST H/C/O only)", async ({ page }) => {
    await setupPaperFixesMocks(page, { withLophine: true });
    await preferAdvancedWorkbench(page);
    await page.goto(`/en/projects/${PAPER_PROJECT_ID}/workspace`);

    // Ensure calculation panel is displayed
    const calcSection = page.locator(".calculation-panel");
    await expect(calcSection).toBeVisible({ timeout: 20_000 });

    // A. PySCF Geometry Optimization on 39-atom Lophine: limited to 12 atoms
    const taskSelect = calcSection.locator("label").filter({ hasText: "Task" }).locator("select");
    await taskSelect.selectOption("GEOMETRY_OPTIMIZATION");

    const refusal = page.getByTestId("hosted-limit-refusal");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("12 atoms");
    await expect(refusal).toContainText("Run is disabled until the structure or the task changes");
    await expect(calcSection.getByRole("button", { name: "Optimize geometry" })).toBeDisabled();

    // B. Switch to xTB: 39-atom Lophine is within xTB's 50-atom limit
    const engineSelect = calcSection.locator("label").filter({ hasText: "Engine" }).locator("select");
    if (await engineSelect.isVisible()) {
      await engineSelect.selectOption("xtb");
      await expect(refusal).toHaveCount(0);
      await expect(page.getByTestId("hosted-limit-note")).toBeVisible();
    }

    // C. PySCF Molecular Orbitals on 39-atom Lophine: limited to 12 atoms
    await engineSelect.selectOption("pyscf");
    await taskSelect.selectOption("ORBITAL");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("12 atoms");
    await expect(calcSection.getByRole("button", { name: "Calculate orbitals" })).toBeDisabled();

    // D. CREST conformer search: rejects Nitrogen-containing molecules (ordered H/C/O only)
    await taskSelect.selectOption("CONFORMER_SEARCH");
    const crestSection = page.getByTestId("conformer-search-setup");
    await expect(crestSection).toBeVisible();
    const crestBlocker = page.getByTestId("conformer-start-blocker");
    await expect(crestBlocker).toBeVisible();
    await expect(crestBlocker).toContainText("Start is disabled");
    await expect(crestBlocker).toContainText("The validated workflow supports ordered H/C/O atom identities only");
    await expect(crestSection.getByRole("button", { name: "Start conformer search" })).toBeDisabled();
  });

  test("2. editor charge control for a single charged species", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await setupPaperFixesMocks(page, {
      emptyProject: true,
      onGenerateCandidate: (body) => {
        capturedBody = body;
      },
    });
    await preferAdvancedWorkbench(page);

    await page.goto(`/en/projects/${PAPER_PROJECT_ID}/workspace`);
    // In advanced workbench without structures, "Create molecule" opens options, then "Draw manually" opens Ketcher
    const createMoleculeBtn = page.getByRole("button", { name: "Create molecule" }).first();
    await expect(createMoleculeBtn).toBeVisible({ timeout: 20_000 });
    await createMoleculeBtn.click();
    const drawManuallyBtn = page.getByRole("button", { name: "Draw manually" });
    await expect(drawManuallyBtn).toBeVisible({ timeout: 10_000 });
    await drawManuallyBtn.click();

    // Editor opens
    await expect(page.getByTestId("ketcher-editor-panel")).toBeVisible({ timeout: 30_000 });
    await pickTemplate(page, "ethanol");
    await expect.poll(() => page.getByTestId("editor-smiles").innerText()).toBe("CCO");

    // The Total charge control is present under drawing checks
    const chargeControl = page.getByTestId("check-charge");
    await expect(chargeControl).toBeVisible();
    const chargeInput = chargeControl.getByLabel("Total charge of the species");
    await expect(chargeInput).toBeVisible();

    // Fill charge for a cation (+1, e.g. BMIM+)
    await chargeInput.fill("1");
    await expect(chargeControl).toContainText("set by you; must equal the sum of the drawn charges");

    // Click Generate 3D
    const generateBtn = page.getByTestId("generate-3d-btn");
    await expect(generateBtn).toBeEnabled({ timeout: 60_000 });
    await generateBtn.click();

    // Verify expected_charge: 1 was passed to the backend
    await expect.poll(() => capturedBody).not.toBeNull();
    expect((capturedBody as Record<string, unknown> | null)?.expected_charge).toBe(1);
  });

  test("3. manual entry of a paper claim shown as user-entered literature", async ({ page }) => {
    let capturedClaim: Record<string, unknown> | null = null;
    await setupPaperFixesMocks(page, {
      onManualClaim: (body) => {
        capturedClaim = body;
      },
    });
    await page.goto(`/en/projects/${PAPER_PROJECT_ID}/claims`);

    // Verify Claims page loads
    await expect(page.getByRole("heading", { name: "Scientific claims" })).toBeVisible({ timeout: 30_000 });

    // Open the manual claim dialog
    const openBtn = page.getByTestId("open-add-claim-dialog-btn");
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    const dialog = page.getByTestId("manual-claim-dialog");
    await expect(dialog).toBeVisible();

    // Fill fields but leave quote empty
    await page.getByTestId("manual-claim-system-input").fill("Complex 3b");
    await page.getByTestId("manual-claim-quantity-input").fill("relative energy b-a");
    await page.getByTestId("manual-claim-value-input").fill("15.4");
    await page.getByTestId("manual-claim-unit-input").fill("kcal/mol");
    await page.getByTestId("manual-claim-page-input").fill("9");

    // Try submitting with empty quote -> submission blocked, validation error shown
    const submitBtn = page.getByTestId("manual-claim-submit-btn");
    await submitBtn.click();
    await expect(page.getByText("Verbatim quote is required.")).toBeVisible();
    expect(capturedClaim).toBeNull();

    // Now fill a valid quote
    await page.getByTestId("manual-claim-quote-input").fill("Complex 3b was found 15.4 kcal/mol above ground state");

    // Submit form
    await submitBtn.click();

    // Dialog closes
    await expect(dialog).not.toBeVisible();

    // Verify backend received the validated payload
    await expect.poll(() => capturedClaim).not.toBeNull();
    expect((capturedClaim as Record<string, unknown> | null)?.value).toBe(15.4);
    expect((capturedClaim as Record<string, unknown> | null)?.quote).toBe("Complex 3b was found 15.4 kcal/mol above ground state");

    // The new claim is listed in the table
    const newClaimRow = page.locator(".claim-row", { hasText: "15.4" });
    await expect(newClaimRow).toBeVisible();
    await expect(newClaimRow).toContainText("kcal/mol");

    // Inspect the claim and verify it is labelled User-entered / USER_ENTERED
    await newClaimRow.click();
    const inspector = page.getByRole("complementary", { name: "Selected claim inspector" });
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText("User-entered");
    await expect(inspector).toContainText("entered by you");
    await expect(inspector.locator('[data-code="USER_ENTERED"]')).toBeVisible();
  });

  test("4. vibrational displacement arrows toggle", async ({ page }) => {
    await setupPaperFixesMocks(page, { withVibrationalResult: true });
    await preferAdvancedWorkbench(page);
    await page.goto(`/en/projects/${PAPER_PROJECT_ID}/workspace?selection=calculationResult:${HNO3_RESULT_ID}&source=${HNO3_CALC_ID}`);

    // The vibrational analysis mode or IR view shows the displacement arrows toggle
    const arrowsCheckbox = page.getByLabel("Show displacement arrows");
    await expect(arrowsCheckbox).toBeVisible({ timeout: 20_000 });
    await expect(arrowsCheckbox).not.toBeChecked();
    await arrowsCheckbox.check();
    await expect(arrowsCheckbox).toBeChecked();
  });

  test("5. cancel status reading 'Canceled'", async ({ page }) => {
    await setupPaperFixesMocks(page, { withLophine: true, canceledCalculation: true });
    await preferAdvancedWorkbench(page);
    await page.goto(`/en/projects/${PAPER_PROJECT_ID}/workspace`);

    // Calculation panel displays canceled state
    const calcSection = page.locator(".calculation-panel");
    await expect(calcSection).toBeVisible({ timeout: 20_000 });

    // Verify that cancellation reads "Canceled" and not "PYSCF engine unavailable: AWS_JOB_CANCELED"
    const content = await page.content();
    expect(content).not.toContain("PYSCF engine unavailable: AWS_JOB_CANCELED");
    expect(content).toMatch(/Canceled|Calculation canceled|Calculation was canceled/i);
  });

  test("6. full project name on an empty project", async ({ page }) => {
    await setupPaperFixesMocks(page, { emptyProject: true });
    await preferGuidedWorkbench(page);
    await page.goto(`/en/projects/${PAPER_PROJECT_ID}/workspace`);

    // GuidedProjectHome header renders the full project name without truncation
    const title = page.locator(".guided-project-title");
    await expect(title).toBeVisible({ timeout: 20_000 });
    await expect(title).toHaveText(PAPER_PROJECT_NAME);

    // Verify that the title contains the complete string and is not truncated to "Paper test - S"
    expect(await title.innerText()).toBe("Paper test - S1 Lophine");

    // Also check the project shell identity link
    const identityLink = page.locator(".project-identity").first();
    if (await identityLink.isVisible()) {
      await expect(identityLink).toHaveText(PAPER_PROJECT_NAME);
    }
  });
});
