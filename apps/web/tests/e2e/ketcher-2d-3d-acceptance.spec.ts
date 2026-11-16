import { readFileSync } from "node:fs";
import { openImport } from "./helpers/molecule-editor-mocks";
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { createLegacyRaw2DFixture } from "./isolated-fixtures";
import type { GeometryCandidateAcceptOutput, GeometryCandidateView } from "@chemdft/schemas";

// All chemistry is drawn through Ketcher. API reads assert stored identity;
// routing only delays genuine API responses (or simulates transport failure).
const apiRoot = "/api/chemdft/v1/projects";
const generationPattern = "**/geometry-candidates";

type EditorExport = { smiles: string; mol: string };
async function editorExport(page: Page): Promise<EditorExport> {
  return page.evaluate(async () => {
    const k = (window as unknown as { __ketcher: { getSmiles(): Promise<string>; getMolfile(): Promise<string> } }).__ketcher;
    // Ketcher occasionally returns a bare sequence instead of a MOL block; read again until it is a MOL block.
    let mol = await k.getMolfile();
    for (let attempt = 0; attempt < 5 && !/M {2}END/.test(mol); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      mol = await k.getMolfile();
    }
    return { smiles: await k.getSmiles(), mol };
  });
}

/**
 * Project creation is a setup step here (the scenarios test geometry safety, not onboarding): the project is created
 * through the API and opened in the Advanced Workbench. The UI path to a new project is the welcome page.
 */
async function createProject(page: Page, label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const created = await page.request.post(apiRoot, { data: { name: `${label} ${suffix}`, slug: `geometry-${suffix}` } });
  expect(created.status()).toBe(201);
  const project = (await created.json()).id as string;
  await page.goto(`/en/projects/${project}/workspace`);
  await expect(page).toHaveURL(/\/projects\/[^/]+\/workspace/);
  await page.getByRole("button", { name: "Advanced Workbench", exact: true }).click();
  await page.getByRole("button", { name: "Hide Explorer", exact: true }).click();
  await page.getByRole("button", { name: "Hide context panel", exact: true }).click();
  return project;
}

async function openDrawing(page: Page, name: string) {
  const draw = page.getByRole("button", { name: "Draw molecule", exact: true });
  if (await draw.isVisible()) await draw.click();
  else {
    if (!await page.getByRole("button", { name: "New molecule", exact: true }).isVisible()) {
      await page.getByRole("tab", { name: "Project", exact: true }).click();
    }
    await page.getByRole("button", { name: "New molecule", exact: true }).click();
    await page.getByRole("button", { name: /Draw manually/i }).click();
  }
  await expect(page.getByTestId("ketcher-editor-panel")).toBeVisible();
  await expect(page.getByTestId("generate-3d-btn")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("molecule-name-input").fill(name);
}

async function canvasPoint(page: Page, index: number) {
  const canvas = page.getByTestId("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Ketcher canvas missing");
  return { x: box.x + 170 + index * 34.641, y: box.y + 220 - (index % 2) * 20 };
}

async function bond(page: Page, index: number) {
  await page.getByTestId("tool-bond-single").click();
  const a = await canvasPoint(page, index), b = await canvasPoint(page, index + 1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

async function drawChain(page: Page, carbons: number) {
  // Ketcher's own toolbar is hidden by the molecule editor: clear through the labelled Select tool, Select all and Delete.
  // (setMolecule("") made getMolfile return a bare SMILES-like sequence in this build, which the server rejects.)
  await page.getByTestId("tool-select").click();
  const area = await page.getByTestId("canvas").boundingBox();
  if (area) await page.mouse.click(area.x + 30, area.y + 30);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  for (let i = 0; i < carbons - 1; i++) await bond(page, i);
  expect((await editorExport(page)).smiles).toBe("C".repeat(carbons));
}

async function replaceAtom(page: Page, index: number, element: string) {
  await page.getByRole("button", { name: element, exact: true }).click();
  const p = await canvasPoint(page, index);
  await page.mouse.click(p.x, p.y);
}

async function generate(page: Page): Promise<GeometryCandidateView> {
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith("/geometry-candidates") && r.request().method() === "POST"),
    page.getByTestId("generate-3d-btn").click(),
  ]);
  expect(response.status()).toBe(201);
  const candidate: GeometryCandidateView = await response.json();
  await expect(page.getByTestId("candidate-preview-container")).toBeVisible();
  return candidate;
}

