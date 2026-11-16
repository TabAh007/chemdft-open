import { type Page, type Route } from "@playwright/test";
import reference from "../../src/app/_components/home/reference/cr2o3-reference.json" with { type: "json" };

// Shared mock backend for the offline release specs. Everything returned here is a TEST FIXTURE, never a scientific result.

const DEG = Math.PI / 180;
function calcLatticeVectors(l: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number }) {
  const ca = Math.cos(l.alpha * DEG);
  const cb = Math.cos(l.beta * DEG);
  const cg = Math.cos(l.gamma * DEG);
  const sg = Math.sin(l.gamma * DEG);
  const cy = (ca - cb * cg) / sg;
  return [
    [l.a, 0, 0],
    [l.b * cg, l.b * sg, 0],
    [l.c * cb, l.c * cy, l.c * Math.sqrt(Math.max(0, 1 - cb * cb - cy * cy))],
  ];
}

const latticeVectors = calcLatticeVectors(reference.lattice);
const cr2o3Atoms = reference.sites.map((site, i) => ({
  index: i,
  element: site.element,
  atomic_number: site.element === "Cr" ? 24 : 8,
  x: site.fractional[0],
  y: site.fractional[1],
  z: site.fractional[2],
}));

export function makeCr2O3Detail() {
  return {
    structure: {
      id: "s-cr2o3",
      project_id: "cr2o3-proj",
      name: "Cr2O3 eskolaite unit cell",
      kind: "PERIODIC",
    },
    version: {
      id: "v-cr2o3-1",
      structure_id: "s-cr2o3",
      revision: 1,
      origin: "IMPORTED",
      overall_charge: 0,
      multiplicity: 1,
      periodic_cell: {
        a: reference.lattice.a,
        b: reference.lattice.b,
        c: reference.lattice.c,
        alpha: reference.lattice.alpha,
        beta: reference.lattice.beta,
        gamma: reference.lattice.gamma,
        lattice_vectors: latticeVectors,
        periodic_dimensions: [true, true, true],
        unit: "angstrom",
      },
      coordinates: {
        coordinate_system: "FRACTIONAL",
        unit: "angstrom",
        atoms: cr2o3Atoms,
      },
    },
  };
}

