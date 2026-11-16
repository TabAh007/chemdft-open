import type { Page, Route } from "@playwright/test";

/**
 * Browser-level mock of the AI Scientist endpoints (no AI provider, no model, no network beyond the page's own mock API).
 * `POST …/ai/context` echoes the hints it receives, so the spec can see exactly what the dock asked the server for;
 * `POST …/messages` answers with a fixed string that names the view it was sent under.
 */
export type AiMock = {
  /** Every ProductSelection the panel sent to `/ai/context`, in order. */
  contextRequests: Array<Record<string, unknown>>;
  /** Every message body the panel posted. */
  messagePosts: Array<Record<string, unknown>>;
  /** Hold the next message POST until `release()` (to test a request that outlives a page change). */
  hold: () => { release: () => void };
};

const NOW = "2026-10-26T10:00:00Z";
const STRUCTURE_VERSION = "00000000-0000-4000-8000-0000000000e5";
const CONVERSATION = "00000000-0000-4000-8000-00000000cc01";

/**
 * `emptyInventory` answers the project-tree endpoints that the presentation-fixture mock APIs do not serve, so the dock
 * mounts (it waits for the project tree). `noJobs` also answers the compute-jobs list (not for the Jobs fixture). Never use either
 * against the evidence stack.
 */
export async function mockAi(page: Page, { emptyInventory = false, noJobs = false, result = null, customMessages = null, answerText = null, latestRun = null }: { emptyInventory?: boolean; noJobs?: boolean; result?: { resultId: string; calculationId: string } | null; customMessages?: Array<{ role: "user" | "assistant"; content: string }> | null; answerText?: string | null; latestRun?: Record<string, unknown> | null } = {}): Promise<AiMock> {
  const projectIdPattern = "*";
  const mock: AiMock = { contextRequests: [], messagePosts: [], hold: () => ({ release: () => undefined }) };
  let gate: Promise<void> | null = null;
  const summary = (projectId: string) => ({ id: CONVERSATION, project_id: projectId, title: "Scientific conversation", created_at: NOW, updated_at: NOW });
  let counter = 0;
  const message = (role: "user" | "assistant", content: string) => ({ id: `00000000-0000-4000-8000-00000000${String(++counter).padStart(4, "0")}`, conversation_id: CONVERSATION, role, content, created_at: NOW });
  // One earlier exchange that was asked about something else: it must never appear as the answer in a new context.
  const messages = customMessages
    ? customMessages.map((m) => message(m.role, m.content))
    : [message("user", "Earlier question about the Raman spectrum"), message("assistant", "Earlier answer: the Raman peak is at 1600 cm-1")];
  const detail = (projectId: string) => ({ conversation: summary(projectId), latest_run: latestRun ?? null, messages });
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (emptyInventory) {
    const empty: Record<string, unknown> = {
      files: [], documents: { documents: [] }, structures: [], "structure-candidates": { candidates: [] }, "experimental/datasets": { datasets: [] },
      memory: { memories: [] }, "workspace/history": [], "external-imports": { imports: [] }, "experimental/spectra/datasets": { datasets: [] }, "geometry-candidates": { candidates: [] },
    };
    await page.route(/\/api\/chemdft\/v1\/projects\/[^/]+\/(files|documents|structures|structure-candidates|experimental\/datasets|memory|workspace\/history|external-imports|experimental\/spectra\/datasets|geometry-candidates)(\?.*)?$/, (route) => {
      const key = new URL(route.request().url()).pathname.replace(/^.*\/projects\/[^/]+\//, "");
      return json(route, empty[key] ?? []);
    });
  }
  if (emptyInventory && noJobs) {
    await page.route(/\/api\/chemdft\/v1\/projects\/[^/]+\/compute\/jobs(\?.*)?$/, (route) => json(route, { jobs: [] }));
  }
  if (emptyInventory) {
    // The project tree reads each job's calculation; the fixture mock APIs do not serve them.
    await page.route(/\/api\/chemdft\/v1\/projects\/[^/]+\/calculations\/[^/?]+(\?.*)?$/, (route) => json(route, { calculation: { id: route.request().url().split("/calculations/")[1]?.split("?")[0] ?? "", project_id: route.request().url().split("/projects/")[1]?.split("/")[0] ?? "", state: "SUCCEEDED" }, compute_job: null, specification: { task_type: "ENERGY", method: { display_name: "HF" }, basis: { display_name: "STO-3G" } }, result: null }));
  }
  if (emptyInventory) {
    // Registered after the calculation-id route above, so it wins: the id route must never answer `calculations/capabilities`.
    await page.route(/\/api\/chemdft\/v1\/projects\/[^/]+\/calculations\/capabilities(\?.*)?$/, (route) => json(route, []));
  }
  await page.route(new RegExp(`/api/chemdft/v1/projects/${projectIdPattern === "*" ? "[^/]+" : projectIdPattern}/(ai|investigations)`), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const projectId = url.pathname.split("/")[5] ?? "";
    const path = url.pathname;
    if (path.endsWith("/ai/context") && request.method() === "POST") {
      const selection = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      mock.contextRequests.push(selection);
      return json(route, {
        ai: { allowance_status: "AVAILABLE", available: true, byok_enabled: false, managed_enabled: true, mode: "MANAGED", model: "mock-model", provider: "MOCK", secret_storage_available: true },
        allowed_tools: [], can_write: true, generated_at: NOW, human_id: "mock", navigator: { blocked: [], goal: null, have: [], next: [], notices: [] },
        organization_id: "00000000-0000-4000-8000-0000000000f0", project_id: projectId, project_kind: "RESEARCH", project_name: "Mock project", published_example: false,
        // The real server resolves a selected result to its resource (calculation and input version); the panel checks the pairing.
        resources: result && selection.selected_result_id === result.resultId
          ? [{ entity_type: "calculation.result", entity_id: result.resultId, calculation_id: result.calculationId, structure_version_id: STRUCTURE_VERSION, label: "result", source_class: "CALCULATED", verification_state: "VERIFIED" }]
          : [],
        role: "OWNER", sealed: false,
        selection: result && selection.selected_result_id === result.resultId ? { ...selection, selected_structure_version_id: STRUCTURE_VERSION } : selection,
      });
    }
    if (path.endsWith("/ai/conversations") && request.method() === "GET") return json(route, { conversations: [summary(projectId)] });
    if (path.endsWith("/ai/conversations") && request.method() === "POST") return json(route, detail(projectId));
    if (path.endsWith(`/ai/conversations/${CONVERSATION}`)) return json(route, detail(projectId));
    if (path.endsWith("/messages") && request.method() === "POST") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      mock.messagePosts.push(body);
      if (gate) await gate;
      const reply = answerText ?? `Mock answer under: ${String(body.current_view ?? "")}`;
      messages.push(message("user", String(body.content)), message("assistant", reply));
      return json(route, detail(projectId));
    }
    if (path.includes("/investigations")) return json(route, { investigations: [] });
    if (path.includes("/ai/runs/") && request.method() === "GET") return json(route, latestRun ?? { id: path.split("/").pop(), status: "SUCCEEDED" });
    return json(route, { error: "not mocked" }, 404);
  });
  mock.hold = () => {
    let release = () => undefined as void;
    gate = new Promise<void>((resolve) => { release = () => { gate = null; resolve(); }; });
    return { release };
  };
  return mock;
}