async function inspectCandidate(page: Page, candidate: GeometryCandidateView, smiles: string, formula: string, atoms: number, bonds: number) {
  expect(candidate.manifest.canonical_smiles).toBe(smiles);
  expect(candidate.manifest.formula).toBe(formula);
  expect(candidate.manifest.geometry_class).toBe("GENERATED_CONFORMER_NOT_OPTIMIZED");
  const coords = candidate.manifest.coordinate_representation.coordinates;
  expect(coords.atoms).toHaveLength(atoms);
  expect(coords.bonds).toHaveLength(bonds);
  expect(coords.atoms.every(a => [a.x, a.y, a.z].every(Number.isFinite))).toBe(true);
  await expect(page.getByTestId("candidate-metrics-card")).toContainText(formula);
  await expect(page.getByTestId("candidate-metrics-card")).toContainText(`${atoms} atoms`);
  await expect(page.getByTestId("candidate-metrics-card")).toContainText(`${bonds} bonds`);
  await expect(page.getByTestId("ack-inspected-geometry")).not.toBeChecked();
  await expect(page.getByTestId("ack-understands-not-optimized")).not.toBeChecked();
  await expect(page.getByTestId("accept-geometry-btn")).toBeDisabled();
}

async function review(page: Page) {
  await page.getByTestId("ack-inspected-geometry").check();
  await page.getByTestId("ack-understands-not-optimized").check();
  // RW-3.2: a new version whose composition differs from its parent needs an explicit decision.
  const lineageAck = page.getByTestId("ack-lineage-composition");
  if (await lineageAck.count()) await lineageAck.check();
  await expect(page.getByTestId("accept-geometry-btn")).toBeEnabled();
}

async function accept(page: Page, project: string, candidate: GeometryCandidateView) {
  await review(page);
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith(`/geometry-candidates/${candidate.id}/accept`) && r.request().method() === "POST"),
    page.getByTestId("accept-geometry-btn").click(),
  ]);
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON().candidate_sha256).toBe(candidate.candidate_artifact.sha256);
  const output: GeometryCandidateAcceptOutput = await response.json();
  expect(output.candidate_id).toBe(candidate.id);
  expect(output.version.project_id).toBe(project);
  expect(output.version.coordinates?.atoms).toEqual(candidate.manifest.coordinate_representation.coordinates.atoms);
  expect(output.version.coordinates?.bonds).toEqual(candidate.manifest.coordinate_representation.coordinates.bonds);
  expect(output.calculation_eligibility.eligible).toBe(true);
  await expect(page.getByTestId("ketcher-editor-panel")).toBeHidden();
  const base = `${apiRoot}/${project}/structures/${output.structure.id}/versions/${output.version.id}`;
  const persisted = await page.request.get(base);
  expect(persisted.status()).toBe(200);
  expect((await persisted.json()).version.coordinates).toEqual(output.version.coordinates);
  const eligibility = await page.request.get(`${base}/calculation-eligibility`);
  expect(eligibility.status()).toBe(200);
  expect((await eligibility.json()).eligible).toBe(true);
  return output;
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(name), fullPage: true });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

