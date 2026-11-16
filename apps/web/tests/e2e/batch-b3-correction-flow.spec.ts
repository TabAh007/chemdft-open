import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Synthetic stored DECIMER proposals skip neural inference. No chemistry or HTTP is mocked.
const evidence = resolve("../../output/playwright/b3");
const api = "/api/chemdft/v1/projects";
const seedTool = resolve("../../tools/create_b3_e2e_fixture.py");
const python = resolve("../../.venv/bin/python");
test.setTimeout(150_000);
test.use({ actionTimeout: 20_000, viewport: { width: 1600, height: 1000 } });
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, `failure-${info.testId.replace(/[^a-z0-9]/gi, "_")}.png`), fullPage: true });
  }
});

async function project(request: APIRequestContext, name: string) {
  const response = await request.post(api, { data: { name, slug: `b3-${crypto.randomUUID()}` } });
  expect(response.status()).toBe(201);
  return (await response.json()).id as string;
}
async function seed(request: APIRequestContext, smiles = "CCO") {
  const projectId = await project(request, "B3 isolated saved proposal");
  const fixture = JSON.parse(execFileSync(python, [seedTool], { input: JSON.stringify({ project_id: projectId, smiles }), encoding: "utf8", env: process.env }));
  return { projectId, ...fixture } as { projectId: string; candidate_id: string; original_id: string; drawing_id: string; mol_block: string };
}
async function open(page: Page, projectId: string) {
  await page.goto(`/en/projects/${projectId}/workspace`);
  await expect(page.getByTestId("mode-toggle-advanced")).toBeVisible({ timeout: 40_000 });
  await page.getByTestId("mode-toggle-advanced").click();
  await page.getByTestId("tree-item-structureCandidate").first().click();
  await expect(page.getByTestId("b3-workbench")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("b3-current-revision")).toBeVisible();
}
async function edit(page: Page) {
  await page.getByRole("button", { name: "Correct graph in Ketcher", exact: true }).click();
  await expect(page.getByRole("button", { name: "Validate edited graph", exact: true })).toBeEnabled({ timeout: 40_000 });
}
async function screenshot(page: Page, name: string) {
  mkdirSync(evidence, { recursive: true });
  const workbench = page.getByTestId("b3-workbench");
  const anchor = name.startsWith("03") ? workbench.getByText("GENERATED CONFORMER — NOT QM OPTIMIZED", { exact: true })
    : name.startsWith("04") ? workbench.getByText("PROMOTED STRUCTURE", { exact: true }).first()
    : name.startsWith("01") || name.startsWith("05") || name.startsWith("07") ? page.getByTestId("b3-validation").getByRole("heading").first()
    : page.getByTestId("b3-current-revision");
  await anchor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(evidence, name), fullPage: true });
}

