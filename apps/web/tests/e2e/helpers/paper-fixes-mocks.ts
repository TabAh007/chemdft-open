import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";

export const PAPER_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
export const PAPER_PROJECT_NAME = "Paper test - S1 Lophine";

export const LOPHINE_STRUCTURE_ID = "00000000-0000-4000-8000-000000000010";
export const LOPHINE_VERSION_ID = "00000000-0000-4000-8000-000000000011";

export const HNO3_STRUCTURE_ID = "00000000-0000-4000-8000-000000000020";
export const HNO3_VERSION_ID = "00000000-0000-4000-8000-000000000021";
export const HNO3_CALC_ID = "00000000-0000-4000-8000-000000000022";
export const HNO3_RESULT_ID = "00000000-0000-4000-8000-000000000023";
export const HNO3_JOB_ID = "00000000-0000-4000-8000-000000000024";
export const HNO3_INPUT_ID = "00000000-0000-4000-8000-000000000025";
export const HNO3_INPUT_ARTIFACT_ID = "00000000-0000-4000-8000-000000000026";

export const CANCELED_CALC_ID = "00000000-0000-4000-8000-000000000030";
export const CANCELED_JOB_ID = "00000000-0000-4000-8000-000000000031";

export const CLAIM_USER_ENTERED_ID = "00000000-0000-4000-8000-000000000040";
export const PAPER_DOCUMENT_ID = "00000000-0000-4000-8000-000000000050";

export function createLophineAtoms() {
  const atoms = [];
  // 21 Carbons (atomic_number: 6)
  for (let i = 0; i < 21; i++) {
    atoms.push({ index: i, element: "C", atomic_number: 6, x: i * 0.5, y: (i % 3) * 0.5, z: 0.0 });
  }
  // 2 Nitrogens (atomic_number: 7)
  atoms.push({ index: 21, element: "N", atomic_number: 7, x: 10.5, y: 1.0, z: 0.0 });
  atoms.push({ index: 22, element: "N", atomic_number: 7, x: 11.0, y: 1.5, z: 0.0 });
  // 16 Hydrogens (atomic_number: 1)
  for (let i = 0; i < 16; i++) {
    atoms.push({ index: 23 + i, element: "H", atomic_number: 1, x: i * 0.4, y: -1.0, z: (i % 2) * 0.3 });
  }
  return atoms;
}

export function lophineStructureDetail(projectId = PAPER_PROJECT_ID) {
  const atoms = createLophineAtoms();
  return {
    structure: {
      id: LOPHINE_STRUCTURE_ID,
      project_id: projectId,
      name: "Lophine A1",
      kind: "MOLECULE",
      created_at: "2026-11-03T18:00:00Z",
    },
    version: {
      id: LOPHINE_VERSION_ID,
      structure_id: LOPHINE_STRUCTURE_ID,
      revision: 1,
      overall_charge: 0,
      multiplicity: 1,
      formula: "C21H16N2",
      authority: "USER_SUPPLIED",
      created_by: "usr-researcher-1",
      created_at: "2026-11-03T18:00:00Z",
      coordinates: {
        coordinate_system: "CARTESIAN",
        unit: "angstrom",
        atoms,
        bonds: [],
      },
      provenance: {
        source_class: "USER_SUPPLIED",
        actor_id: "usr-researcher-1",
        verification_state: "VERIFIED",
        created_at: "2026-11-03T18:00:00Z",
      },
    },
  };
}

