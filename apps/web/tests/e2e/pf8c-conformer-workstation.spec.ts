import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { CalculationDetail, ConformerEnsembleResult, StructureVersion } from "@chemdft/schemas";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildConformerSubmission } from "../../src/lib/conformer-ensemble";

const output = resolve("../../output/playwright/pf8c-gate-c");
mkdirSync(output, { recursive: true });
async function seed(request: APIRequestContext, molecule: string, existingProject?: string) {
  const project: string = existingProject ?? await (async () => {
    const response = await request.post("/api/chemdft/v1/projects", { data: { name: `PF-8C ${molecule} workstation`, slug: `pf8c-${crypto.randomUUID()}` } });
    expect(response.status()).toBe(201); return (await response.json()).id;
  })();
  const xyz = readFileSync(resolve(`../../services/api/tests/fixtures/crest/${molecule}.xyz`)).toString().replace("\n\n", `\nNative ${molecule} input\n`);
  const imported = await request.post(`/api/chemdft/v1/projects/${project}/structures/imports`, { multipart: {
    upload: { name: `${molecule}.xyz`, mimeType: "chemical/x-xyz", buffer: Buffer.from(xyz) }, file_format: "XYZ", idempotency_key: crypto.randomUUID(),
  } });
  expect(imported.status(), await imported.text()).toBe(201);
  return { project, input: (await imported.json()).version as StructureVersion };
}
async function complete(request: APIRequestContext, project: string, id: string) {
  let detail: CalculationDetail;
  await expect.poll(async () => {
    detail = await (await request.get(`/api/chemdft/v1/projects/${project}/calculations/${id}`)).json();
    return ["SUCCEEDED", "FAILED", "CANCELED"].includes(detail.calculation.state);
  }, { timeout: 240_000, intervals: [1000, 1500] }).toBe(true);
  expect(detail!.calculation.state, JSON.stringify(detail!.attempt)).toBe("SUCCEEDED");
  return detail!;
}
async function configure(page: Page, project: string, input: StructureVersion, mode: "guided" | "advanced") {
  await page.goto(`/en/projects/${project}/workspace${mode === "guided" ? `?selection=structureVersion:${input.id}&source=${input.structure_id}` : ""}`);
  if (mode === "guided") await page.getByTestId("guided-nav-overview").click();
  if (mode === "advanced") {
    await page.getByTestId("mode-toggle-advanced").click();
    await page.locator(".calculation-panel").getByRole("combobox", { name: "Task", exact: true }).selectOption("CONFORMER_SEARCH");
  } else await page.getByTestId("guided-goal-conformer").click();
  const setup = page.locator('[data-testid="conformer-search-setup"]:visible');
  await expect(setup).toHaveAttribute("data-structure-version-id", input.id);
  await setup.getByRole("checkbox").check();
  await expect(setup.getByRole("button", { name: "Start conformer search", exact: true })).toBeEnabled();
}
async function submitFromUi(page: Page, request: APIRequestContext, project: string, mode: string, molecule: string) {
  await page.screenshot({ path: resolve(output, `${mode}-${molecule}-setup.png`), fullPage: true });
  const responsePromise = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/calculations"));
  await page.getByRole("button", { name: "Start conformer search", exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  const submission = response.request().postDataJSON();
  expect(submission.specification.engine_preference).toEqual({ engine: "crest", allowed_version: "3.0.2+pf8c-ewinfix-a1" });
  expect(submission.specification.conformer_search).toMatchObject({ workflow: "imtd-gc", optimization_level: "vtight", energy_window_kcal_mol: 6, threads: 2 });
  const queued: CalculationDetail = await response.json();
  await expect(page.getByRole("region", { name: "Conformer search status" })).toContainText(queued.calculation.id);
  const detail = await complete(request, project, queued.calculation.id);
  await page.getByRole("button", { name: "Open completed ensemble", exact: true }).click();
  const ensemble = page.locator('[data-testid="conformer-ensemble"]:visible');
  await expect(ensemble).toHaveAttribute("data-result-id", detail.result!.id);
  await expect(ensemble).toHaveAttribute("data-calculation-id", detail.calculation.id);
  await expect(ensemble.getByLabel("Scientific View molecule viewport").locator("canvas")).toBeVisible({ timeout: 60_000 });
  await expect(ensemble).toContainText("Minimum status: Unverified (UNVERIFIED)");
  await expect(ensemble).toContainText("Gradient convergence does not prove");
  for (const claim of ["Verified stable conformer", "Confirmed local minimum", "Thermodynamically preferred structure", "Verified minimum-energy geometry", "All molecular conformations discovered"]) await expect(ensemble).not.toContainText(claim);
  expect(detail.result!.trusted_producer_id).toBe("local.crest.worker");
  expect(detail.result!.validation_state).toBe("VALIDATED");
  // Exact native records are saved for audit; no reference energies are manufactured.
  writeFileSync(resolve(output, `${mode}-${molecule}-native.json`), JSON.stringify({ project, detail, submission }, null, 2));
  return detail;
}
async function assertMember(page: Page, payload: ConformerEnsembleResult, index: number) {
  const member = payload.manifest.members[index]!;
  const ensemble = page.locator('[data-testid="conformer-ensemble"]:visible');
  await ensemble.getByRole("button", { name: `Select member ${member.application_rank}`, exact: true }).click();
  await expect(ensemble).toHaveAttribute("data-member-id", member.conformer.id);
  await expect(ensemble.getByTestId("conformer-selected-energy")).toContainText(`${member.native_electronic_energy.value.toFixed(8)} Eh`);
  await expect(ensemble.getByTestId("conformer-selected-energy")).toContainText(`${member.conformer.relative_energy!.value} kcal/mol`);
  await expect(ensemble.getByTestId("conformer-selected-energy")).toContainText(`${member.native_rank} / ${member.application_rank}`);
  await expect(ensemble.getByTestId("conformer-geometry")).toHaveAttribute("data-native-record-sha256", member.native_record_sha256);
  const coordinates = ensemble.getByRole("table", { name: "Selected member coordinates", exact: true });
  if (!await coordinates.isVisible()) await ensemble.getByText("Selected member coordinates (Å)", { exact: true }).click();
  const actual = await coordinates.locator("tbody tr").evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll("td")].slice(1).map((cell) => Number(cell.textContent))));
  expect(actual).toEqual(member.conformer.coordinates.atoms.map((atom) => [atom.x, atom.y, atom.z]));
}
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });

