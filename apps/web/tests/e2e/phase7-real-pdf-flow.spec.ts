import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const PDF_PATH =
  process.env.CHEMDFT_PHASE7_ACCEPTANCE_PDF ||
  path.join(
    process.env.HOME || "",
    "Desktop/chemdft-acceptance/sintez-hromovogo-soedineniya-metodom-cvd-i-ego-issledovanie-fizicheskimi-metodami.pdf"
  );

function createSyntheticPdf(): Buffer {
  const pageOne = "BT /F1 18 Tf 30 350 Td (ChemDFT synthetic page one) Tj ET\nBT /F1 12 Tf 30 310 Td (Figure 1: X-ray diffraction pattern.) Tj ET\nBT /F1 12 Tf 30 290 Td (Figure 2: Hypothetical crystal structure.) Tj ET\n0 0 0 RG 30 280 m 270 280 l S";
  const pageTwo = "BT /F1 18 Tf 30 350 Td (ChemDFT synthetic page two) Tj ET\n0 0 0 RG 30 280 m 270 280 l S";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${Buffer.byteLength(pageOne)} >>\nstream\n${pageOne}\nendstream`,
    `<< /Length ${Buffer.byteLength(pageTwo)} >>\nstream\n${pageTwo}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

test("synthetic PDF renders pixels and page-only source anchors remain honest", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "PDF.js canvas acceptance is desktop-only.");
  const suffix = Date.now().toString(36);
  await page.goto("/en");
  await page.getByRole("link", { name: "Open ChemDFT" }).first().click();
  await expect(page.getByText("Local development identity")).toBeVisible();
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Project name").fill("Synthetic PDF Viewer Acceptance");
  await page.getByLabel("Project slug").fill(`synthetic-pdf-${suffix}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Import a structure to begin" })).toBeVisible({ timeout: 15_000 });
  await page.setInputFiles("#structure-upload", {
    name: "synthetic-source.pdf",
    mimeType: "application/pdf",
    buffer: createSyntheticPdf(),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText(/Scientific document imported\..*evidence candidates detected\./)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Detected findings" })).toBeVisible();
  await expect(page.getByText("Findings are extracted for review; the paper has not created a saved StructureVersion.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What ChemDFT found" })).toBeVisible();
  await expect(page.getByTestId("knowledge-index-status")).toContainText("Index ready", { timeout: 30_000 });
  await page.locator(".phase7-evidence-row").filter({ hasText: "Fig. 2" }).click();
  await expect(page.getByRole("region", { name: "Detected structure candidate" })).toContainText("Figure evidence only. It does not create authoritative chemistry.");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("Reviewed candidate · still not a validated structure.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No validated 3D structure yet" })).toBeVisible();

  const canvas = page.locator("#phase7-pdf-canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Page 1 rendered", { exact: true })).toBeVisible({ timeout: 15_000 });
  const bitmap = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d");
    if (!context) return { width: element.width, height: element.height, nonWhitePixels: 0 };
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let nonWhitePixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset]! < 245 || pixels[offset + 1]! < 245 || pixels[offset + 2]! < 245) nonWhitePixels += 1;
    }
    return { width: element.width, height: element.height, nonWhitePixels };
  });
  expect(bitmap.width).toBeGreaterThan(0);
  expect(bitmap.height).toBeGreaterThan(0);
  expect(bitmap.nonWhitePixels).toBeGreaterThan(100);

  const xrdRow = page.locator(".phase7-evidence-row").filter({ hasText: "XRD" }).first();
  await xrdRow.click();
  await expect(page.getByText("Page-level source · region not available")).toBeVisible();
  await expect(page.locator(".phase7-highlight")).toHaveCount(0);
  const initialWidth = await canvas.evaluate((element: HTMLCanvasElement) => element.getBoundingClientRect().width);
  await page.getByRole("button", { name: "+", exact: true }).click();
  await expect(page.getByText("120%", { exact: true })).toBeVisible();
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.getBoundingClientRect().width)).toBeGreaterThan(initialWidth);
  await page.setViewportSize({ width: 1180, height: 760 });
  await expect(page.getByText("Page-level source · region not available")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".phase7-pdf-page")).toHaveAttribute("data-render-page", "2");
  await expect(page.getByText("Page 2 rendered", { exact: true })).toBeVisible();
});

test("StructureCandidate draft stays isolated until both reviews and explicit promotion", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Candidate preview renderer acceptance is desktop-only.");
  test.setTimeout(90_000);
  const ideScreenshots = path.resolve(process.cwd(), "../../output/workspace-ide-qa");
  fs.mkdirSync(ideScreenshots, { recursive: true });
  const captureIde = (name: string) => page.screenshot({ path: path.join(ideScreenshots, name), fullPage: true });
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const suffix = Date.now().toString(36);
  await page.goto("/en");
  await page.getByRole("link", { name: "Open ChemDFT" }).first().click();
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Project name").fill("Candidate representation acceptance");
  await page.getByLabel("Project slug").fill(`candidate-repr-${suffix}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Import a structure to begin" })).toBeVisible({ timeout: 15_000 });
  await page.setInputFiles("#structure-upload", {
    name: "synthetic-candidate-source.pdf",
    mimeType: "application/pdf",
    buffer: createSyntheticPdf(),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText(/Scientific document imported\./)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("tree-item-structureCandidate").first()).toBeVisible();
  await expect(page.getByTestId("tree-section-calculations")).toContainText("0");
  await expect(page.getByTestId("tree-section-results")).toContainText("0");
  await captureIde("01-populated-tree.png");
  await page.locator(".phase7-evidence-row").filter({ hasText: "Fig. 2" }).click();
  const candidate = page.getByRole("region", { name: "Detected structure candidate" });
  await expect(candidate).toContainText("Figure evidence only.");
  await candidate.getByRole("button", { name: "Review", exact: true }).click();
  await expect(candidate).toContainText("Reviewed candidate · still not a validated structure.");
  await candidate.getByRole("button", { name: "Enter SMILES" }).click();
  await page.getByLabel("SMILES representation").fill("CCO");
  await candidate.getByRole("button", { name: "Save draft & preview" }).click();

  const representationRows = candidate.getByLabel("Candidate representation history").locator("article");
  await expect(representationRows).toHaveCount(3, { timeout: 15_000 });
  const generatedPreview = representationRows.filter({ hasText: "CARTESIAN COORDINATES" });
  await generatedPreview.getByRole("button", { name: "Open preview" }).click();
  const preview = page.getByRole("region", { name: "Unverified candidate preview" });
  await expect(preview).toContainText("UNVERIFIED 3D PREVIEW");
  await expect(preview).toContainText("not DFT optimized");
  await expect(page.getByText("0 saved structures loaded from the ChemDFT API.")).toBeVisible();
  await expect(page.getByTestId("candidate-preview-canvas")).toBeVisible();
  await page.getByTestId("tree-item-candidateRepresentation").filter({ hasText: "CARTESIAN_COORDINATES" }).click();
  await expect(page.getByTestId("selected-workspace-canvas")).toContainText("UNVERIFIED · CANDIDATE");
  await expect(page.getByTestId("candidate-preview-canvas")).toBeVisible();
  await expect(page.getByTestId("ai-current-view")).toContainText("Representation");
  await expect(page.locator(".candidate-preview-viewport canvas")).toBeVisible();
  await captureIde("03-candidate-selected.png");
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await page.locator(".phase7-evidence-row").filter({ hasText: "Fig. 2" }).click();
  await expect(generatedPreview).toBeVisible();
  await generatedPreview.getByRole("button", { name: "Review representation" }).click();
  await expect(generatedPreview).toContainText("review REVIEWED");
  await generatedPreview.getByRole("button", { name: "Promote to V1" }).click();

  await expect(page.getByText("1 saved structure loaded from the ChemDFT API.")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".version-list")).toContainText("V1");
  await expect(page.locator(".version-list")).toContainText("RECONSTRUCTED");
  await expect(page.locator(".version-list")).toContainText("UNVERIFIED");
  await page.getByTestId("tree-item-structureVersion").first().click();
  await expect(page.getByTestId("selected-workspace-canvas")).toContainText("COMMITTED STRUCTURE VERSION");
  await expect(page.getByRole("heading", { name: "Scientific visualization" })).toBeVisible();
  await captureIde("04-structure-version-selected.png");
  await page.getByTestId("tree-item-historyEvent").filter({ hasText: "Structure candidate promoted" }).click();
  await expect(page.getByTestId("selected-workspace-canvas")).toContainText("Structure candidate promoted");
  await expect(page.getByRole("button", { name: "Open linked item" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("Phase 7: Real PDF viewer, page-only source-anchor labeling, zoom, and Digitizer UI workflow", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The full PDF.js inspection and digitizer workflow is desktop-only."
  );
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  // Verify acceptance PDF exists
  expect(fs.existsSync(PDF_PATH)).toBe(true);
  const pdfBuffer = fs.readFileSync(PDF_PATH);

  const suffix = Date.now().toString(36);
  const name = "Phase 7 Acceptance Verification";
  const slug = `phase7-accept-${suffix}`;

  // 1. Create project
  await page.goto("/en");
  await expect(page.getByRole("heading", { name: /Computational chemistry/ })).toBeVisible();
  await page.getByRole("link", { name: "Open ChemDFT" }).first().click();
  await expect(page.getByText("Local development identity")).toBeVisible();
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Project slug").fill(slug);
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name: "Import a structure to begin" })).toBeVisible({
    timeout: 15_000,
  });

  // 2. Upload the real acceptance PDF through the UI import form
  await page.setInputFiles("#structure-upload", {
    name: path.basename(PDF_PATH),
    mimeType: "application/pdf",
    buffer: pdfBuffer,
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();

  // Wait for import confirmation
  await expect(page.getByText(/Scientific document imported\..*evidence candidates detected\./)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId("explorer-document-count")).toHaveText("1");
  await expect(page.getByTestId("tree-item-structureCandidate").first()).toBeVisible();
  const ideScreenshots = path.resolve(process.cwd(), "../../output/workspace-ide-qa");
  fs.mkdirSync(ideScreenshots, { recursive: true });
  await page.getByTestId("tree-section-files").click();
  await page.screenshot({ path: path.join(ideScreenshots, "01-populated-tree-real-paper.png") });
  await page.getByTestId("tree-section-files").click();
  await page.getByTestId("tree-item-document").first().click();
  await expect(page.getByTestId("selected-workspace-canvas")).toBeVisible();
  await expect(page.getByText("Page 1 rendered", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(ideScreenshots, "02-pdf-selected-real-paper.png") });
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await expect(page.getByTestId("knowledge-index-status")).toContainText("Index ready", { timeout: 30_000 });

  // 3. Select the document in the Documents list
  const docButton = page.locator(".phase7-row").first();
  await expect(docButton).toBeVisible();
  await expect(docButton).toContainText("Синтез хромового соединения методом CVD");
  await expect(docButton).toContainText("10 pages");
  await docButton.click();
  const evidenceGroups = page.locator(".phase7-evidence-groups button");
  await expect(evidenceGroups.filter({ hasText: "Structure evidence" })).toBeVisible();
  await expect(evidenceGroups.filter({ hasText: "Crystallography / XRD" })).toBeVisible();
  await expect(evidenceGroups.filter({ hasText: "Thermal analysis" })).toBeVisible();
  await expect(evidenceGroups.filter({ hasText: "Particle characterization" })).toBeVisible();
  const displayedGroupCounts = await evidenceGroups.evaluateAll((buttons) => buttons
    .map((button) => Number(button.textContent?.match(/\((\d+)\)/)?.[1] ?? 0))
    .filter((count) => count > 0));
  expect(displayedGroupCounts.slice(1).reduce((sum, count) => sum + count, 0)).toBe(displayedGroupCounts[0]);
  await page.getByRole("button", { name: "View Thermal analysis" }).click();
  await expect(page.locator(".phase7-evidence-row[data-selected='true']")).toContainText("page 4");
  await page.getByRole("button", { name: "View Crystallography / XRD" }).click();
  await expect(page.locator(".phase7-evidence-row[data-selected='true']")).toContainText("page 6");
  await expect(page.locator(".phase7-evidence-row[data-selected='true']")).toContainText("Figure 3 · XRD");
  await page.getByRole("button", { name: "All findings", exact: false }).click();
  await page.getByRole("button", { name: "View Structure evidence" }).click();
  await expect(page.locator(".phase7-evidence-row[data-selected='true']")).toContainText("Fig. 2");
  const structureCandidate = page.getByRole("region", { name: "Detected structure candidate" });
  await expect(structureCandidate).toContainText("Fig. 2 · p. 6");
  await expect(structureCandidate).toContainText("Figure evidence only. It does not create authoritative chemistry.");
  await expect(structureCandidate).toContainText("Reported figure · Unverified");
  await expect(page.getByRole("heading", { name: "No validated 3D structure yet" })).toBeVisible();
  await expect(page.getByText("This is not a validated structure; no atomic coordinates are available from this record.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Open 3D/ })).toHaveCount(0);
  await page.getByRole("button", { name: "View Particle characterization" }).click();
  await expect(page.locator(".phase7-evidence-row[data-selected='true']")).toContainText("page 7");
  await page.getByRole("button", { name: "View Structure evidence" }).click();
  await page.locator(".phase7-evidence-row").filter({ hasText: "Fig. 2" }).first().click();
  await structureCandidate.getByRole("button", { name: "Review candidate", exact: true }).click();
  await expect(structureCandidate).toContainText("Reviewed candidate · still not a validated structure.");
  await structureCandidate.getByRole("button", { name: "Reject candidate", exact: true }).click();
  await expect(structureCandidate).toContainText("Candidate rejected · source evidence remains unchanged.");
  await expect(page.locator(".provenance-list").getByText("DETECTED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All findings", exact: false }).click();
  await page.getByRole("button", { name: "View Crystallography / XRD" }).click();

  // 4. Verify PDF.js renders the canvas
  const canvas = page.locator("#phase7-pdf-canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.getBoundingClientRect().width)).toBeGreaterThan(100);
  await expect.poll(() => page.locator(".phase7-pdf-page").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(100);

  // 5. Select an XRD / figure candidate
  const candidateRows = page.locator(".phase7-evidence-row");
  await expect(candidateRows.first()).toBeVisible();

  // Click an XRD candidate or first candidate
  const xrdCandidate = page.locator(".phase7-evidence-row:has-text('XRD')").first();
  if (await xrdCandidate.isVisible()) {
    await xrdCandidate.click();
  } else {
    await candidateRows.first().click();
  }

  // Page-only parser anchors must not masquerade as precise figure-region highlights.
  await expect(page.getByText("Page-level source · region not available")).toBeVisible({ timeout: 10_000 });
  const highlight = page.locator(".phase7-highlight");
  await expect(highlight).toHaveCount(0);
  const initialCanvasWidth = await canvas.evaluate((element: HTMLCanvasElement) => element.getBoundingClientRect().width);

  // 7. Test zoom and verify highlight remains aligned
  const zoomIn = page.getByRole("button", { name: "+", exact: true });
  await zoomIn.click();
  await expect(page.getByText("120%", { exact: true })).toBeVisible();
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.getBoundingClientRect().width)).toBeGreaterThan(initialCanvasWidth);

  await expect(page.getByText("Page-level source · region not available")).toBeVisible();
  await expect(highlight).toHaveCount(0);

  // Zoom back
  const zoomOut = page.getByRole("button", { name: "-", exact: true });
  await zoomOut.click();
  await page.waitForTimeout(500);

  // 8. Find a FIGURE candidate and open Digitizer
  const figureCandidate = page.locator(".phase7-evidence-row:has-text('Figure 4')").first();
  if (await figureCandidate.isVisible()) {
    await figureCandidate.click();
  } else {
    // If no figure-specific label, use any candidate
    await candidateRows.first().click();
  }

  // 9. Verify Digitizer panel appears if figure candidate is selected
  const digitizer = page.locator(".phase7-digitizer");
  if (await digitizer.isVisible()) {
    // Calibrate X / Y in UI
    await page.getByLabel("X max").fill("100");
    await page.getByLabel("X unit").fill("degree");
    await page.getByLabel("Y max").fill("100");
    await page.getByLabel("Y unit").fill("intensity");

    // Click points on the PDF canvas manually
    await canvas.scrollIntoViewIfNeeded();
    await canvas.click({ position: { x: 50, y: 50 } });
    await page.waitForTimeout(300);
    await canvas.click({ position: { x: 70, y: 60 } });
    await page.waitForTimeout(300);

    // Verify points captured
    await expect(page.getByText(/points? captured/)).toBeVisible();

    // Commit digitized dataset
    const commitBtn = page.getByRole("button", {
      name: "Commit digitized dataset",
    });
    await expect(commitBtn).toBeEnabled({ timeout: 10_000 });
    await commitBtn.click();

    // 10. Verify dataset is listed in UI
    await expect(page.locator(".phase7-dataset-card")).toBeVisible({ timeout: 15_000 });
  }

  // 11. Verify dataset properties via API
  const apiBase = process.env.CHEMDFT_API_BASE_URL ?? `http://127.0.0.1:${process.env.CHEMDFT_E2E_API_PORT ?? 8123}`;
  const projectsRes = await request.get(`${apiBase}/v1/projects`);
  const projects = await projectsRes.json();
  const currentProject = projects.find((p: { slug: string }) => p.slug === slug);
  expect(currentProject).toBeDefined();

  const documentsRes = await request.get(`${apiBase}/v1/projects/${currentProject.id}/documents`);
  const documents = await documentsRes.json();
  expect(documents.documents[0].page_count).toBe(10);
  const structuresRes = await request.get(`${apiBase}/v1/projects/${currentProject.id}/structures`);
  expect(await structuresRes.json()).toEqual([]);
  const candidatesRes = await request.get(`${apiBase}/v1/projects/${currentProject.id}/structure-candidates`);
  const candidates = await candidatesRes.json();
  expect(candidates.candidates.some((candidate: { evidence_type?: string; source_anchor?: { page_number?: number; figure_number?: string } }) =>
    candidate.evidence_type === "STRUCTURE_FIGURE_CANDIDATE" && candidate.source_anchor?.page_number === 6 && candidate.source_anchor?.figure_number === "2")).toBe(true);

  const datasetsRes = await request.get(
    `${apiBase}/v1/projects/${currentProject.id}/experimental/datasets`
  );
  const datasets = await datasetsRes.json();
  if (datasets.length > 0) {
    const digDataset = datasets.find((d: { source_class: string }) => d.source_class === "DIGITIZED");
    if (digDataset) {
      expect(digDataset.source_class).toBe("DIGITIZED");
      expect(digDataset.state).toBe("DERIVED");
      expect(digDataset.approximation).toBe("APPROXIMATE");
      expect(digDataset.calibration).toBeDefined();
      expect(digDataset.calibration.page).toBeDefined();
    }
  }

  expect(
    consoleErrors.filter((e) => !e.includes("favicon") && !e.includes("RenderingCancelledException")),
  ).toEqual([]);
});