export async function setupMockRoutes(page: Page, detail: unknown, options: { qe?: boolean; calculations?: unknown } = {}) {
  await page.route("**/api/chemdft/v1/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/structures/s-cr2o3/versions/v-cr2o3-1")) {
      return route.fulfill({ json: detail });
    }
    if (path.includes("/structures/s-cr2o3/versions")) {
      return route.fulfill({ json: [detail] });
    }
    if (path.endsWith("/structures")) {
      return route.fulfill({
        json: [
          {
            id: "s-cr2o3",
            project_id: "cr2o3-proj",
            name: "Cr2O3 eskolaite unit cell",
            kind: "PERIODIC",
            latest_version_id: "v-cr2o3-1",
            latest_revision: 1,
          },
        ],
      });
    }
    if (path.includes("/role")) {
      return route.fulfill({ json: { role: "owner", canExecute: true } });
    }
    if (path.includes("/compute/jobs") || path.endsWith("/jobs")) {
      return route.fulfill({ json: { jobs: [] } });
    }
    if (path.includes("/structure-candidates") || path.includes("/geometry-candidates") || path.includes("/candidates")) {
      return route.fulfill({ json: { candidates: [] } });
    }
    if (path.includes("/external-imports") || path.includes("/imports")) {
      return route.fulfill({ json: { imports: [] } });
    }
    if (path.includes("/spectra") || path.includes("/datasets")) {
      return route.fulfill({ json: { datasets: [] } });
    }
    if (path.includes("/documents")) {
      return route.fulfill({ json: { documents: [] } });
    }
    if (path.includes("/memory")) {
      return route.fulfill({ json: { memories: [], items: [] } });
    }
    if (path.includes("/workspace/history") || path.includes("/history")) {
      return route.fulfill({ json: [] });
    }
    if (path.includes("/files")) {
      return route.fulfill({ json: [] });
    }
    if (path.includes("/capabilities")) {
      return route.fulfill({
        json: [
          {
            engine: "pyscf",
            version: "2.14.0",
            availability: "AVAILABLE",
            supported_tasks: ["ENERGY", "PERIODIC_ENERGY", "GEOMETRY_OPTIMIZATION"],
            supported_methods: ["hf", "pbe", "pbe+u"],
            supported_basis_sets: ["sto-3g", "gth-dzvp-molopt-sr"],
          },
          ...(options.qe === false ? [] : [{
            engine: "qe",
            version: "7.6",
            availability: "AVAILABLE",
            supported_tasks: ["PERIODIC_ENERGY"],
            supported_methods: ["pbe", "pbe+u"],
            supported_basis_sets: ["pw-sssp-pbe-eff-v2"],
          }]),
        ],
      });
    }
    if (path.includes("/eligibility")) {
      return route.fulfill({ json: { eligible: true, issues: [] } });
    }
    if (path.endsWith("/ai/context")) {
      return route.fulfill({
        json: {
          ai: { allowance_status: "AVAILABLE", available: true, byok_enabled: false, managed_enabled: true, mode: "MANAGED", model: "nemotron-3.5-lightning", provider: "NVIDIA", secret_storage_available: true },
          allowed_tools: ["ask_ai_scientist"], can_write: true, generated_at: "2026-10-26T10:00:00Z", human_id: "mock",
          navigator: { blocked: [], goal: null, have: [], next: [], notices: [] },
          organization_id: "org-1", project_id: "cr2o3-proj", project_kind: "RESEARCH", project_name: "Cr2O3 eskolaite investigation",
          published_example: false, resources: [], role: "OWNER", sealed: false, selection: {},
        },
      });
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
    if (path.includes("/ai/conversations")) {
      return route.fulfill({ json: { conversations: [] } });
    }
    if (path.endsWith("/projects/cr2o3-proj")) {
      return route.fulfill({ json: { id: "cr2o3-proj", name: "Cr2O3 eskolaite investigation" } });
    }
    if (path.endsWith("/me")) {
      return route.fulfill({ json: { id: "user-1", email: "researcher@example.com", name: "Researcher" } });
    }
    if (path.includes("/calculations")) {
      if (options.calculations !== undefined && route.request().method() === "POST") return route.fulfill({ json: options.calculations });
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: {} });
  });
}


/** The 10-atom rhombohedral primitive cell of Cr2O3 (the cell the hosted limit of 20 atoms allows). Geometry only, no result. */
export function makeCr2O3PrimitiveDetail() {
  const base = makeCr2O3Detail();
  const a = 5.35946661;
  const c = Math.cos(55.1030411 * DEG);
  const tx = Math.sqrt((1 - c) / 2);
  const ty = Math.sqrt((1 - c) / 6);
  const tz = Math.sqrt((1 + 2 * c) / 3);
  const lattice_vectors = [[a * tx, -a * ty, a * tz], [0, 2 * a * ty, a * tz], [-a * tx, -a * ty, a * tz]];
  const cr = [0.84749, 0.34749, 0.15251, 0.65251].map((z, i) => ({ index: i, element: "Cr", atomic_number: 24, x: z, y: z, z }));
  const o = [[0.4443, 0.0557, 0.75], [0.0557, 0.75, 0.4443], [0.5557, 0.9443, 0.25], [0.25, 0.5557, 0.9443], [0.9443, 0.25, 0.5557], [0.75, 0.4443, 0.0557]]
    .map(([x, y, z], i) => ({ index: 4 + i, element: "O", atomic_number: 8, x, y, z }));
  return {
    ...base,
    version: {
      ...base.version,
      periodic_cell: { ...base.version.periodic_cell, a, b: a, c: a, alpha: 55.1030411, beta: 55.1030411, gamma: 55.1030411, lattice_vectors },
      coordinates: { coordinate_system: "FRACTIONAL", unit: "angstrom", atoms: [...cr, ...o] },
    },
  };
}
