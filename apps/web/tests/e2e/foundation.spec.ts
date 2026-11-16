import { expect, test, type Page } from "@playwright/test";

const projectId = "00000000-0000-4000-8000-000000000111";
const moleculeStructureId = "00000000-0000-4000-8000-000000000201";
const moleculeV1 = "00000000-0000-4000-8000-000000000211";
const moleculeV2 = "00000000-0000-4000-8000-000000000212";
const crystalStructureId = "00000000-0000-4000-8000-000000000301";
const crystalV1 = "00000000-0000-4000-8000-000000000311";
const artifactId = "00000000-0000-4000-8000-000000000401";
const sha256 = "a".repeat(64);
const createdAt = "2026-09-13T12:00:00Z";
const actorId = "00000000-0000-4000-8000-000000000001";
const moleculeMolfile = `Api molecule
  ChemDFT

  2  1  0  0  0  0            999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
M  END
`;

test("landing states the product truth and opens the project shell", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Computational chemistry, without the old workflow.");
  await expect(page.getByText("AI may explain a scientific result.", { exact: false })).toBeVisible();
  await expect(page.getByText("Foundation preview")).toHaveCount(0);
  await page.getByRole("link", { name: "Open ChemDFT" }).first().click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
});

test("project workstation is deep-linkable and honest", async ({ page }) => {
  await mockStructureApi(page, { structures: [], versions: [] });
  await page.goto("/en/projects/foundation-preview/workspace");
  await expect(page.getByRole("navigation", { name: "Project sections" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Import a structure to begin" })).toBeVisible();
  await expect(page.getByText(/no scientific value is simulated/)).toBeVisible();
  await expect(page.getByText("No saved structures yet")).toBeVisible();
  await expect(page.getByText("Atoms")).toHaveCount(0);
  await expect(page.getByText("Version History")).toHaveCount(0);
});

test("global jobs and settings routes are available without fake providers", async ({ page }) => {
  await page.goto("/en/jobs");
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await expect(page.getByText("No compute jobs yet. No synthetic progress is shown.")).toBeVisible();

  await page.goto("/en/settings/ai");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByTestId("ai-settings-panel")).toBeVisible();
  await expect(page.getByLabel("Provider API key")).toHaveAttribute("type", "password");

  await page.goto("/en/settings/billing");
  await expect(page.getByTestId("billing-unavailable-message")).toHaveText("Billing is not available during the beta. No charges are made.");
  await expect(page.getByRole("button", { name: /checkout/i })).toHaveCount(0);
});

test("mobile layouts do not overflow the viewport", async ({ page }) => {
  await page.goto("/en/projects/foundation-preview/overview");
  const viewport = page.viewportSize();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(viewport?.width ?? width);
});

test("real SDF import renders atoms, bonds, diagnostics, provenance, and export from API data", async ({ page }) => {
  await mockStructureApi(page, {
    structures: [],
    versions: [],
    importOutput: {
      structure: moleculeStructure("API imported molecule"),
      version: moleculeVersion({ id: moleculeV1, revision: 1, x: 2.3456, origin: "IMPORTED" }),
    },
    afterImport: {
      structures: [moleculeSummary("API imported molecule", moleculeV1, 1)],
      versions: [moleculeDetail({ id: moleculeV1, revision: 1, x: 2.3456, origin: "IMPORTED" }, "API imported molecule")],
    },
  });
  await page.goto(`/en/projects/${projectId}/workspace`);
  await page.setInputFiles("#structure-upload", {
    name: "api-molecule.sdf",
    mimeType: "chemical/x-mdl-sdfile",
    buffer: Buffer.from("source file bytes are not parsed by React"),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();

  await expect(page.getByRole("heading", { name: "API imported molecule" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "2.3456" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "O" })).toBeVisible();
  await expect(page.getByText("WARNING · MISSING_CONNECTIVITY")).toBeVisible();
  await expect(page.getByText("rdkit api-test")).toBeVisible();
  await expect(page.getByText("chemdft.rdkit.molecular api-test")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scientific visualization" })).toBeVisible();
  await expect(page.getByText("Renderer-neutral scene from immutable V1")).toBeVisible();
  await expect(page.getByText("2 atoms")).toBeVisible();
  const scientificViewport = page.getByLabel("3Dmol.js scientific structure viewport");
  await expect(scientificViewport).toBeVisible();
  await expect(scientificViewport.locator("canvas")).toHaveCount(1, { timeout: 10_000 });
  await page.getByRole("button", { name: "Studio" }).click();
  await expect(page.locator('[data-renderer-mode="studio"]')).toBeVisible();
  const studioViewport = page.getByLabel("Three.js Studio structure viewport");
  await expect(studioViewport).toBeVisible();
  await expect(studioViewport.locator("canvas")).toHaveCount(1, { timeout: 10_000 });
  await page.getByRole("row", { name: /0 C 6/ }).click();
  await expect(page.getByText("Atom 0 · C")).toBeVisible();
  await page.getByLabel("Measure").selectOption("distance");
  await page.getByRole("row", { name: /0 C 6/ }).click();
  await page.getByRole("row", { name: /1 O 8/ }).click();
  await expect(page.getByText(/Measurement: /)).toContainText("Å");
  await expect(page.getByText(/storage_key|object_key/)).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("api-molecule.sdf");
});

test("real CIF import renders periodic cell and fractional site values from API data", async ({ page }) => {
  await mockStructureApi(page, {
    structures: [],
    versions: [],
    importOutput: {
      structure: crystalStructure("API crystal"),
      version: crystalVersion(),
    },
    afterImport: {
      structures: [crystalSummary("API crystal")],
      versions: [crystalDetail()],
    },
  });
  await page.goto(`/en/projects/${projectId}/workspace`);
  await page.setInputFiles("#structure-upload", {
    name: "api-crystal.cif",
    mimeType: "chemical/x-cif",
    buffer: Buffer.from("data_api"),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();

  await expect(page.getByRole("heading", { name: "API crystal" })).toBeVisible();
  await expect(page.getByText("7.123 Å")).toBeVisible();
  await expect(page.getByText("Display supercell")).toBeVisible();
  await page.getByLabel("Display supercell").selectOption("2x1x1");
  await expect(page.getByText("2 atoms")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Si" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "0.125" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "0.75" })).toBeVisible();
  await expect(page.getByText("WARNING · PARTIAL_OCCUPANCY")).toBeVisible();
  await expect(page.getByText(/storage_key|object_key/)).toHaveCount(0);
});

test("version switching and Ketcher save use committed immutable versions", async ({ page }) => {
  const versions = [
    moleculeDetail({ id: moleculeV1, revision: 1, x: 0.1111, origin: "IMPORTED" }),
    moleculeDetail({ id: moleculeV2, revision: 2, x: 1.2345, origin: "MANUALLY_EDITED", parentVersionId: moleculeV1 }),
  ];
  await mockStructureApi(page, {
    structures: [moleculeSummary("Versioned molecule", moleculeV2, 2)],
    versions,
    molExport: moleculeMolfile,
    ketcherOutput: {
      version: moleculeVersion({
        id: "00000000-0000-4000-8000-000000000213",
        revision: 3,
        x: 3.2109,
        origin: "MANUALLY_EDITED",
        parentVersionId: moleculeV2,
      }),
    },
    afterKetcher: [
      ...versions,
      moleculeDetail({
        id: "00000000-0000-4000-8000-000000000213",
        revision: 3,
        x: 3.2109,
        origin: "MANUALLY_EDITED",
        parentVersionId: moleculeV2,
      }),
    ],
  });
  await page.goto(`/en/projects/${projectId}/workspace`);

  await expect(page.getByRole("cell", { name: "1.2345" })).toBeVisible();
  await page.getByRole("button", { name: /^V1 / }).click();
  await expect(page.getByRole("cell", { name: "0.1111" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "1.2345" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await page.getByRole("button", { name: /^V2 / }).click();
  await expect(page.getByRole("cell", { name: "1.2345" })).toBeVisible();

  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await page.getByRole("button", { name: "Edit molecule" }).click();
  await expect(page.getByLabel("Ketcher molecule editor")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save immutable version" })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole("button", { name: "Save immutable version" }).click();
  await expect(page.getByRole("button", { name: /^V3 / })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("cell", { name: "3.2109" })).toBeVisible();
  await page.getByRole("button", { name: /^V2 / }).click();
  await expect(page.getByRole("cell", { name: "1.2345" })).toBeVisible();
});

test("mobile structure workspace stays inspection-oriented without horizontal overflow", async ({ page }) => {
  await mockStructureApi(page, {
    structures: [crystalSummary("Mobile crystal")],
    versions: [crystalDetail("Mobile crystal")],
  });
  await page.goto(`/en/projects/${projectId}/workspace`);
  const viewport = page.viewportSize();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(viewport?.width ?? width);
  await expect(page.getByRole("heading", { name: "Mobile crystal" })).toBeVisible();
});

test("calculation panel submits explicit settings and renders firewall-published provenance", async ({ page }, testInfo) => {
  await mockStructureApi(page, {
    structures: [moleculeSummary("Calculation molecule", moleculeV1, 1)],
    versions: [moleculeDetail({ id: moleculeV1, revision: 1, x: 0.74, origin: "IMPORTED" })],
    calculationOutput: calculationDetail(),
  });
  await page.goto(`/en/projects/${projectId}/workspace`);
  await expect(page.getByRole("heading", { name: "Calculation" })).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await expect(page.getByText("AVAILABLE", { exact: true })).toBeVisible();
  }
  await expect(page.getByLabel("Charge")).toHaveValue("0");
  await expect(page.getByLabel("Multiplicity")).toHaveValue("1");
  await page.getByRole("button", { name: "Run energy" }).click();
  await expect(page.getByText("-1.1167593074 Eh")).toBeVisible();
  await expect(page.getByText("CALCULATED", { exact: true })).toBeVisible();
  await expect(page.getByText("pyscf 2.14.0", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download execution log" }).click();
  await expect((await download).suggestedFilename()).toContain("engine_log");
  await expect(page.getByText(/storage_key|object_key|\.chemdft\/objects/)).toHaveCount(0);
});

async function mockStructureApi(
  page: Page,
  state: {
    structures: unknown[];
    versions: unknown[];
    importOutput?: unknown;
    afterImport?: { structures: unknown[]; versions: unknown[] };
    molExport?: string;
    ketcherOutput?: unknown;
    afterKetcher?: unknown[];
    calculationOutput?: unknown;
  },
) {
  let structures = state.structures;
  let versions = state.versions;
  await page.route("**/api/chemdft/v1/projects/**", async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === "GET" && url.endsWith("/calculations/capabilities")) {
      await route.fulfill({ json: [{
        engine: "pyscf",
        availability: "AVAILABLE",
        version: "2.14.0",
        supported_tasks: ["ENERGY"],
        supported_methods: ["hf", "b3lyp", "pbe"],
        supported_basis_sets: ["sto-3g", "6-31g", "def2-svp"],
      }] });
      return;
    }
    if (request.method() === "POST" && url.endsWith("/calculations")) {
      await route.fulfill({ status: 201, json: state.calculationOutput });
      return;
    }
    if (request.method() === "GET" && url.includes("/calculations/") && url.includes("/artifacts/")) {
      await route.fulfill({
        body: "PySCF bounded execution log",
        headers: {
          "content-disposition": 'attachment; filename="calculation-test-engine_log.log"',
          "content-type": "text/plain",
        },
      });
      return;
    }
    if (request.method() === "GET" && url.endsWith("/structures")) {
      await route.fulfill({ json: structures });
      return;
    }
    if (request.method() === "GET" && url.includes("/versions/") && url.includes("/export")) {
      await route.fulfill({
        body: state.molExport ?? "exported structure",
        headers: {
          "content-disposition": 'attachment; filename="api-molecule.sdf"',
          "content-type": "chemical/x-mdl-sdfile",
        },
      });
      return;
    }
    if (request.method() === "GET" && url.endsWith("/versions")) {
      await route.fulfill({ json: versions });
      return;
    }
    if (request.method() === "POST" && url.endsWith("/structures/imports")) {
      if (state.afterImport) {
        structures = state.afterImport.structures;
        versions = state.afterImport.versions;
      }
      await route.fulfill({ status: 201, json: state.importOutput });
      return;
    }
    if (request.method() === "POST" && url.endsWith("/versions/imports")) {
      if (state.afterKetcher) versions = state.afterKetcher;
      await route.fulfill({ status: 201, json: state.ketcherOutput });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: "Unhandled test API route" } });
  });
}

function calculationDetail() {
  const calculationId = "00000000-0000-4000-8000-000000000501";
  return {
    calculation: {
      id: calculationId,
      project_id: projectId,
      input_id: "00000000-0000-4000-8000-000000000502",
      state: "SUCCEEDED",
      created_by: actorId,
      created_at: createdAt,
      updated_at: createdAt,
    },
    calculation_input_hash: "b".repeat(64),
    specification: {
      task_type: "ENERGY",
      method: { identifier: "hf", display_name: "Hartree-Fock", registry: "chemdft.method" },
      basis: { identifier: "sto-3g", display_name: "STO-3G", registry: "chemdft.basis" },
      charge: 0,
      multiplicity: 1,
      engine_preference: { engine: "pyscf" },
    },
    attempt: {
      id: "00000000-0000-4000-8000-000000000503",
      project_id: projectId,
      calculation_id: calculationId,
      attempt_number: 1,
      state: "SUCCEEDED",
      worker_id: "local.pyscf",
      raw_artifacts: [
        { project_id: projectId, artifact_id: "00000000-0000-4000-8000-000000000506", sha256: "c".repeat(64) },
        { project_id: projectId, artifact_id: "00000000-0000-4000-8000-000000000507", sha256: "d".repeat(64) },
      ],
    },
    result: {
      id: "00000000-0000-4000-8000-000000000504",
      result_type: "chemdft.energy",
      project_id: projectId,
      calculation_id: calculationId,
      calculation_input_id: "00000000-0000-4000-8000-000000000502",
      authority: "AUTHORITATIVE",
      source_class: "CALCULATED",
      verification_state: "UNVERIFIED",
      validation_state: "VALIDATED",
      trusted_producer_id: "local.pyscf.worker",
      trusted_producer_type: "SCIENTIFIC_WORKER",
      producer_attestation_id: "attempt:1",
      producer_software: {
        name: "pyscf", version: "2.14.0", adapter_version: "1.0.0",
        execution_backend: "local.subprocess", capabilities: ["chemdft.energy"],
      },
      payload: {
        payload_schema: "chemdft.energy", payload_schema_version: "1.0.0",
        task_type: "ENERGY", converged: true,
        total_energy: { value: -1.1167593073964255, unit: { standard: "QCSCHEMA", code: "Eh", dimension: "ENERGY" }, approximation: "EXACT_AS_REPORTED" },
        method: "hf", basis: "sto-3g", parser_version: "1.0.0", validator_version: "1.0.0",
      },
      provenance_record_id: "00000000-0000-4000-8000-000000000505",
      raw_artifacts: [],
      created_at: createdAt,
    },
  };
}

function moleculeSummary(name: string, latestVersionId: string, latestRevision: number) {
  return {
    id: moleculeStructureId,
    project_id: projectId,
    name,
    kind: "MOLECULE",
    latest_version_id: latestVersionId,
    latest_revision: latestRevision,
    atom_count: 2,
    bond_count: 1,
    diagnostic_counts: { WARNING: 1 },
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function crystalSummary(name: string) {
  return {
    id: crystalStructureId,
    project_id: projectId,
    name,
    kind: "PERIODIC",
    latest_version_id: crystalV1,
    latest_revision: 1,
    atom_count: 2,
    bond_count: 0,
    diagnostic_counts: { WARNING: 1 },
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function moleculeStructure(name: string) {
  return {
    id: moleculeStructureId,
    project_id: projectId,
    name,
    kind: "MOLECULE",
    created_by: actorId,
    created_at: createdAt,
  };
}

function crystalStructure(name: string) {
  return {
    id: crystalStructureId,
    project_id: projectId,
    name,
    kind: "PERIODIC",
    created_by: actorId,
    created_at: createdAt,
  };
}

function moleculeVersion({
  id,
  revision,
  x,
  origin,
  parentVersionId = null,
}: {
  id: string;
  revision: number;
  x: number;
  origin: "IMPORTED" | "MANUALLY_EDITED";
  parentVersionId?: string | null;
}) {
  return {
    id,
    project_id: projectId,
    structure_id: moleculeStructureId,
    revision,
    origin,
    parent_version_id: parentVersionId,
    representation_artifacts: [{ project_id: projectId, artifact_id: artifactId, sha256 }],
    coordinates: {
      structure_version_id: id,
      coordinate_system: "CARTESIAN",
      unit: "angstrom",
      dimensionality: 3,
      atom_ordering: "AS_LISTED",
      source: { project_id: projectId, artifact_id: artifactId, sha256 },
      atoms: [
        { index: 0, atomic_number: 6, element: "C", x, y: 0, z: 0, occupancy: null },
        { index: 1, atomic_number: 8, element: "O", x: 0.5, y: 0, z: 0, occupancy: null },
      ],
      bonds: [{ atom_index_a: 0, atom_index_b: 1, order: 1 }],
    },
    periodic_cell: null,
    diagnostics: [
      { severity: "WARNING", code: "MISSING_CONNECTIVITY", message: "API diagnostic", atom_index: null },
    ],
    overall_charge: 0,
    multiplicity: 1,
    created_by: actorId,
    created_at: createdAt,
  };
}

function moleculeDetail(args: Parameters<typeof moleculeVersion>[0], name = "Versioned molecule") {
  return {
    structure: moleculeStructure(name),
    version: moleculeVersion(args),
    diagnostics: moleculeVersion(args).diagnostics,
    provenance: {
      origin: args.origin,
      source_artifact: { project_id: projectId, artifact_id: artifactId, sha256 },
      parser: "rdkit",
      parser_version: "api-test",
      adapter: "chemdft.rdkit.molecular",
      adapter_version: "api-test",
      operation: args.origin === "IMPORTED" ? "chemdft.structure.import" : "chemdft.structure.version.create",
      operation_version: "1.0.0",
      source_class: "EXTRACTED",
      verification_state: "UNVERIFIED",
      created_at: createdAt,
      actor_id: actorId,
    },
  };
}

function crystalVersion() {
  return {
    id: crystalV1,
    project_id: projectId,
    structure_id: crystalStructureId,
    revision: 1,
    origin: "IMPORTED",
    parent_version_id: null,
    representation_artifacts: [{ project_id: projectId, artifact_id: artifactId, sha256 }],
    coordinates: {
      structure_version_id: crystalV1,
      coordinate_system: "FRACTIONAL",
      unit: "angstrom",
      dimensionality: 3,
      atom_ordering: "AS_LISTED",
      source: { project_id: projectId, artifact_id: artifactId, sha256 },
      atoms: [
        { index: 0, atomic_number: 14, element: "Si", x: 0.125, y: 0, z: 0, occupancy: 0.75 },
        { index: 1, atomic_number: 8, element: "O", x: 0.5, y: 0.5, z: 0.5, occupancy: 1 },
      ],
      bonds: [],
    },
    periodic_cell: {
      unit: "angstrom",
      a: 7.123,
      b: 8.234,
      c: 9.345,
      alpha: 91,
      beta: 92,
      gamma: 93,
      lattice_vectors: [[7.123, 0, 0], [0, 8.234, 0], [0, 0, 9.345]],
      periodic_dimensions: [true, true, true],
    },
    diagnostics: [
      { severity: "WARNING", code: "PARTIAL_OCCUPANCY", message: "API diagnostic", atom_index: 0 },
    ],
    overall_charge: 0,
    multiplicity: 1,
    created_by: actorId,
    created_at: createdAt,
  };
}

function crystalDetail(name = "API crystal") {
  return {
    structure: crystalStructure(name),
    version: crystalVersion(),
    diagnostics: crystalVersion().diagnostics,
    provenance: {
      origin: "IMPORTED",
      source_artifact: { project_id: projectId, artifact_id: artifactId, sha256 },
      parser: "pymatgen",
      parser_version: "api-test",
      adapter: "chemdft.pymatgen.periodic",
      adapter_version: "api-test",
      operation: "chemdft.structure.import",
      operation_version: "1.0.0",
      source_class: "EXTRACTED",
      verification_state: "UNVERIFIED",
      created_at: createdAt,
      actor_id: actorId,
    },
  };
}
