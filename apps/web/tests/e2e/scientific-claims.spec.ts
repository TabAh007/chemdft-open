import { expect, test } from "@playwright/test";

const extractedXrd = "11111111-1111-4111-8111-111111111111";
const digitizedXrd = "22222222-2222-4222-8222-222222222222";
const radiusId = "33333333-3333-4333-8333-333333333333";
const diameterId = "44444444-4444-4444-8444-444444444444";
const reconstructedId = "55555555-5555-4555-8555-555555555555";

function claim(projectId: string, overrides: Record<string, unknown>) {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    project_id: projectId,
    claim_type: "NUMERIC_VALUE",
    subject: "Fixture sample",
    predicate: "reported value",
    quantity_key: null,
    value: 1,
    unit: null,
    qualifier: null,
    uncertainty: null,
    source_authority: "EXTRACTED",
    source_record_type: "evidence_candidate",
    source_record_id: "88888888-8888-4888-8888-888888888888",
    source_document_id: "77777777-7777-4777-8777-777777777777",
    page: 1,
    figure: null,
    table: null,
    evidence_id: "88888888-8888-4888-8888-888888888888",
    provenance_hash: "a".repeat(64),
    review_state: "DETECTED",
    semantic_status: "EXPLICIT",
    source_label: "Paper text · extracted",
    source_href: `/en/projects/${projectId}/workspace?selection=documentEvidence:88888888-8888-4888-8888-888888888888&source=77777777-7777-4777-8777-777777777777&page=1`,
    created_at: "2026-09-27T00:00:00Z",
    ...overrides,
  };
}

test("project claims can be filtered, compared, inspected, and opened at source", async ({ page }) => {
  const apiPort = Number(process.env.CHEMDFT_E2E_API_PORT ?? 8123);
  const created = await page.request.post(`http://127.0.0.1:${apiPort}/v1/projects`, {
    data: { name: "Scientific Claims Acceptance", slug: `claims-${Date.now().toString(36)}` },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = (await created.json() as { id: string }).id;
  await page.route(`**/v1/projects/${projectId}/scientific-claims*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        project_id: projectId,
        claims: [
          claim(projectId, { id: extractedXrd, claim_type: "PEAK_POSITION", subject: "XRD", predicate: "2θ peak position", quantity_key: "xrd.two_theta.peak_position", value: 24.482, unit: "degree", source_record_id: extractedXrd, evidence_id: extractedXrd, source_href: `/en/projects/${projectId}/workspace?selection=documentEvidence:${extractedXrd}&source=77777777-7777-4777-8777-777777777777&page=6` }),
          claim(projectId, { id: digitizedXrd, claim_type: "PEAK_POSITION", subject: "XRD pattern", predicate: "2θ digitized peak 1", quantity_key: "xrd.two_theta.peak_position", value: 24.4565, unit: "degree", source_authority: "DIGITIZED", source_record_type: "experimental_dataset", source_record_id: "66666666-6666-4666-8666-666666666666", review_state: "COMMITTED", source_label: "Digitized dataset · Figure 3 XRD", source_href: `/en/projects/${projectId}/workspace?selection=experimentalDataset:66666666-6666-4666-8666-666666666666` }),
          claim(projectId, { id: radiusId, claim_type: "PARTICLE_SIZE", subject: "DLS particles", predicate: "hydrodynamic radius", quantity_key: "dls.hydrodynamic_radius", value: 1482.3, unit: "nm" }),
          claim(projectId, { id: diameterId, claim_type: "DISTRIBUTION_SUMMARY", subject: "DLS distribution", predicate: "hydrodynamic diameter mean", quantity_key: "dls.hydrodynamic_diameter.mean", value: 1496.1, unit: "nm" }),
          claim(projectId, { id: reconstructedId, claim_type: "STRUCTURE_ASSERTION", subject: "TEST USER-SUPPLIED RECONSTRUCTION — NOT FROM PAPER", predicate: "structure representation", value: "TEST USER-SUPPLIED RECONSTRUCTION — NOT FROM PAPER · V1 (RECONSTRUCTED)", source_authority: "RECONSTRUCTED", source_record_type: "structure_version", source_record_id: reconstructedId, source_label: "Structure · V1", source_href: `/en/projects/${projectId}/workspace?selection=structureVersion:${reconstructedId}&source=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` }),
        ],
        relations: [
          { left_claim_id: extractedXrd, right_claim_id: digitizedXrd, relation: "SAME_QUANTITY", rationale: "Same 2θ quantity and units.", numeric_delta: 0.0255, delta_unit: "degree" },
          { left_claim_id: radiusId, right_claim_id: diameterId, relation: "NOT_DIRECTLY_COMPARABLE", rationale: "Radius and diameter are distinct quantities." },
        ],
      }),
    });
  });

  await page.goto(`/en/projects/${projectId}/claims`);
  await expect(page.getByRole("heading", { name: "Scientific claims" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Extracted.*Detected/ }).first()).toBeVisible();

  await page.getByLabel("Filter by claim type").selectOption("PEAK_POSITION");
  await expect(page.getByRole("row", { name: /2θ peak position/ })).toBeVisible();
  await page.getByRole("row", { name: /2θ peak position/ }).click();
  await expect(page.getByText("SAME QUANTITY")).toBeVisible();
  await expect(page.getByText("0.0255 degree")).toBeVisible();
  await expect(page.getByRole("link", { name: "View source" })).toHaveAttribute("href", new RegExp(`documentEvidence:${extractedXrd}`));
  await page.getByLabel("Filter by authority").selectOption("EXTRACTED");
  await expect(page.getByRole("row", { name: /digitized peak/ })).toHaveCount(0);
  await page.getByLabel("Filter by authority").selectOption("all");
  await page.getByLabel("Filter by review state").selectOption("DETECTED");
  await expect(page.getByRole("row", { name: /digitized peak/ })).toHaveCount(0);

  await page.getByLabel("Filter by review state").selectOption("all");
  await page.getByLabel("Filter by claim type").selectOption("all");
  await page.getByLabel("Search claims").fill("digitized peak");
  await page.getByRole("row", { name: /digitized peak/ }).click();
  await expect(page.getByRole("row", { name: /digitized peak/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: "View dataset" })).toHaveAttribute("href", /selection=experimentalDataset:/);
  await page.getByLabel("Search claims").fill("TEST USER-SUPPLIED RECONSTRUCTION");
  await page.getByRole("row", { name: /TEST USER-SUPPLIED RECONSTRUCTION/ }).click();
  const reconstructionRow = page.getByRole("row", { name: /TEST USER-SUPPLIED RECONSTRUCTION/ });
  await expect(page.getByRole("link", { name: "View structure" })).toHaveAttribute("href", /selection=structureVersion:/);
  const rowBounds = await reconstructionRow.evaluate((row) => {
    const cells = [...row.querySelectorAll("td")].map((cell) => cell.getBoundingClientRect());
    return cells.every((cell, index) => index === 0 || cells[index - 1]!.right <= cell.left);
  });
  expect(rowBounds).toBeTruthy();
  await page.getByLabel("Search claims").fill("hydrodynamic radius");
  await page.getByRole("row", { name: /hydrodynamic radius/ }).click();
  await expect(page.getByText("NOT DIRECTLY COMPARABLE")).toBeVisible();
  await expect(page.getByText("Radius and diameter are distinct quantities.")).toBeVisible();
  await expect(page.locator(".claim-relations")).not.toContainText("Delta");
  await page.getByRole("link", { name: "View source" }).click();
  await expect(page).toHaveURL(/\/workspace\?selection=documentEvidence:/);
});