test("Guided water: actual one-member ensemble with no source mutation", async ({ page, request }) => {
  const { project, input } = await seed(request, "water");
  await configure(page, project, input, "guided");
  const detail = await submitFromUi(page, request, project, "guided", "water");
  const payload = detail.result!.payload as ConformerEnsembleResult;
  expect(payload.manifest.members).toHaveLength(1);
  await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toContainText("One retained member; no inter-member comparison");
  await assertMember(page, payload, 0);
  const versions = await (await request.get(`/api/chemdft/v1/projects/${project}/structures/${input.structure_id}/versions`)).json();
  expect(versions).toHaveLength(1); expect(versions[0].version.coordinates).toEqual(input.coordinates);
  await page.screenshot({ path: resolve(output, "guided-water-completed.png"), fullPage: true });
});

test("Guided ethanol: native ranking, geometry/energy switching, refresh, provenance, and delayed cross-run isolation", async ({ page, request }) => {
  const originalActive = await seed(request, "water");
  const { project, input } = await seed(request, "ethanol", originalActive.project);
  await configure(page, project, originalActive.input, "guided");
  const setup = page.locator('[data-testid="conformer-search-setup"]:visible');
  await setup.getByRole("combobox", { name: "Input StructureVersion", exact: true }).selectOption(input.id);
  await expect(setup).toHaveAttribute("data-structure-version-id", input.id);
  await expect(setup.getByRole("checkbox")).not.toBeChecked();
  await setup.getByRole("checkbox").check();
  const detail = await submitFromUi(page, request, project, "guided", "ethanol");
  const payload = detail.result!.payload as ConformerEnsembleResult;
  expect(payload.manifest.members.length).toBeGreaterThan(1);
  await assertMember(page, payload, 0);
  const canvas = page.locator('[data-testid="conformer-ensemble"]:visible').getByLabel("Scientific View molecule viewport").locator("canvas");
  const firstImage = await canvas.screenshot();
  await page.screenshot({ path: resolve(output, "guided-ethanol-member-1.png"), fullPage: true });
  await assertMember(page, payload, 1);
  await expect.poll(async () => firstImage.equals(await canvas.screenshot())).toBe(false);
  await page.screenshot({ path: resolve(output, "guided-ethanol-member-2.png"), fullPage: true });
  // Arrow-key selection must move the same bound member, not just keyboard focus.
  await page.getByRole("button", { name: "Select member 2", exact: true }).press("Home");
  await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toHaveAttribute("data-member-id", payload.manifest.members[0].conformer.id);
  await assertMember(page, payload, 1);
  await page.reload();
  await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toHaveAttribute("data-member-id", payload.manifest.members[1]!.conformer.id);
  await page.getByTestId("guided-nav-overview").click();
  await page.getByTestId("guided-nav-conformers").click();
  await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toHaveAttribute("data-member-id", payload.manifest.members[1]!.conformer.id);
  await page.getByTestId("conformer-provenance").getByText("Scientific provenance and native evidence", { exact: true }).click();
  const provenance = page.getByTestId("conformer-provenance");
  await expect(provenance).toContainText("embedded-tblite-0.3.0-fork");
  await expect(provenance).toContainText("3.0.2+pf8c-ewinfix-a1");
  await expect(provenance).toContainText("6 / 6 kcal/mol");
  await expect(provenance).toContainText("not independent numerical recomputation");
  await expect(provenance).toContainText(input.id);
  await provenance.getByRole("button", { name: "Inspect crest.energies", exact: true }).click();
  await expect(provenance.getByRole("region", { name: "Native artifact preview" })).toContainText("crest.energies");
  const downloadPromise = page.waitForEvent("download");
  await provenance.getByRole("button", { name: "Download crest_conformers.xyz", exact: true }).click();
  const download = await downloadPromise; await download.saveAs(resolve(output, "ethanol-native-crest_conformers.xyz"));
  await page.screenshot({ path: resolve(output, "guided-ethanol-provenance.png"), fullPage: true });
  const water = await seed(request, "water", project);
  const submitted = await request.post(`/api/chemdft/v1/projects/${project}/calculations`, { data: buildConformerSubmission(project, water.input.id, crypto.randomUUID()) });
  expect(submitted.status()).toBe(201);
  const other = await complete(request, project, (await submitted.json()).calculation.id);
  // Refresh catalog while retaining the exact ethanol result and member.
  await page.reload();
  await expect(page.getByTestId("guided-result-picker").locator(`option[value="${other.result!.id}"]`)).toBeAttached();
  await page.route(`**/calculations/${other.calculation.id}`, async (route) => { const response = await route.fetch(); await new Promise((resolve) => setTimeout(resolve, 1200)); await route.fulfill({ response }); });
  await page.getByTestId("guided-result-picker").selectOption(other.result!.id);
  await page.getByTestId("guided-result-picker").selectOption(detail.result!.id);
  await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toHaveAttribute("data-result-id", detail.result!.id);
  await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toHaveAttribute("data-member-id", payload.manifest.members[1]!.conformer.id);
  await expect(page.getByTestId("conformer-selected-energy")).toContainText(payload.manifest.members[1]!.native_electronic_energy.value.toFixed(8));
  await page.getByTestId("mode-toggle-advanced").click();
  await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toHaveAttribute("data-result-id", detail.result!.id);
  await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toHaveAttribute("data-member-id", payload.manifest.members[1]!.conformer.id);
  await page.screenshot({ path: resolve(output, "advanced-ethanol-same-result.png"), fullPage: true });
  const versions = await (await request.get(`/api/chemdft/v1/projects/${project}/structures/${input.structure_id}/versions`)).json();
  expect(versions).toHaveLength(1); expect(versions[0].version.coordinates).toEqual(input.coordinates);
});

