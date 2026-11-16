import { expect, test } from "@playwright/test";

const doc = "77777777-7777-4777-8777-777777777777";
const projectId = "88888888-8888-4888-8888-888888888888";

function claim(id: string, overrides: Record<string, unknown> = {}) {
  const recordId = id;
  return {
    id,
    project_id: projectId,
    claim_type: "NUMERIC_VALUE",
    subject: "Fixture",
    predicate: "reported quantity",
    quantity_key: null,
    value: 1,
    unit: null,
    qualifier: null,
    uncertainty: null,
    source_authority: "EXTRACTED",
    source_record_type: "evidence_candidate",
    source_record_id: recordId,
    source_document_id: doc,
    page: 1,
    figure: null,
    table: null,
    evidence_id: recordId,
    provenance_hash: "a".repeat(64),
    review_state: "DETECTED",
    semantic_status: "EXPLICIT",
    source_label: "Paper text · extracted",
    source_href: `/en/projects/${projectId}/workspace?selection=documentEvidence:${recordId}&source=${doc}&page=1`,
    created_at: "2026-09-27T00:00:00Z",
    ...overrides,
  };
}

function row(id: string, section: string, topic: string, relation: string, source: unknown[], project: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    id, section, topic, quantity_key: "fixture.quantity", source_document_id: doc,
    source_claims: source, project_claims: project, relation, delta: null, delta_unit: null,
    comparison_rule: null, authority_summary: [], review_summary: [], unresolved_reason: null,
    ...overrides,
  };
}

test("comparison matrix filters rows, inspects provenance, and keeps semantic distinctions", async ({ page }) => {
  await page.route(`**/v1/projects/${projectId}/scientific-comparison*`, async (route) => {
    const cell = claim("cell-a", { claim_type: "STRUCTURAL_PARAMETER", subject: "Reported crystal cell", predicate: "a", quantity_key: "crystal.cell.a", value: 4.958, unit: "Å" });
    const paperPeak = claim("paper-peak", { claim_type: "PEAK_POSITION", subject: "XRD", predicate: "2θ peak 1", quantity_key: "xrd.two_theta.peak_position", value: 24.482, unit: "degree" });
    const digitizedPeak = claim("digitized-peak", { claim_type: "PEAK_POSITION", subject: "XRD pattern", predicate: "2θ digitized peak 1", quantity_key: "xrd.two_theta.peak_position", value: 24.4565, unit: "degree", source_authority: "DIGITIZED", source_record_type: "experimental_dataset", review_state: "COMMITTED", source_href: `/en/projects/${projectId}/workspace?selection=experimentalDataset:dataset-xrd` });
    const radius = claim("paper-radius", { claim_type: "PARTICLE_SIZE", subject: "DLS particles", predicate: "hydrodynamic radius", quantity_key: "dls.hydrodynamic_radius", value: 1482.3, unit: "nm" });
    const size = claim("digitized-size", { claim_type: "DISTRIBUTION_SUMMARY", subject: "Digitized DLS distribution", predicate: "distribution peak", quantity_key: "dls.hydrodynamic_diameter.distribution_peak", value: 1524.4, unit: "nm", source_authority: "DIGITIZED", source_record_type: "experimental_dataset", review_state: "COMMITTED", source_href: `/en/projects/${projectId}/workspace?selection=experimentalDataset:dataset-dls` });
    const figure = claim("figure-2", { claim_type: "STRUCTURE_ASSERTION", subject: "Paper structure figure", predicate: "structure depicted", quantity_key: null, value: "Figure 2 hypothetical structure", figure: "2" });
    const structure = claim("structure-v1", { claim_type: "STRUCTURE_ASSERTION", subject: "Chromium V1", predicate: "structure representation", quantity_key: "structure.representation", value: "Chromium V1 · V1 (RECONSTRUCTED)", source_authority: "RECONSTRUCTED", source_record_type: "structure_version", review_state: "USER REVIEWED", source_record_id: "structure-v1", evidence_id: "figure-2", source_href: `/en/projects/${projectId}/workspace?selection=structureVersion:structure-v1` });
    const rows = [
      row("synthesis", "Synthesis", "Feed gas ratio", "SOURCE_ONLY", [claim("synthesis", { claim_type: "COMPOSITION", subject: "CVD feed gas", predicate: "argon to hydrogen feed ratio", value: "Ar:H2 2:1", quantity_key: "cvd.feed_gas.ratio" })], []),
      row("cell", "Crystallography", "Cell parameter a", "SOURCE_ONLY", [cell], [], { quantity_key: "crystal.cell.a" }),
      row("structure", "Structure", "Structure depicted", "DERIVED_FROM", [figure], [structure], { quantity_key: null, comparison_rule: "Source evidence linked to reconstruction." }),
      row("xrd", "XRD", "2θ peak 1", "SAME_QUANTITY", [paperPeak], [digitizedPeak], { quantity_key: "xrd.two_theta.peak_position", delta: 0.0255, delta_unit: "degree", comparison_rule: "Delta convention: source minus ChemDFT." }),
      row("dls", "Particle characterization", "Hydrodynamic radius", "NOT_DIRECTLY_COMPARABLE", [radius], [size], { quantity_key: "dls.hydrodynamic_radius", comparison_rule: "Radius and diameter have different semantics." }),
      row("thermal", "Thermal analysis", "Decomposition interval", "SOURCE_ONLY", [claim("thermal", { subject: "Thermal analysis", predicate: "thermal event temperature range", value: [189.3, 264.9], unit: "°C", quantity_key: "thermal.event.temperature_range" })], []),
    ];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      project_id: projectId, rows,
      summary: { source_claims: 4, project_claims: 2, directly_comparable_pairs: 1, not_directly_comparable: 1, source_only_claims: 3, project_only_claims: 0, reconstructed_structures: 1, digitized_datasets: 2, calculated_results: 0 },
    }) });
  });

  await page.goto(`/en/projects/${projectId}/comparison`);
  await expect(page.getByRole("heading", { name: "Paper vs ChemDFT" })).toBeVisible();
  await expect(page.getByText("Comparable pairs")).toBeVisible();
  await expect(page.getByRole("row", { name: /0\.0255 degree/ })).toBeVisible();
  await page.getByLabel("Filter by relation").selectOption("SAME_QUANTITY");
  await expect(page.getByRole("row", { name: /2θ peak 1/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Cell parameter a/ })).toHaveCount(0);
  await page.getByLabel("Filter by relation").selectOption("all");
  await page.getByRole("row", { name: /Hydrodynamic radius/ }).click();
  await expect(page.getByText("Not directly comparable").first()).toBeVisible();
  await expect(page.getByRole("row", { name: /1524\.4 nm/ })).toBeVisible();
  await expect(page.getByText("Delta", { exact: true })).toHaveCount(0);
  await page.getByRole("row", { name: /Structure depicted/ }).click();
  await expect(page.getByText(/paper did not provide these full coordinates/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "View structure" })).toHaveAttribute("href", /selection=structureVersion:/);
});