async function renderTurn(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

// Cases are independent: a failure in one must not skip the remaining cases.
test.describe("ChemDFT 2D-to-3D Browser Workflow", () => {
  test.setTimeout(240_000);

  test("Scenarios A-D & H: real drawing, invalidation, both async orderings, recovery and accepted identity", async ({ page }, info) => {
    const project = await createProject(page, "Async geometry regression");
    await openDrawing(page, "n-Hexane");
    await drawChain(page, 6);
    const hexane = await generate(page);
    await inspectCandidate(page, hexane, "CCCCCC", "C6H14", 20, 19);
    await page.getByText(/Inspect Atomic Coordinates/).click();
    await expect(page.locator("details table tbody tr")).toHaveCount(20);
    const viewport = page.locator(".candidate-preview-viewport canvas, canvas").first();
    await viewport.scrollIntoViewIfNeeded();
    const box = await viewport.boundingBox();
    if (!box) throw new Error("Generated 3D viewport missing");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 - 30, { steps: 8 });
    await page.mouse.up();
    await page.mouse.wheel(0, -100);
    await review(page);
    await screenshot(page, info, "hexane-reviewed.png");
    await bond(page, 5);
    expect((await editorExport(page)).smiles).toBe("CCCCCCC");
    await expect(page.getByTestId("candidate-preview-container")).toBeHidden();
    await expect(page.getByRole("button", { name: "View Generated 3D Candidate" })).toBeHidden();
    await expect(page.getByTestId("accept-geometry-btn")).toBeHidden();
    await expect(page.getByTestId("generate-3d-btn")).toBeEnabled();
    const heptane = await generate(page);
    expect(heptane.id).not.toBe(hexane.id);
    expect(heptane.manifest.source_graph_sha256).not.toBe(hexane.manifest.source_graph_sha256);
    await inspectCandidate(page, heptane, "CCCCCCC", "C7H16", 23, 22);

    let current = heptane;
    for (const oldFirst of [true, false]) {
      const ready = [deferred<GeometryCandidateView>(), deferred<GeometryCandidateView>()] as const;
      const release = [deferred<void>(), deferred<void>()] as const;
      const delivered = [deferred<void>(), deferred<void>()] as const;
      let requestIndex = 0;
      const handler = async (route: Route) => {
        if (route.request().method() !== "POST") return route.continue();
        const i = requestIndex++;
        if (i !== 0 && i !== 1) throw new Error("Unexpected extra generation request");
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        ready[i].resolve(await response.json());
        await release[i].promise;
        await route.fulfill({ response });
        delivered[i].resolve();
      };
      await page.route(generationPattern, handler);
      try {
        await page.getByTestId("generate-3d-btn").click();
        const stale = await ready[0].promise;
        await replaceAtom(page, 6, oldFirst ? "O" : "C");
        expect((await editorExport(page)).smiles).toBe(oldFirst ? "CCCCCCO" : "CCCCCCC");
        await expect(page.getByTestId("generate-3d-btn")).toBeEnabled();
        await expect(page.getByTestId("accept-geometry-btn")).toBeHidden();
        await page.getByTestId("generate-3d-btn").click();
        const fresh = await ready[1].promise;
        expect(fresh.id).not.toBe(stale.id);
        expect(fresh.manifest.source_graph_sha256).not.toBe(stale.manifest.source_graph_sha256);
        if (oldFirst) {
          release[0].resolve(); await delivered[0].promise; await renderTurn(page);
          await expect(page.getByTestId("generate-3d-btn")).toBeDisabled();
          await expect(page.getByTestId("candidate-preview-container")).toBeHidden();
          release[1].resolve(); await delivered[1].promise;
        } else {
          release[1].resolve(); await delivered[1].promise;
        }
        await expect(page.getByTestId("candidate-preview-container")).toBeVisible();
        await inspectCandidate(page, fresh, oldFirst ? "CCCCCCO" : "CCCCCCC", oldFirst ? "C6H14O" : "C7H16", oldFirst ? 21 : 23, oldFirst ? 20 : 22);
        await review(page);
        if (!oldFirst) {
          release[0].resolve(); await delivered[0].promise; await renderTurn(page);
          await expect(page.getByTestId("ack-inspected-geometry")).toBeChecked();
          await expect(page.getByTestId("accept-geometry-btn")).toBeEnabled();
          await expect(page.getByTestId("candidate-metrics-card")).toContainText("C7H16");
        }
        await info.attach(`race-${oldFirst ? "old-first" : "new-first"}.json`, { body: JSON.stringify({ stale, fresh }), contentType: "application/json" });
        await screenshot(page, info, `race-${oldFirst ? "old-first" : "new-first"}.png`);
        current = fresh;
      } finally {
        release.forEach(d => d.resolve());
        await page.unroute(generationPattern, handler);
      }
    }

    // A transport rejection must also leave regeneration available.
    await page.route(generationPattern, route => route.abort("failed"), { times: 1 });
    await page.getByTestId("generate-3d-btn").click();
    await expect(page.getByTestId("geometry-error-box")).toBeVisible();
    await expect(page.getByTestId("generate-3d-btn")).toBeEnabled();
    current = await generate(page);
    await inspectCandidate(page, current, "CCCCCCC", "C7H16", 23, 22);
    const beforeClock = (await editorExport(page)).mol;
    // Indigo runs in a worker with its own clock: observe a genuine rollover.
    await expect.poll(async () => (await editorExport(page)).mol.split("\n")[1], {
      timeout: 65_000, intervals: [1_000],
    }).not.toBe(beforeClock.split("\n")[1]);
    const afterClock = (await editorExport(page)).mol;
    expect(afterClock.split("\n")[1]).not.toBe(beforeClock.split("\n")[1]);
    expect(afterClock.replace(/(-INDIGO-)\d{10}/, "$1")).toBe(beforeClock.replace(/(-INDIGO-)\d{10}/, "$1"));
    const accepted = await accept(page, project, current);
    await info.attach("accepted-identity.json", { body: JSON.stringify(accepted), contentType: "application/json" });

    // Availability probes may take longer than the default 5-second assertion.
    // Await the actual response and explicitly choose a supported configuration.
    const capabilities = page.waitForResponse(r => r.url().endsWith("/calculations/capabilities"), { timeout: 60_000 });
    await page.getByRole("button", { name: "Calculate", exact: true }).click();
    expect((await capabilities).status()).toBe(200);
    const panel = page.locator(".calculation-panel");
    // Psi4 is not configured on every deployment: use it when the server reports it available,
    // otherwise run the same readiness check with PySCF instead of failing at this step.
    const psi4Option = panel.getByLabel("Engine").locator('option[value="psi4"]');
    await expect(panel.getByLabel("Engine")).toBeVisible({ timeout: 30_000 });
    const psi4Available = await psi4Option.count() > 0 && await psi4Option.isEnabled();
    if (psi4Available) {
      await panel.getByLabel("Engine").selectOption("psi4");
      await panel.getByLabel("Method").selectOption("hf");
      await panel.getByLabel("Basis").selectOption("sto-3g");
      await expect(panel.getByRole("button", { name: "Run Psi4 energy", exact: true })).toBeEnabled();
    } else {
      await panel.getByLabel("Engine").selectOption("pyscf");
      await panel.getByLabel("Method").selectOption("hf");
      await panel.getByLabel("Basis").selectOption("sto-3g");
      await expect(panel.getByRole("button", { name: "Run energy", exact: true })).toBeEnabled();
    }
    await expect(page.getByTestId("calculation-geometry-ineligible")).toBeHidden();
    await screenshot(page, info, "accepted-calculation-ready.png");
  });

  test("Scenario E: ASCII and Unicode export/edit preserve parent, project and immutable lineage", async ({ page }, info) => {
    const project = await createProject(page, "Unicode version regression");
    for (const name of ["Hexane", "Bakı – Hexane", "β-Ethanol", "Бензол"]) {
      await openDrawing(page, name);
      await drawChain(page, 6);
      const candidate = await generate(page);
      const original = await accept(page, project, candidate);
      expect(original.structure.name).toBe(name);
      const base = `${apiRoot}/${project}/structures/${original.structure.id}/versions/${original.version.id}`;
      const before = await (await page.request.get(base)).json();
      const exported = page.waitForResponse(r => r.url().includes(`/versions/${original.version.id}/export?file_format=MOL`));
      await page.getByRole("button", { name: /^(Edit|Edit molecular structure|New version)$/i }).first().click();
      const response = await exported;
      expect(response.status()).toBe(200);
      const disposition = response.headers()["content-disposition"] ?? "";
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename = encoded ? decodeURIComponent(encoded) : disposition.match(/filename="([^"]+)"/)?.[1];
      expect(filename).toBe(`${name}.mol`);
      await expect(page.getByTestId("ketcher-editor-panel")).toBeVisible();
      await expect(page.getByTestId("generate-3d-btn")).toBeEnabled();
      // Clear/redraw is an actual edit of the exported existing version.
      await drawChain(page, 3);
      await replaceAtom(page, 2, "O");
      expect((await editorExport(page)).smiles).toBe("CCO");
      const revisedDrawing = await editorExport(page);
      const generation = page.waitForResponse(r => r.url().endsWith("/geometry-candidates") && r.request().method() === "POST");
      const revised = await generate(page);
      const parent = { entity_type: "structure.version", entity_id: original.version.id, project_id: project };
      expect((await generation).request().postDataJSON().parent_structure_version).toEqual(parent);
      await inspectCandidate(page, revised, "CCO", "C2H6O", 9, 8);
      const child = await accept(page, project, revised);
      expect(child.structure.id).toBe(original.structure.id);
      expect(child.version.parent_version_id).toBe(original.version.id);
      expect(child.version.revision).toBe(2);
      expect(await (await page.request.get(base)).json()).toEqual(before);
      const other = await page.request.post(apiRoot, { data: { name: "Cross-project rejection", slug: `cross-${crypto.randomUUID()}` } });
      expect(other.status()).toBe(201);
      const otherId = (await other.json()).id;
      const rejected = await page.request.post(`${apiRoot}/${otherId}/geometry-candidates`, { data: {
        mol_block: revisedDrawing.mol,
        name, expected_charge: 0, multiplicity: 1, parent_structure_version: parent,
      } });
      expect(rejected.status()).toBe(404);
      await info.attach(`${name}-lineage.json`, { body: JSON.stringify({ original, revised, child, rejected: await rejected.json() }), contentType: "application/json" });
      await screenshot(page, info, `unicode-${original.structure.id}.png`);
    }
  });

  test("Scenario F: mouse-drawn ethanol and ethylamine have correct composition and review text", async ({ page }, info) => {
    await createProject(page, "Heteroatom regression");
    await openDrawing(page, "Ethanol");
    await drawChain(page, 3);
    await replaceAtom(page, 2, "O");
    expect((await editorExport(page)).smiles).toBe("CCO");
    const ethanol = await generate(page);
    await inspectCandidate(page, ethanol, "CCO", "C2H6O", 9, 8);
    await expect(page.getByTestId("candidate-metrics-card")).toContainText("2 carbons, 1 oxygen");
    await expect(page.getByTestId("candidate-acknowledgments")).toContainText("9 total: 2 carbons + 1 oxygen + 6 hydrogens");
    await screenshot(page, info, "ethanol-composition.png");
    await replaceAtom(page, 2, "N");
    expect((await editorExport(page)).smiles).toBe("CCN");
    const amine = await generate(page);
    await inspectCandidate(page, amine, "CCN", "C2H7N", 10, 9);
    await expect(page.getByTestId("candidate-metrics-card")).toContainText("2 carbons, 1 nitrogen");
    await expect(page.getByTestId("candidate-acknowledgments")).toContainText("10 total: 2 carbons + 1 nitrogen + 7 hydrogens");
    await screenshot(page, info, "ethylamine-composition.png");
    // No calculation is submitted for ethylamine.
  });

  test("Scenario I: pasted SMILES loads, real Generate 3D, review text and Accept; invalid SMILES is refused", async ({ page }, info) => {
    const project = await createProject(page, "Pasted SMILES");
    await openDrawing(page, "Acetic acid");
    // Invalid text never reaches the canvas.
    await openImport(page);
    await page.getByTestId("editor-load-input").fill("CC(=O");
    await page.getByTestId("editor-load-button").click();
    await expect(page.getByTestId("editor-load-message")).toContainText("never closed");
    await expect(page.getByTestId("editor-smiles")).toHaveText("Nothing drawn yet");
    // Valid SMILES: loaded, read back by Ketcher, then the server builds the 3D structure.
    await openImport(page);
    await page.getByTestId("editor-load-input").fill("CC(=O)O");
    await page.getByTestId("editor-load-button").click();
    await expect(page.getByTestId("check-formula")).toHaveText("C2H4O2");
    const candidate = await generate(page);
    await inspectCandidate(page, candidate, "CC(=O)O", "C2H4O2", 8, 7);
    await screenshot(page, info, "pasted-acetic-acid.png");
    const accepted = await accept(page, project, candidate);
    expect(accepted.structure.name).toBe("Acetic acid");
    expect(accepted.version.revision).toBe(1);
  });

  test("Scenario J: an AI-drawn molecule (draw endpoint mocked, real Ketcher) gets a real Generate 3D and Accept", async ({ page }, info) => {
    const project = await createProject(page, "AI drawn ethanol");
    await openDrawing(page, "AI drawn ethanol");
    // Only the model step is replaced: the plan is a real RDKit-validated DrawResponse (tools/gen_draw_fixtures.py).
    const plan = JSON.parse(readFileSync(new URL("./fixtures/ai-draw/ethanol.json", import.meta.url), "utf8")) as Record<string, unknown>;
    await page.route("**/ai/conversations/*/draw", (route) => route.fulfill({ json: plan }));
    await page.getByTestId("editor-tab-ai").click();
    await page.getByTestId("ai-draw-input").fill("draw ethanol");
    await page.getByTestId("ai-draw-send").click();
    await expect(page.getByTestId("ai-draw-send")).toHaveText("Send", { timeout: 30_000 });
    await expect(page.getByTestId("check-formula")).toHaveText("C2H6O");
    await expect(page.getByTestId("ai-draft-banner")).toBeVisible();
    const candidate = await generate(page);
    await inspectCandidate(page, candidate, "CCO", "C2H6O", 9, 8);
    await screenshot(page, info, "ai-drawn-ethanol.png");
    const accepted = await accept(page, project, candidate);
    expect(accepted.structure.name).toBe("AI drawn ethanol");
    expect(accepted.version.revision).toBe(1);
  });

  test("Scenario G: newly drawn raw 2D geometry is blocked in Guided, Advanced and direct API", async ({ page }, info) => {
    const project = await createProject(page, "Raw 2D safety regression");
    await openDrawing(page, "Raw 2D n-Hexane");
    await drawChain(page, 6);
    const raw = await editorExport(page);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    // The running API must reject new raw 2D imports. Reproduce an old importer
    // record separately in the disposable workspace to exercise legacy safety.
    const importedResponse = await page.request.post(`${apiRoot}/${project}/structures/imports`, { multipart: {
      file_format: "MOL", structure_name: "Raw 2D n-Hexane", idempotency_key: crypto.randomUUID(),
      upload: { name: "drawn-2d.mol", mimeType: "chemical/x-mdl-molfile", buffer: Buffer.from(raw.mol) },
    } });
    expect(importedResponse.status()).toBe(422);
    expect((await importedResponse.json()).detail).toContain("GEOMETRY_2D_REQUIRES_GENERATION");
    const fixture = createLegacyRaw2DFixture(project, raw.mol);
    expect(fixture.project_id).toBe(project);
    const structure = fixture.structure_id;
    const version = fixture.version_id;
    const base = `${apiRoot}/${project}/structures/${structure}/versions/${version}`;
    const before = await (await page.request.get(base)).json();
    const eligibility = await page.request.get(`${base}/calculation-eligibility`);
    expect((await eligibility.json()).eligible).toBe(false);
    await page.goto(`/en/projects/${project}/workspace?selection=structureVersion%3A${version}&source=${structure}`);
    await page.getByRole("button", { name: "Guided", exact: true }).click();
    // The Structure stage states the server's verdict itself; there is no path to Configure or Submit from it.
    await expect(page.getByTestId("guided-geometry-ineligible")).toContainText("GEOMETRY_2D_REQUIRES_GENERATION");
    await expect(page.getByTestId("guided-primary-fix-geometry")).toBeVisible();
    await expect(page.getByTestId("guided-primary-to-configure")).toHaveCount(0);
    await expect(page.getByTestId("run-calculation-btn")).toHaveCount(0);
    await screenshot(page, info, "raw-2d-guided.png");
    await page.getByRole("button", { name: "Advanced Workbench", exact: true }).click();
    if (!await page.locator(".calculation-panel").isVisible()) {
      await page.getByRole("button", { name: "Calculate", exact: true }).click();
    }
    await expect(page.getByTestId("calculation-geometry-ineligible")).toContainText("GEOMETRY_2D_REQUIRES_GENERATION");
    await expect(page.locator(".calculation-panel").getByRole("button", { name: /^Run / })).toBeDisabled();
    const rejected = await page.request.post(`${apiRoot}/${project}/calculations`, { data: {
      structure_version: { entity_type: "structure.version", entity_id: version, project_id: project },
      specification: {
        task_type: "ENERGY", method: { identifier: "hf", display_name: "Hartree-Fock", registry: "chemdft.method" },
        basis: { identifier: "sto-3g", display_name: "STO-3G", registry: "chemdft.basis" }, charge: 0, multiplicity: 1,
        engine_preference: { engine: "psi4", allowed_version: "1.11" },
      }, idempotency_key: crypto.randomUUID(),
    } });
    expect(rejected.status()).toBe(422);
    expect((await rejected.json()).detail).toContain("GEOMETRY_2D_REQUIRES_GENERATION");
    expect(await (await page.request.get(base)).json()).toEqual(before);
    await screenshot(page, info, "raw-2d-advanced.png");
  });
});