test("Advanced butane: genuine CONFORMER_SEARCH and shared Guided ensemble", async ({ page, request }) => {
  const { project, input } = await seed(request, "butane");
  await configure(page, project, input, "advanced");
  const detail = await submitFromUi(page, request, project, "advanced", "butane");
  const payload = detail.result!.payload as ConformerEnsembleResult;
  expect(payload.manifest.members.length).toBeGreaterThan(1);
  await assertMember(page, payload, payload.manifest.members.length - 1);
  await page.screenshot({ path: resolve(output, "advanced-butane-completed.png"), fullPage: true });
  await page.getByTestId("conformer-provenance").getByText("Scientific provenance and native evidence", { exact: true }).click();
  await page.getByRole("button", { name: "Open original input version", exact: true }).click();
  await page.getByRole("button", { name: "Conformer search", exact: true }).click();
  await expect(page.locator('[data-testid="conformer-search-setup"]:visible')).toHaveAttribute("data-structure-version-id", input.id);
  await page.goto(`/en/projects/${project}/workspace?selection=calculationResult:${detail.result!.id}&source=${detail.calculation.id}`);
  await page.getByTestId("mode-toggle-guided").click();
  await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toHaveAttribute("data-result-id", detail.result!.id);
  await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toHaveAttribute("data-member-id", payload.manifest.members.at(-1)!.conformer.id);
  const versions = await (await request.get(`/api/chemdft/v1/projects/${project}/structures/${input.structure_id}/versions`)).json();
  expect(versions).toHaveLength(1);
});

