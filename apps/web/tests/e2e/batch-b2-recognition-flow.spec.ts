import { expect, test, type APIRequestContext } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures");
const SCREENSHOT_DIR = path.resolve(process.cwd(), "../../output/batch-b2-acceptance");

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

async function createProjectViaApi(request: APIRequestContext, name: string): Promise<string> {
  const slug = `b2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await request.post("/api/chemdft/v1/projects", {
    data: { name, slug },
  });
  expect(res.ok()).toBe(true);
  const data = await res.json();
  return data.id as string;
}

test.describe("Batch B2: Molecular Diagram Recognition & Acceptance", () => {
  test("Full Workflow with REAL DECIMER: PDF -> Extraction -> Recognition -> Side-by-Side Comparison", async ({
    page,
    request,
  }) => {
    // DECIMER on CPU takes ~45s for model load and inference; allow 150s timeout.
    test.setTimeout(150_000);

    const pdfPath = path.join(FIXTURES_DIR, "b2-ethanol-diagram.pdf");
    expect(fs.existsSync(pdfPath)).toBe(true);

    // 1. Open an existing ChemDFT project
    const projectId = await createProjectViaApi(request, "B2 Real DECIMER Acceptance Project");
    await page.goto(`/en/projects/${projectId}/workspace`);
    const advancedToggle = page.getByTestId("mode-toggle-advanced");
    await expect(advancedToggle).toBeVisible({ timeout: 20_000 });
    await advancedToggle.click();
    const importSubmitBtn = page.getByRole("form", { name: "Import structure" }).getByRole("button", { name: "Import" });
    await expect(importSubmitBtn).toBeEnabled({ timeout: 20_000 });

    // 2. Select an imported scientific PDF
    await page.setInputFiles("#structure-upload", {
      name: "scientific-paper-ethanol.pdf",
      mimeType: "application/pdf",
      buffer: fs.readFileSync(pdfPath),
    });
    await importSubmitBtn.click();
    await expect(page.getByText(/Scientific document imported\./)).toBeVisible({ timeout: 25_000 });

    // Select the document / file in the workspace
    const docOrFileItem = page.locator('[data-testid="tree-item-document"], [data-testid="tree-item-file"]').first();
    await expect(docOrFileItem).toBeVisible({ timeout: 15_000 });
    await docOrFileItem.click();

    // 3. Request figure extraction
    const extractSection = page.getByTestId("document-figures-section");
    await expect(extractSection).toBeVisible({ timeout: 15_000 });
    const extractBtn = page.getByTestId("extract-figures-button");
    await expect(extractBtn).toBeVisible();
    await extractBtn.click();

    // 4. Display extracted figure thumbnails
    const figureStrip = page.getByTestId("extracted-figures-strip");
    await expect(figureStrip).toBeVisible({ timeout: 20_000 });
    const figureThumb = page.getByTestId("figure-thumbnail").first();
    await expect(figureThumb).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "01-figures-extracted.png"), fullPage: true });

    // 5. Select a figure candidate
    const thumbButton = page.getByTestId("figure-thumbnail-button").first();
    await thumbButton.click();

    // 6. Request molecular recognition (Real DECIMER)
    const launcher = page.getByTestId("candidate-recognition-launcher");
    await expect(launcher).toBeVisible({ timeout: 15_000 });
    const recognizeBtn = page.getByTestId("recognize-figure-button");
    await expect(recognizeBtn).toBeVisible();
    await recognizeBtn.click();

    // 7. Display recognition status / progress
    const progressNotice = page.getByTestId("recognition-progress");
    await expect(progressNotice).toBeVisible();
    await expect(progressNotice).toContainText("DECIMER");

    // 8. Display original figure alongside proposed molecular structure
    const recognitionPanel = page.getByTestId("candidate-figure-recognition-panel");
    await expect(recognitionPanel).toBeVisible({ timeout: 90_000 });

    await expect(page.getByTestId("original-figure-container")).toBeVisible();
    await expect(page.getByTestId("original-figure-image")).toBeVisible();
    await expect(page.getByTestId("proposed-molecule-container")).toBeVisible();
    const mol2d = page.locator('[data-testid="proposed-molecule-2d"], [data-testid="proposed-molecule-2d-fallback"]');
    await expect(mol2d).toBeVisible();

    // 9. Show source document and page
    await expect(recognitionPanel).toContainText("Page 1");

    // 10. Check scientific data & safeguards
    // Raw predicted representation
    const rawOutput = page.getByTestId("raw-model-output");
    await expect(rawOutput).toBeVisible();
    await expect(rawOutput).toContainText("CCO");

    // Chemical formula
    await expect(page.getByTestId("chemical-formula-display")).toContainText("C2H6O");

    // Engine and model version
    await expect(page.getByTestId("recognition-engine-tag")).toContainText("DECIMER-Image_Transformer v2.8.0");

    // Uncalibrated confidence warning
    const confidenceBadge = page.getByTestId("recognition-confidence-badge");
    await expect(confidenceBadge).toBeVisible();
    await expect(confidenceBadge).toContainText(/uncalibrated/i);

    // Show validation warnings & scientific integrity notice
    await expect(page.getByTestId("scientific-integrity-notice")).toBeVisible();
    await expect(page.getByTestId("validation-warnings-section")).toBeVisible();

    // 11. Clearly label the result UNVERIFIED
    await expect(page.getByTestId("unverified-hypothesis-badge")).toBeVisible();
    await expect(page.getByTestId("unverified-hypothesis-badge")).toContainText("UNVERIFIED");
    await expect(page.getByTestId("candidate-status-tag")).toContainText("MANUAL_REVIEW_REQUIRED");

    // Test researcher review workflow
    const reviewBtn = page.getByTestId("review-candidate-button");
    await expect(reviewBtn).toBeVisible();
    await reviewBtn.click();
    await expect(page.getByTestId("candidate-status-tag")).toContainText("REVIEWED");

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "02-real-decimer-proposal.png"), fullPage: true });

    // 12. Persistence: a full reload discards all client state. Reopening the candidate must show
    // the proposal that the server stored (not a client-side reconstruction, and no re-run).
    await page.reload();
    await expect(advancedToggle).toBeVisible({ timeout: 20_000 });
    await advancedToggle.click();
    await page.getByTestId("tree-item-structureCandidate").first().click();
    const reloadedPanel = page.getByTestId("candidate-figure-recognition-panel");
    await expect(reloadedPanel).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("candidate-recognition-launcher")).toHaveCount(0);
    await expect(page.getByTestId("chemical-formula-display")).toContainText("C2H6O");
    await expect(page.getByTestId("raw-model-output")).toContainText("CCO");
    await expect(page.getByTestId("recognition-engine-tag")).toContainText("DECIMER-Image_Transformer v2.8.0");
    await expect(page.getByTestId("unverified-hypothesis-badge")).toContainText("UNVERIFIED");
    await expect(page.getByTestId("candidate-status-tag")).toContainText("REVIEWED");
    await expect(reloadedPanel).toContainText("Charge: 0 · Atoms: 3");
    await expect(page.getByTestId("validation-warnings-section")).toContainText("NOT proof of scientific correctness");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "04-proposal-after-reload.png"), fullPage: true });
  });

  test("Scientific Safeguards: Non-chemical diagram warning & unverified labeling", async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);

    const pdfPath = path.join(FIXTURES_DIR, "b2-nonchemical-plot.pdf");
    expect(fs.existsSync(pdfPath)).toBe(true);

    const projectId = await createProjectViaApi(request, "B2 Nonchemical Safeguard Project");
    await page.goto(`/en/projects/${projectId}/workspace`);
    const advancedToggle = page.getByTestId("mode-toggle-advanced");
    await expect(advancedToggle).toBeVisible({ timeout: 20_000 });
    await advancedToggle.click();
    const importSubmitBtn = page.getByRole("form", { name: "Import structure" }).getByRole("button", { name: "Import" });
    await expect(importSubmitBtn).toBeEnabled({ timeout: 20_000 });

    await page.setInputFiles("#structure-upload", {
      name: "scientific-plot.pdf",
      mimeType: "application/pdf",
      buffer: fs.readFileSync(pdfPath),
    });
    await importSubmitBtn.click();
    await expect(page.getByText(/Scientific document imported\./)).toBeVisible({ timeout: 25_000 });

    // Open document and extract figures
    const docOrFileItem = page.locator('[data-testid="tree-item-document"], [data-testid="tree-item-file"]').first();
    await expect(docOrFileItem).toBeVisible({ timeout: 15_000 });
    await docOrFileItem.click();

    await page.getByTestId("extract-figures-button").click();
    await expect(page.getByTestId("extracted-figures-strip")).toBeVisible({ timeout: 20_000 });

    // Open candidate
    await page.getByTestId("figure-thumbnail-button").first().click();
    await expect(page.getByTestId("candidate-recognition-launcher")).toBeVisible({ timeout: 15_000 });

    // Run recognition
    await page.getByTestId("recognize-figure-button").click();
    await expect(page.getByTestId("recognition-progress")).toBeVisible();

    // Verify recognition result displays explicit nonchemical warning
    const panel = page.getByTestId("candidate-figure-recognition-panel");
    await expect(panel).toBeVisible({ timeout: 90_000 });

    // Crucial safeguard check: UI must display the warning that DECIMER emits SMILES for nonchemical images
    const warnings = page.getByTestId("validation-warnings-section");
    await expect(warnings).toBeVisible();
    await expect(warnings).toContainText("DECIMER emits a SMILES for almost any input");

    // Result remains UNVERIFIED
    await expect(page.getByTestId("unverified-hypothesis-badge")).toBeVisible();
    await expect(page.getByTestId("unverified-hypothesis-badge")).toContainText("UNVERIFIED");
    await expect(page.getByTestId("candidate-status-tag")).toContainText("MANUAL_REVIEW_REQUIRED");

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "03-nonchemical-warning.png"), fullPage: true });
  });

  test("Security & Isolation: a candidate cannot be read or recognized through another project", async ({ request }) => {
    // Project A owns a real extracted figure candidate; project B must not reach it by id.
    const projectA = await createProjectViaApi(request, "B2 Isolation Owner");
    const projectB = await createProjectViaApi(request, "B2 Isolation Other");
    const pdf = fs.readFileSync(path.join(FIXTURES_DIR, "b2-ethanol-diagram.pdf"));

    const imported = await request.post(`/api/chemdft/v1/projects/${projectA}/documents/imports`, {
      multipart: { upload: { name: "owner-paper.pdf", mimeType: "application/pdf", buffer: pdf } },
    });
    expect(imported.status()).toBe(201);
    const documentId = (await imported.json()).document.id as string;
    const extracted = await request.post(`/api/chemdft/v1/projects/${projectA}/documents/${documentId}/figures/extract`);
    expect(extracted.ok()).toBe(true);
    const candidateId = (await extracted.json()).candidates[0].id as string;

    // Sanity: the owner can read the figure.
    const own = await request.get(`/api/chemdft/v1/projects/${projectA}/structure-candidates/${candidateId}/figure`);
    expect(own.status()).toBe(200);
    expect(own.headers()["content-type"]).toContain("image/png");

    // Cross-project attempts are all "not found" (no existence leak, no inference started).
    const base = `/api/chemdft/v1/projects/${projectB}`;
    expect((await request.get(`${base}/structure-candidates/${candidateId}/figure`)).status()).toBe(404);
    expect((await request.get(`${base}/structure-candidates/${candidateId}`)).status()).toBe(404);
    expect((await request.post(`${base}/structure-candidates/${candidateId}/recognize`, { data: {} })).status()).toBe(404);
    expect((await request.post(`${base}/documents/${documentId}/figures/extract`)).status()).toBe(404);

    // Unknown project ids are rejected too, and nothing was recognized on the owner's candidate.
    const unknown = await request.post(
      `/api/chemdft/v1/projects/proj-foreign-${Date.now()}/structure-candidates/${candidateId}/recognize`,
      { data: {} },
    );
    expect([403, 404]).toContain(unknown.status());
    const reps = await request.get(`/api/chemdft/v1/projects/${projectA}/structure-candidates/${candidateId}/representations`);
    const types = ((await reps.json()).representations as Array<{ representation_type: string }>).map((r) => r.representation_type);
    expect(types).toEqual(["IMAGE_REFERENCE"]);
  });
});