export function hno3VibrationalDetail(projectId = PAPER_PROJECT_ID) {
  const atoms = [
    { index: 0, element: "H", atomic_number: 1, x: 0.0, y: 0.0, z: 0.0 },
    { index: 1, element: "O", atomic_number: 8, x: 0.96, y: 0.0, z: 0.0 },
    { index: 2, element: "N", atomic_number: 7, x: 1.45, y: 1.25, z: 0.0 },
    { index: 3, element: "O", atomic_number: 8, x: 2.65, y: 1.35, z: 0.0 },
    { index: 4, element: "O", atomic_number: 8, x: 0.70, y: 2.20, z: 0.0 },
  ];
  const structure = {
    structure: {
      id: HNO3_STRUCTURE_ID,
      project_id: projectId,
      name: "hno3 - optimized V2",
      kind: "MOLECULE",
      created_at: "2026-11-03T18:00:00Z",
    },
    version: {
      id: HNO3_VERSION_ID,
      structure_id: HNO3_STRUCTURE_ID,
      revision: 2,
      overall_charge: 0,
      multiplicity: 1,
      formula: "HNO3",
      authority: "CALCULATED",
      created_by: "usr-researcher-1",
      created_at: "2026-11-03T18:00:00Z",
      coordinates: {
        coordinate_system: "CARTESIAN",
        unit: "angstrom",
        atoms,
        bonds: [],
      },
      provenance: {
        source_class: "CALCULATED",
        actor_id: "usr-researcher-1",
        verification_state: "VERIFIED",
        created_at: "2026-11-03T18:00:00Z",
      },
    },
  };

  const inputJson = JSON.stringify({ structure_version_id: HNO3_VERSION_ID });
  const inputBytes = Buffer.from(inputJson, "utf-8");
  const inputHash = createHash("sha256").update(inputBytes).digest("hex");

  const spec = {
    task_type: "FREQUENCY",
    method: { identifier: "b3lyp", display_name: "B3LYP", registry: "chemdft.method" },
    basis: { identifier: "def2-svp", display_name: "DEF2-SVP", registry: "chemdft.basis" },
    charge: 0,
    multiplicity: 1,
    engine_preference: { engine: "pyscf" },
  };

  const calculation = {
    calculation_input_hash: inputHash,
    specification: spec,
    calculation: {
      id: HNO3_CALC_ID,
      input_id: HNO3_INPUT_ID,
      project_id: projectId,
      structure_version_id: HNO3_VERSION_ID,
      state: "SUCCEEDED",
      specification: spec,
    },
    attempt: {
      state: "SUCCEEDED",
      raw_artifacts: [
        {
          artifact_id: HNO3_INPUT_ARTIFACT_ID,
          project_id: projectId,
          file_name: "calculation_input.json",
          format_identifier: "application/json",
          sha256: inputHash,
        },
      ],
    },
    result: {
      id: HNO3_RESULT_ID,
      project_id: projectId,
      calculation_id: HNO3_CALC_ID,
      calculation_input_id: HNO3_INPUT_ID,
      result_type: "chemdft.vibrational-analysis",
      validation_state: "VALIDATED",
      payload_schema: "chemdft.vibrational-analysis",
      producer_software: { name: "PySCF", version: "2.14.0" },
      source_class: "CALCULATED",
      payload: {
        engine: "pyscf",
        engine_version: "2.14.0",
        task_type: "FREQUENCY",
        method: "b3lyp",
        basis: "def2-svp",
        multiplicity: 1,
        charge: 0,
        coordinate_unit: "angstrom",
        frequency_unit: "cm^-1",
        input_structure_version_id: HNO3_VERSION_ID,
        input_structure_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        equilibrium_coordinates_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        equilibrium_coordinates_angstrom: [
          [0.0, 0.0, 0.0],
          [0.96, 0.0, 0.0],
          [1.45, 1.25, 0.0],
          [2.65, 1.35, 0.0],
          [0.70, 2.20, 0.0],
        ],
        atom_identities: ["H", "O", "N", "O", "O"],
        result_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        expected_vibrational_mode_count: 9,
        frequencies: [509.8, 598.5, 673.0, 791.1, 930.6, 1329.0, 1397.9, 1839.1, 3722.3],
        ir_intensities: [10.2, 5.1, 8.4, 25.0, 12.3, 110.5, 85.2, 230.1, 45.0],
        modes: [
          {
            index: 0,
            frequency_cm1: 509.8,
            displacement_vectors: [
              [0.0, 0.0, 0.15],
              [0.0, 0.0, -0.10],
              [0.0, 0.12, 0.05],
              [0.0, -0.08, 0.02],
              [0.0, 0.04, -0.06],
            ],
            imaginary: false,
            ir_intensity: { value: 10.2, unit: "km/mol" },
          },
        ],
      },
    },
  };

  return { structure, calculation, inputBytes, inputHash };
}