test("Unavailable CREST disables submission with a reason and no engine fallback", async ({ page, request }) => {
  const { project, input } = await seed(request, "water");
  await page.route("**/calculations/capabilities", async (route) => {
    const response = await route.fetch(); const items = await response.json();
    await route.fulfill({ response, json: items.map((item: { engine: string }) => item.engine === "crest" ? { ...item, availability: "UNAVAILABLE", diagnostic: "Gate C UI fault injection: native executable unavailable." } : item) });
  });
  await page.goto(`/en/projects/${project}/workspace?selection=structureVersion:${input.id}&source=${input.structure_id}`);
  await page.getByTestId("guided-nav-overview").click(); await page.getByTestId("guided-goal-conformer").click();
  await page.locator('[data-testid="conformer-search-setup"]:visible').getByRole("checkbox").check();
  await expect(page.getByTestId("conformer-unavailable")).toContainText("native executable unavailable");
  await expect(page.getByRole("button", { name: "Start conformer search", exact: true })).toBeDisabled();
  await page.screenshot({ path: resolve(output, "guided-crest-unavailable-fault-injection.png"), fullPage: true });
});

test("Real cancellation never exposes a partial authoritative ensemble", async ({ page, request }) => {
  const { project, input } = await seed(request, "butane");
  await configure(page, project, input, "guided");
  const responsePromise = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/calculations"));
  await page.getByRole("button", { name: "Start conformer search", exact: true }).click();
  const queued: CalculationDetail = await (await responsePromise).json();
  await page.getByRole("button", { name: "Cancel conformer search", exact: true }).click();
  await expect(page.getByRole("region", { name: "Conformer search status" })).toContainText("Search: Canceled", { timeout: 60_000 });
  const canceled = await (await request.get(`/api/chemdft/v1/projects/${project}/calculations/${queued.calculation.id}`)).json();
  expect(canceled.result).toBeNull();
  await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toHaveCount(0);
  await page.screenshot({ path: resolve(output, "guided-native-canceled.png"), fullPage: true });
});

// Explicit status fault injection, with NO numeric result or ensemble. Native rejection semantics are tested by backend tests.
for (const [label, diagnostic] of [["Failed", "Outer lower-conformer restart rejected (upstream #494)"], ["Timed out", "Native wall timeout"], ["Incomplete native evidence", "Incomplete native evidence"]] as const) {
  test(`Guided ${label}: fail-closed presentation of diagnostic-only record`, async ({ page, request }) => {
    const { project, input } = await seed(request, "water");
    const response = await request.post(`/api/chemdft/v1/projects/${project}/calculations`, { data: buildConformerSubmission(project, input.id, crypto.randomUUID()) });
    expect(response.status()).toBe(201);
    const queued: CalculationDetail = await response.json();
    await request.post(`/api/chemdft/v1/projects/${project}/calculations/${queued.calculation.id}/cancel`);
    await page.route(`**/calculations/${queued.calculation.id}`, async (route) => { const original = await route.fetch(); const record: CalculationDetail = await original.json();
      await route.fulfill({ response: original, json: { ...record, calculation: { ...record.calculation, state: "FAILED" }, result: null,
        attempt: { ...record.attempt, diagnostic: `Gate C UI status fault injection: ${diagnostic}`, raw_artifacts: [], failure_code: "RESULT_VALIDATION_FAILED" }, compute_execution: null } });
    });
    await page.goto(`/en/projects/${project}/workspace?selection=calculation:${queued.calculation.id}`);
    await expect(page.getByRole("region", { name: "Conformer search status" })).toContainText(`Search: ${label}`);
    await expect(page.getByRole("region", { name: "Conformer search status" })).toContainText("could not be accepted under the validated scientific workflow");
    await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open completed ensemble", exact: true })).toHaveCount(0);
    await page.screenshot({ path: resolve(output, `guided-${label.toLowerCase().replaceAll(" ", "-")}-fault-injection.png`), fullPage: true });
  });
}


test("Narrow viewport: real ensemble remains readable with keyboard selection", async ({ page, request }) => {
  const { project, input } = await seed(request, "water");
  const response = await request.post(`/api/chemdft/v1/projects/${project}/calculations`, { data: buildConformerSubmission(project, input.id, crypto.randomUUID()) });
  expect(response.status()).toBe(201);
  const detail = await complete(request, project, (await response.json()).calculation.id);
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(`/en/projects/${project}/workspace?selection=calculationResult:${detail.result!.id}&source=${detail.calculation.id}`);
  const ensemble = page.locator('[data-testid="conformer-ensemble"]:visible');
  await expect(ensemble).toBeVisible();
  await expect(ensemble.getByLabel("Scientific View molecule viewport").locator("canvas")).toBeVisible();
  await expect(ensemble).toContainText("UNVERIFIED");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const select = ensemble.getByRole("button", {name: "Select member 1", exact: true});
  await select.focus(); await select.press("End"); await expect(select).toBeFocused();
  await page.screenshot({path: resolve(output, "guided-narrow-water.png"), fullPage: true});
});
