import type { Page, Route } from "@playwright/test";

export const EDITOR_PROJECT_ID = "editor-proj";

/** A deterministic ethanol candidate, shaped like the server's geometry-candidate view (mock transport only). */
export function ethanolCandidate(projectId = EDITOR_PROJECT_ID) {
  const el = (i: number, element: string, z: number, x: number, y: number) => ({ index: i, element, atomic_number: ({ C: 6, O: 8, H: 1 } as Record<string, number>)[element], x, y, z });
  return {
    id: "cand-ethanol-1",
    project_id: projectId,
    state: "PENDING_ACCEPTANCE",
    candidate_artifact: { artifact_id: "art-1", project_id: projectId, sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" },
    manifest: {
      formula: "C2H6O",
      canonical_smiles: "CCO",
      generation_method: "rdkit.etkdg3.preview-conformer",
      generation_parameters: { random_seed: 42 },
      geometry_class: "GENERATED_CONFORMER_NOT_OPTIMIZED",
      source_atom_count: 3,
      explicit_hydrogen_count: 6,
      source_drawing: { artifact_id: "art-draw-1", project_id: projectId, sha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" },
      source_graph_sha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      atom_mapping: [],
      coordinate_representation: {
        kind: "MOLECULE",
        name: "Ethanol",
        coordinates: {
          coordinate_system: "CARTESIAN",
          unit: "angstrom",
          atoms: [
            el(0, "C", 0, -1.2, 0.1), el(1, "C", 0, 0.1, -0.6), el(2, "O", 0, 1.2, 0.3),
            el(3, "H", 0.9, -1.2, 0.8), el(4, "H", -0.9, -1.9, -0.4), el(5, "H", 0.1, -1.3, 0.2),
            el(6, "H", 0.9, 0.1, -1.2), el(7, "H", -0.8, 0.1, -1.2), el(8, "H", 1.9, 0.2, 0.3),
          ],
          bonds: [[0, 1], [1, 2], [0, 3], [0, 4], [0, 5], [1, 6], [1, 7], [2, 8]].map(([a, b]) => ({ atom_index_a: a, atom_index_b: b, order: 1 })),
        },
      },
    },
  };
}

export type EditorMockOptions = {
  /** Called with the parsed body of every POST .../geometry-candidates. */
  onGenerate?: (body: Record<string, unknown>) => void;
  generateStatus?: number;
};

/** Mock transport for an empty project (no structures) so the editor can be opened without a backend. */
export async function setupEditorMocks(page: Page, options: EditorMockOptions = {}) {
  const calls = { generate: 0, accept: 0, imports: 0 };
  await page.route("**/api/chemdft/v1/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/geometry-candidates") && request.method() === "POST") {
      calls.generate += 1;
      options.onGenerate?.(JSON.parse(request.postData() ?? "{}") as Record<string, unknown>);
      if (options.generateStatus && options.generateStatus !== 200) {
        return route.fulfill({ status: options.generateStatus, json: { detail: "Drawing could not be converted to 3D." } });
      }
      return route.fulfill({ json: ethanolCandidate() });
    }
    if (path.includes("/geometry-candidates") && path.endsWith("/accept")) {
      calls.accept += 1;
      return route.fulfill({ status: 500, json: { detail: "accept not mocked" } });
    }
    if (path.endsWith("/structures") || path.endsWith("/files")) return route.fulfill({ json: [] });
    if (path.includes("/geometry-candidates") || path.includes("/structure-candidates")) return route.fulfill({ json: { candidates: [] } });
    if (path.includes("/external-imports") || path.includes("/imports")) return route.fulfill({ json: { imports: [] } });
    if (path.includes("/spectra") || path.includes("/datasets")) return route.fulfill({ json: { datasets: [] } });
    if (path.includes("/memory")) return route.fulfill({ json: { memories: [], items: [] } });
    if (path.includes("/role")) return route.fulfill({ json: { role: "owner", canExecute: true } });
    if (path.includes("/documents")) return route.fulfill({ json: { documents: [] } });
    if (path.includes("/capabilities")) return route.fulfill({ json: [] });
    if (path.endsWith("/ai/context")) {
      return route.fulfill({
        json: {
          ai: { allowance_status: "AVAILABLE", available: true, byok_enabled: false, managed_enabled: true, mode: "MANAGED", model: "nemotron-3.5-lightning", provider: "NVIDIA", secret_storage_available: true },
          allowed_tools: ["ask_ai_scientist"], can_write: true, generated_at: "2026-10-26T10:00:00Z", human_id: "mock",
          navigator: { blocked: [], goal: null, have: [], next: [], notices: [] },
          organization_id: "org-1", project_id: EDITOR_PROJECT_ID, project_kind: "RESEARCH", project_name: "Editor project",
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
    if (path.endsWith("/investigations")) return route.fulfill({ json: [] });
    if (path.includes("/ai/conversations")) return route.fulfill({ json: { conversations: [] } });
    if (path.endsWith(`/projects/${EDITOR_PROJECT_ID}`)) return route.fulfill({ json: { id: EDITOR_PROJECT_ID, name: "Editor project" } });
    if (path.endsWith("/me")) return route.fulfill({ json: { id: "user-1", email: "researcher@example.com", name: "Researcher" } });
    if (path.endsWith("/jobs") || path.includes("/compute/jobs")) return route.fulfill({ json: { jobs: [] } });
    if (path.includes("/history")) return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  return calls;
}

export async function preferAdvancedWorkbench(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("chemdft:workspace-mode", "advanced");
    } catch {}
  });
}


/** The Import popover holds the SMILES/MOL field and the template chips; open it if it is closed. */
export async function openImport(page: import("@playwright/test").Page) {
  const panel = page.getByTestId("editor-start-row");
  if (!(await panel.isVisible())) await page.getByTestId("editor-import").click();
  await panel.waitFor({ state: "visible" });
}

export async function pickTemplate(page: import("@playwright/test").Page, id: string) {
  await openImport(page);
  await page.getByTestId(`template-${id}`).click();
}