export function defaultCapabilities() {
  return [
    {
      engine: "pyscf",
      version: "2.14.0",
      availability: "AVAILABLE",
      supported_tasks: ["ENERGY", "GEOMETRY_OPTIMIZATION", "FREQUENCY", "ORBITAL", "TDDFT"],
      supported_methods: ["hf", "b3lyp", "pbe"],
      supported_basis_sets: ["sto-3g", "6-31g", "def2-svp", "def2-svpd"],
      supported_optimizers: ["geometric"],
      max_atoms: 12,
    },
    {
      engine: "xtb",
      version: "6.7.1",
      availability: "AVAILABLE",
      supported_tasks: ["ENERGY", "GEOMETRY_OPTIMIZATION"],
      supported_methods: ["gfn2"],
      supported_basis_sets: [],
      supported_optimizers: ["xtb-ancopt"],
      supported_optimization_levels: ["normal"],
      max_atoms: 50,
    },
    {
      engine: "crest",
      version: "3.0.2+pf8c-ewinfix-a1",
      availability: "AVAILABLE",
      supported_tasks: ["CONFORMER_SEARCH"],
      supported_methods: ["gfn2"],
      supported_basis_sets: [],
    },
  ];
}

export type PaperFixesMockOptions = {
  emptyProject?: boolean;
  withLophine?: boolean;
  withVibrationalResult?: boolean;
  canceledCalculation?: boolean;
  onGenerateCandidate?: (body: Record<string, unknown>) => void;
  onManualClaim?: (body: Record<string, unknown>) => void;
};

export async function preferAdvancedWorkbench(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("chemdft:workspace-mode", "advanced");
    } catch {}
  });
}

export async function preferGuidedWorkbench(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("chemdft:workspace-mode", "guided");
    } catch {}
  });
}