test("A-M,Q: real Ketcher atom correction, validation, immutable revision, reload, ETKDGv3, reviews and promotion", async ({ page, request }) => {
  const fixture = await seed(request);
  const base = `${api}/${fixture.projectId}/structure-candidates/${fixture.candidate_id}`;
  const original = await (await request.get(`${base}/representations/${fixture.original_id}`)).json();
  await open(page, fixture.projectId);
  await expect(page.getByTestId("original-figure-image")).toBeVisible();
  await edit(page);
  // Check real Ketcher loaded three atoms, retaining its chemical graph rather than an image.
  const loaded = await page.evaluate(async () => (window as unknown as { __ketcher: { getMolfile: () => Promise<string> } }).__ketcher.getMolfile());
  expect(loaded).toContain("V2000");
  expect(loaded).toMatch(/\sO\s/);
  await page.locator(".b3-correction-comparison").getByText("Original scientific figure", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(evidence, "00-source-and-real-ketcher.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.getByTestId("b3-workbench").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1600, height: 1000 });
  // Perform a genuine atom substitution using the Ketcher element tool and canvas click.
  await page.getByRole("button", { name: "N", exact: true }).click();
  // Ketcher exports screen-independent atom locations; use the rendered O label for targeting.
  const oxygen = page.locator('.ketcher-frame svg text').filter({ hasText: /^O$/ }).first();
  await expect(oxygen).toBeVisible();
  await oxygen.click({ force: true });
  await page.getByRole("button", { name: "Validate edited graph", exact: true }).click();
  await expect(page.getByTestId("b3-validation")).toContainText("C2H7N");
  await expect(page.getByTestId("b3-differences")).toContainText("ATOM_IDENTITY");
  await screenshot(page, "01-corrected-validated.png");
  const saving = page.waitForResponse(r => r.url().endsWith(`${fixture.candidate_id}/representations`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save corrected representation", exact: true }).click();
  const save = await saving;
  expect(save.status()).toBe(201);
  const saved = (await save.json()).representation;
  expect(saved.source_representation_id).toBe(fixture.drawing_id);
  expect(saved.mol_block.startsWith("\n")).toBe(true);
  expect(await (await request.get(`${base}/representations/${fixture.original_id}`)).json()).toEqual(original);
  await expect(page.getByTestId("b3-current-revision")).toContainText(`R${saved.revision}`);
  await open(page, fixture.projectId); // Full navigation destroys client state.
  await expect(page.getByTestId("b3-current-revision")).toContainText(`R${saved.revision}`);
  await expect(page.getByTestId("b3-validation")).toContainText("C2H7N");
  await screenshot(page, "02-saved-reloaded.png");
  const generation = page.waitForResponse(r => r.url().endsWith("/generate-conformer"));
  await page.getByRole("button", { name: "Generate 3D conformer explicitly", exact: true }).click();
  const generatedResponse = await generation;
  expect(generatedResponse.status()).toBe(201);
  const conformer = (await generatedResponse.json()).representation;
  expect(conformer.coordinate_provenance.origin).toBe("GENERATED_CONFORMER");
  expect(conformer.coordinate_representation.coordinates.atoms.length).toBe(10);
  const workbench = page.getByTestId("b3-workbench");
  await expect(workbench).toContainText("GENERATED CONFORMER — NOT QM OPTIMIZED");
  await expect(page.getByLabel("3Dmol.js scientific structure viewport")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("b3-conformer-viewport").locator("canvas")).toBeVisible();
  await expect(workbench.getByRole("checkbox")).toHaveCount(9);
  await page.addScriptTag({ path: resolve("node_modules/axe-core/axe.min.js") });
  const accessibility = await page.evaluate(async () => (window as unknown as { axe: { run: (context: string, options: object) => Promise<{ violations: { impact: string; id: string }[] }> } }).axe.run('[data-testid="b3-workbench"]', { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
  writeFileSync(resolve(evidence, "accessibility.json"), JSON.stringify(accessibility, null, 2));
  expect(accessibility.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  for (const checkbox of await workbench.getByRole("checkbox").all()) await expect(checkbox).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Record conformer review", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Promote reviewed structure", exact: true })).toBeDisabled();
  const chargeReview = workbench.getByRole("checkbox", { name: /I explicitly reviewed formal charges/ });
  await chargeReview.focus();
  await page.keyboard.press("Space");
  await expect(chargeReview).toBeChecked();
  await page.keyboard.press("Space");
  await expect(chargeReview).not.toBeChecked();
  await page.getByRole("button", { name: "Record source candidate review", exact: true }).click();
  // The authoritative endpoint must reject promotion without representation review.
  const denied = await request.post(`${base}/promote`, { data: { representation_id: conformer.id } });
  expect(denied.status()).toBe(409);
  await screenshot(page, "03-unoptimized-conformer-review-blocked.png");
  for (const checkbox of await workbench.getByRole("checkbox").all()) await checkbox.check();
  const reviewResponse = page.waitForResponse(r => r.url().endsWith(`/${conformer.id}/review`));
  await page.getByRole("button", { name: "Record conformer review", exact: true }).click();
  const recordedReview = await reviewResponse;
  expect(recordedReview.status()).toBe(200);
  const reviewBody = recordedReview.request().postDataJSON();
  expect(reviewBody.checklist.stereochemistry_reviewed).toBe(true);
  expect(reviewBody.checklist.charges_reviewed).toBe(true);
  await expect(page.getByRole("button", { name: "Promote reviewed structure", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Promote reviewed structure", exact: true }).click();
  await expect(workbench).toContainText("PROMOTED STRUCTURE");
  await screenshot(page, "04-promoted.png");
  writeFileSync(resolve(evidence, "full-flow.json"), JSON.stringify({ fixture: "synthetic saved DECIMER; no neural inference", saved, conformer, reviewBody, originalUnchanged: true }, null, 2));
});

test("N-P: real invalid-valence, unsupported generation, explicit charge/stereo gates and cross-project refusal", async ({ page, request }) => {
  const fixture = await seed(request, "N[C@@H]([13CH3])C(=O)[O-]");
  const base = `${api}/${fixture.projectId}/structure-candidates/${fixture.candidate_id}`;
  const other = await project(request, "B3 other project");
  const cross = await request.post(`${api}/${other}/structure-candidates/${fixture.candidate_id}/validate-graph`, { data: { content: "CCO", format: "SMILES" } });
  expect(cross.status()).toBe(404);
  await open(page, fixture.projectId);
  await edit(page);
  const chargedMol = await page.evaluate(async () => (window as unknown as { __ketcher: { getMolfile: () => Promise<string> } }).__ketcher.getMolfile());
  const roundTrip = await request.post(`${base}/validate-graph`, { data: { content: chargedMol, format: "MOL" } });
  const identity = await roundTrip.json();
  expect(identity.is_valid).toBe(true);
  expect(identity.formal_charge).toBe(-1);
  expect(identity.canonical_isomeric_smiles).toContain("[13CH3]");
  expect(identity.stereocenters).toHaveLength(1);
  expect(identity.stereocenters[0].is_assigned).toBe(true);
  await page.getByRole("button", { name: "Validate edited graph", exact: true }).click();
  await expect(page.getByTestId("b3-validation")).toContainText("Isotopic labels present");
  await screenshot(page, "07-charge-isotope-stereo.png");
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  const invalid = await request.post(`${base}/validate-graph`, { data: { content: "C(C)(C)(C)(C)C", format: "SMILES" } });
  expect((await invalid.json()).is_valid).toBe(false);
  const badGraph = await request.post(`${base}/representations`, { data: { representation_type: "SMILES", smiles: "NC(C)C(=O)O", parent_representation_id: fixture.original_id } });
  expect(badGraph.status()).toBe(201);
  const badId = (await badGraph.json()).representation.id;
  const refused = await request.post(`${base}/representations/${badId}/generate-conformer`, { data: {} });
  expect(refused.status()).toBe(422);
  expect(await refused.text()).toContain("explicit stereochemistry");
  await page.getByRole("button", { name: "Reload revision history", exact: true }).click();
  await page.getByLabel("Saved representation revision").selectOption(badId);
  await expect(page.getByTestId("b3-validation")).toContainText("unassigned stereochemistry");
  await expect(page.getByRole("button", { name: "Generate 3D conformer explicitly", exact: true })).toBeDisabled();
  await screenshot(page, "05-unsupported-stereo.png");
  const conformerResponse = await request.post(`${base}/representations/${fixture.original_id}/generate-conformer`, { data: { name: "Charged stereo review test" } });
  expect(conformerResponse.status()).toBe(201);
  const conformer = (await conformerResponse.json()).representation;
  await request.post(`${base}/review`, { data: {} });
  const seven = { inspected_source: true, understands_missing_paper_coordinates: true, coordinate_source_declared: true, units_checked: true, cell_checked_if_used: true, validation_warnings_reviewed: true, differences_acknowledged: true };
  const failures: unknown[] = [];
  for (const extras of [{}, { stereochemistry_reviewed: false, charges_reviewed: false }, { stereochemistry_reviewed: true, charges_reviewed: false }, { stereochemistry_reviewed: false, charges_reviewed: true }]) {
    expect((await request.post(`${base}/representations/${conformer.id}/review`, { data: { checklist: { ...seven, ...extras } } })).status()).toBe(200);
    const promoted = await request.post(`${base}/promote`, { data: { representation_id: conformer.id } });
    expect(promoted.status()).toBe(409);
    expect(await promoted.text()).toContain("HUMAN_REVIEW_CHECKLIST_INCOMPLETE");
    failures.push(extras);
  }
  await page.getByRole("button", { name: "Reload revision history", exact: true }).click();
  await page.getByLabel("Saved representation revision").selectOption(conformer.id);
  await expect(page.getByTestId("b3-workbench")).toContainText("The recorded review lacks explicit confirmations");
  const stereoReview = page.getByRole("checkbox", { name: /I explicitly reviewed R\/S/ });
  await expect(stereoReview).not.toBeChecked();
  await stereoReview.check();
  await expect(page.getByRole("button", { name: "Record conformer review", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Record conformer review", exact: true }).click();
  await expect(page.getByTestId("b3-workbench")).toContainText("RESEARCHER REVIEWED");
  await page.getByRole("button", { name: "Record source candidate review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Promote reviewed structure", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Promote reviewed structure", exact: true }).click();
  await expect(page.getByTestId("b3-workbench")).toContainText("PROMOTED STRUCTURE");
  writeFileSync(resolve(evidence, "rejection-flow.json"), JSON.stringify({ invalidValenceRejected: true, unassignedStereoRefused: true, crossProjectStatus: cross.status(), reviewCombinationsBlocked: failures }, null, 2));
});

test("409: stale revision preserves real Ketcher edits and requires explicit reload", async ({ page, request }) => {
  const fixture = await seed(request);
  const base = `${api}/${fixture.projectId}/structure-candidates/${fixture.candidate_id}`;
  await open(page, fixture.projectId);
  await edit(page);
  const before = await page.evaluate(async () => (window as unknown as { __ketcher: { getMolfile: () => Promise<string> } }).__ketcher.getMolfile());
  const competing = await request.post(`${base}/representations`, { data: { representation_type: "SMILES", smiles: "CCN", parent_representation_id: fixture.original_id } });
  expect(competing.status()).toBe(201);
  await page.getByRole("button", { name: "Save corrected representation", exact: true }).click();
  await expect(page.getByTestId("b3-workbench").getByRole("alert")).toContainText("HTTP 409");
  const after = await page.evaluate(async () => (window as unknown as { __ketcher: { getMolfile: () => Promise<string> } }).__ketcher.getMolfile());
  expect(after.split("\n").slice(3)).toEqual(before.split("\n").slice(3));
  await expect(page.getByRole("button", { name: "Validate edited graph", exact: true })).toBeEnabled();
  await screenshot(page, "06-conflict-edits-kept.png");
});

test("E/Z assignments survive Ketcher editing; invalid valence is visible without losing the drawing", async ({ page, request }) => {
  const fixture = await seed(request, "C/C=C/C");
  await open(page, fixture.projectId);
  await edit(page);
  await page.getByRole("button", { name: "Validate edited graph", exact: true }).click();
  await expect(page.getByTestId("b3-validation")).toContainText(": E");
  // Feed a real edited molecular representation to Ketcher, then export its MOL depiction.
  await page.evaluate(async () => (window as unknown as { __ketcher: { setMolecule: (s: string) => Promise<void> } }).__ketcher.setMolecule("C/C=C\\C"));
  await expect(page.getByTestId("b3-validation")).toHaveCount(0);
  await page.getByRole("button", { name: "Validate edited graph", exact: true }).click();
  await expect(page.getByTestId("b3-validation")).toContainText(": Z");
  await expect(page.getByTestId("b3-differences")).toContainText("DOUBLE_BOND_STEREOCHEMISTRY");
  await screenshot(page, "08-ez-difference.png");
  await page.evaluate(async () => (window as unknown as { __ketcher: { setMolecule: (s: string) => Promise<void> } }).__ketcher.setMolecule("C(C)(C)(C)(C)C"));
  await page.getByRole("button", { name: "Validate edited graph", exact: true }).click();
  await expect(page.getByTestId("b3-validation")).toContainText("INVALID GRAPH");
  await expect(page.getByTestId("b3-validation")).toContainText("Valence violation");
  await expect(page.getByRole("button", { name: "Save corrected representation", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Validate edited graph", exact: true })).toBeEnabled();
  await page.screenshot({ path: resolve(evidence, "09-invalid-valence-editor.png"), fullPage: true });
});

test("unsaved Ketcher edits: clean editor closes silently; dirty editor warns on close and page unload", async ({ page, request }) => {
  const fixture = await seed(request);
  await open(page, fixture.projectId);
  const beforeUnloadPrevented = () => page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  await edit(page);
  expect(await beforeUnloadPrevented()).toBe(false);
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Correct graph in Ketcher", exact: true })).toBeEnabled();
  await edit(page);
  await page.getByRole("button", { name: "N", exact: true }).click();
  await page.locator(".ketcher-frame svg text").filter({ hasText: /^O$/ }).first().click({ force: true });
  await expect.poll(beforeUnloadPrevented).toBe(true);
  const dialogs: string[] = [];
  let accept = false;
  page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await (accept ? dialog.accept() : dialog.dismiss()); });
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain("unsaved molecular edits");
  await expect(page.getByRole("button", { name: "Validate edited graph", exact: true })).toBeVisible();
  accept = true;
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Correct graph in Ketcher", exact: true })).toBeEnabled();
  expect(dialogs).toHaveLength(2);
});