export async function setupPaperFixesMocks(page: Page, options: PaperFixesMockOptions = {}) {
  const projectId = PAPER_PROJECT_ID;
  const lophine = lophineStructureDetail(projectId);
  const vib = hno3VibrationalDetail(projectId);

  let structures: Array<typeof lophine["structure"]> = [];
  if (options.withLophine) {
    structures = [lophine.structure];
  } else if (options.withVibrationalResult) {
    structures = [vib.structure.structure];
  }

  const claimsList: Array<Record<string, unknown>> = [
    {
      id: CLAIM_USER_ENTERED_ID,
      project_id: projectId,
      claim_type: "USER_ENTERED_LITERATURE_VALUE",
      source_authority: "USER_ENTERED",
      predicate: "relative_energy",
      subject: "Complex b - a",
      value: 10.2,
      unit: "kcal/mol",
      qualifier: "user entered literature",
      source_label: "Mammadov et al. 2026",
      page: 8,
      review_state: "COMMITTED",
      created_at: "2026-11-03T20:00:00Z",
    },
  ];

  await page.route("**/api/chemdft/v1/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path.includes(`/artifacts/${HNO3_INPUT_ARTIFACT_ID}`)) {
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-disposition": 'attachment; filename="calculation_input.json"',
        },
        body: vib.inputBytes,
      });
    }

    if (path.endsWith(`/projects/${projectId}`) && method === "GET") {
      return route.fulfill({ json: { id: projectId, name: PAPER_PROJECT_NAME } });
    }

    if (path.endsWith(`/projects/${projectId}/structures`) && method === "GET") {
      return route.fulfill({ json: structures });
    }

    if (path.includes(`/projects/${projectId}/structures/`) && path.endsWith("/versions") && method === "GET") {
      if (options.withLophine) return route.fulfill({ json: [lophine] });
      if (options.withVibrationalResult) return route.fulfill({ json: [vib.structure] });
      return route.fulfill({ json: [] });
    }

    if (path.includes(`/projects/${projectId}/structures/`) && method === "GET") {
      if (options.withLophine) return route.fulfill({ json: lophine });
      if (options.withVibrationalResult) return route.fulfill({ json: vib.structure });
      return route.fulfill({ json: lophine });
    }

    if (path.includes("/geometry-eligibility")) {
      return route.fulfill({ json: { eligible: true } });
    }

    if (path.includes("/capabilities")) {
      return route.fulfill({ json: defaultCapabilities() });
    }

    if (path.endsWith("/geometry-candidates") && method === "POST") {
      const body = JSON.parse(request.postData() ?? "{}");
      options.onGenerateCandidate?.(body);
      return route.fulfill({
        json: {
          id: "cand-bmim-1",
          project_id: projectId,
          state: "PENDING_ACCEPTANCE",
          manifest: {
            formula: "C8H15N2",
            canonical_smiles: "CCCCn1cc[n+](C)c1",
            coordinate_representation: {
              kind: "MOLECULE",
              name: "BMIM+",
              coordinates: {
                coordinate_system: "CARTESIAN",
                unit: "angstrom",
                atoms: [{ index: 0, element: "C", atomic_number: 6, x: 0, y: 0, z: 0 }],
                bonds: [],
              },
            },
          },
        },
      });
    }

    if (path.includes("/scientific-claims/manual") && method === "POST") {
      const postData = request.postDataJSON() as Record<string, unknown>;
      options.onManualClaim?.(postData);
      const newClaimId = "00000000-0000-4000-8000-000000000041";
      claimsList.push({
        id: newClaimId,
        project_id: projectId,
        claim_type: "USER_ENTERED_LITERATURE_VALUE",
        source_authority: "USER_ENTERED",
        predicate: `Literature claim · ${postData.quantity ?? ""}`,
        subject: (postData.system as string) || "System",
        value: Number(postData.value),
        unit: (postData.unit as string) || "",
        qualifier: `entered by you; paper reports: “${postData.quote ?? ""}”`,
        source_label: "Paper claim · entered by you",
        page: Number(postData.page),
        review_state: "COMMITTED",
        created_at: new Date().toISOString(),
      });
      return route.fulfill({
        status: 201,
        json: { evidence_id: "00000000-0000-4000-8000-000000000099" },
      });
    }

    if (path.includes("/scientific-claims") && method === "GET") {
      return route.fulfill({
        json: {
          claims: claimsList,
        },
      });
    }

    if (path.endsWith("/calculations") || path.includes("/calculations/")) {
      if (options.canceledCalculation) {
        const canceledSpec = {
          task_type: "ENERGY",
          method: { identifier: "b3lyp", display_name: "B3LYP" },
          basis: { identifier: "def2-svp", display_name: "DEF2-SVP" },
          charge: 0,
          multiplicity: 1,
          engine_preference: { engine: "pyscf" },
        };
        return route.fulfill({
          json: {
            specification: canceledSpec,
            calculation_input_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            calculation: {
              id: CANCELED_CALC_ID,
              input_id: "00000000-0000-4000-8000-000000000032",
              project_id: projectId,
              structure_version_id: LOPHINE_VERSION_ID,
              state: "CANCELED",
              specification: canceledSpec,
            },
            attempt: {
              state: "CANCELED",
              diagnostic: "Canceled by the researcher.",
              raw_artifacts: [],
            },
            compute_job: {
              id: CANCELED_JOB_ID,
              state: "CANCELED",
              worker_status: "AWS_JOB_CANCELED",
            },
          },
        });
      }
      if (options.withVibrationalResult) {
        return route.fulfill({ json: vib.calculation });
      }
      return route.fulfill({ json: { calculations: [] } });
    }

    if (path.includes("/ai/settings")) {
      return route.fulfill({
        json: {
          availability: { allowance_status: "AVAILABLE", available: true, byok_enabled: false, managed_enabled: true, mode: "MANAGED", model: "nemotron-3.5-lightning", provider: "NVIDIA", secret_storage_available: true },
          credentials: [], preferences: { provider: "NVIDIA", model: "nemotron-3.5-lightning" },
          providers: [{ provider: "NVIDIA", models: ["nemotron-3.5-lightning"], local_test_only: false }],
          model_capabilities: [{ provider: "NVIDIA", model_identifier: "nemotron-3.5-lightning", display_name: "Nemotron 3.5 Lightning 30B", status: "APPROVED", eligibility: "PRODUCTION", selectable: true, configured: true, reviewed_on: "2026-10-26", tool_compatibility_verified: true, verification_scope: "Structured function calling", proposal_workflow_verified: true }],
        },
      });
    }

    if (path.endsWith("/ai/context")) {
      return route.fulfill({
        json: {
          ai: { allowance_status: "AVAILABLE", available: true, mode: "MANAGED", model: "nemotron-3.5-lightning", provider: "NVIDIA" },
          allowed_tools: ["ask_ai_scientist"], can_write: true, project_id: projectId, project_name: PAPER_PROJECT_NAME,
          role: "OWNER", selection: {}, navigator: { blocked: [], goal: null, have: [], next: [], notices: [] },
        },
      });
    }

    if (path.endsWith("/me")) {
      return route.fulfill({ json: { id: "researcher-1", email: "researcher@example.com", name: "Researcher" } });
    }

    if (path.endsWith("/role")) return route.fulfill({ json: { role: "owner", canExecute: true } });
    if (path.includes("/geometry-candidates") || path.includes("/structure-candidates")) return route.fulfill({ json: { candidates: [] } });
    if (path.includes("/external-imports") || path.includes("/imports")) return route.fulfill({ json: { imports: [] } });
    if (path.includes("/spectra") || path.includes("/datasets")) return route.fulfill({ json: { datasets: [] } });
    if (path.includes("/memory")) return route.fulfill({ json: { memories: [], items: [] } });
    if (path.includes("/documents")) {
      return route.fulfill({
        json: {
          documents: [
            {
              id: PAPER_DOCUMENT_ID,
              project_id: projectId,
              title: "Lophine-nitric acid complexes in an ionic liquid",
              doi: "10.1000/182",
              page_count: 12,
              created_at: "2026-11-03T18:00:00Z",
            },
          ],
        },
      });
    }
    if (path.includes("/investigations")) return route.fulfill({ json: [] });
    if (path.includes("/ai/conversations")) return route.fulfill({ json: { conversations: [] } });

    if (path.endsWith("/jobs") || path.includes("/compute/jobs")) {
      if (options.withVibrationalResult) {
        return route.fulfill({
          json: {
            jobs: [
              {
                id: HNO3_JOB_ID,
                project_id: projectId,
                calculation_id: HNO3_CALC_ID,
                state: "SUCCEEDED",
                provider: "chemdft-local",
                workload: { workload_type: "FREQUENCY" },
              },
            ],
          },
        });
      }
      if (options.canceledCalculation) {
        return route.fulfill({
          json: {
            jobs: [
              {
                id: CANCELED_JOB_ID,
                project_id: projectId,
                calculation_id: CANCELED_CALC_ID,
                state: "CANCELED",
                provider: "chemdft-local",
                workload: { workload_type: "ENERGY" },
              },
            ],
          },
        });
      }
      return route.fulfill({ json: { jobs: [] } });
    }

    if (path.includes("/history")) return route.fulfill({ json: [] });
    if (path.endsWith("/files")) return route.fulfill({ json: [] });

    return route.fulfill({ json: {} });
  });
}
