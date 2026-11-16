import type {
  AIConversationDetail,
  AIModelPerformanceView, AISettingsView, AIPreferencesInput, BYOKStatusView, ProductContext, ProductSelection,
  AIConversationListOutput,
  AIRunView,
  AIRunEventsOutput,
  ApprovalDecisionInput,
  CreateConversationInput,
  DrawInput,
  DrawResponse,
  PostMessageInput,
} from "@chemdft/schemas";

const API_ROOT = process.env.NEXT_PUBLIC_CHEMDFT_API_ROOT ?? "/api/chemdft";

export async function createAiConversation(
  projectId: string,
  payload: CreateConversationInput,
): Promise<AIConversationDetail> {
  return readJson(
    await aiFetch(`${API_ROOT}/v1/projects/${projectId}/ai/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function listAiConversations(
  projectId: string,
): Promise<AIConversationListOutput> {
  return apiJson(`/v1/projects/${projectId}/ai/conversations`);
}

export async function getAiConversation(
  projectId: string,
  conversationId: string,
): Promise<AIConversationDetail> {
  return apiJson(`/v1/projects/${projectId}/ai/conversations/${conversationId}`);
}

export async function postAiMessage(
  projectId: string,
  conversationId: string,
  payload: PostMessageInput,
): Promise<AIConversationDetail> {
  return readJson(
    await aiFetch(
      `${API_ROOT}/v1/projects/${projectId}/ai/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),
  );
}

export async function getAiRun(
  projectId: string,
  runId: string,
): Promise<AIRunView> {
  return apiJson(`/v1/projects/${projectId}/ai/runs/${runId}`);
}

export async function resumeAiRun(
  projectId: string,
  runId: string,
): Promise<AIRunView> {
  return readJson(
    await aiFetch(`${API_ROOT}/v1/projects/${projectId}/ai/runs/${runId}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    }),
  );
}

export async function pauseAiRun(
  projectId: string,
  runId: string,
): Promise<AIRunView> {
  return readJson(
    await aiFetch(`${API_ROOT}/v1/projects/${projectId}/ai/runs/${runId}/pause`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    }),
  );
}

export async function getAiRunEvents(
  projectId: string,
  runId: string,
  afterSequence = 0,
): Promise<AIRunEventsOutput> {
  return apiJson(`/v1/projects/${projectId}/ai/runs/${runId}/events?after_sequence=${afterSequence}`);
}

export async function cancelAiRun(
  projectId: string,
  runId: string,
): Promise<AIRunView> {
  return readJson(
    await aiFetch(`${API_ROOT}/v1/projects/${projectId}/ai/runs/${runId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    }),
  );
}

export async function decideAiApproval(
  projectId: string,
  approvalId: string,
  payload: ApprovalDecisionInput,
): Promise<AIRunView> {
  return readJson(
    await aiFetch(
      `${API_ROOT}/v1/projects/${projectId}/ai/approvals/${approvalId}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),
  );
}

async function apiJson<T>(path: string): Promise<T> {
  return readJson(await aiFetch(`${API_ROOT}${path}`, { cache: "no-store" }));
}

export class AiApiError extends Error {
  constructor(public status: number, public code: string | null, message: string) {
    super(message);
    this.name = "AiApiError";
  }
}

// Execution is synchronous and DECIMER can consume 180s. A timeout is uncertain, never failure
// proof, and mutations are never retried automatically.
async function aiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(options.method && options.method !== "GET" ? 210_000 : 15_000) });
  } catch (cause) {
    if (cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name)) {
      throw new Error("Request timed out. The synchronous backend may still be executing. Refresh run status before repeating this action; no request was retried.");
    }
    throw new Error("Backend temporarily unavailable. Saved scientific context is retained. Refresh run status before repeating an action.");
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `ChemDFT API request failed with HTTP ${response.status}`;
    let code: string | null = null;
    try {
      const body = await response.json() as { detail?: unknown };
      const value = body.detail;
      if (typeof value === "string") detail = value;
      else if (Array.isArray(value)) detail = value.map(item => item.msg ?? "Invalid request").join("; ");
      else if (value && typeof value === "object") {
        const error = value as Record<string, unknown>;
        code = typeof error.code === "string" ? error.code : null;
        detail = String(error.message ?? error.detail ?? code ?? detail);
      }
    } catch { /* Keep HTTP status when the backend returns non-JSON. */ }
    const recovery = response.status === 409
      ? " Context retained. Inspect the requested candidate and representation, finish researcher review and promotion if required, then refresh status. No action was retried."
      : [401, 403].includes(response.status) ? " Authorization denied. Sign in with an authorized researcher account." : "";
    throw new AiApiError(response.status, code, `HTTP ${response.status}${code ? ` · ${code}` : ""}: ${detail}${recovery}`);
  }
  return response.json() as Promise<T>;
}


export function getAiSettings(): Promise<AISettingsView> {
  return apiJson("/v1/ai/settings");
}
/** Operational telemetry derived from the caller's own run records; never prompts or results. */
export function getAiModelPerformance(): Promise<AIModelPerformanceView> {
  return apiJson("/v1/ai/model-performance");
}
export async function saveAiSettings(preferences: AIPreferencesInput): Promise<AISettingsView> {
  return readJson(await aiFetch(`${API_ROOT}/v1/ai/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(preferences) }));
}
export async function saveAiCredential(provider: string, secret: string): Promise<BYOKStatusView> {
  return readJson(await aiFetch(`${API_ROOT}/v1/billing/byok`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, secret }) }));
}
export async function revokeAiCredential(provider: string): Promise<void> {
  const response = await aiFetch(`${API_ROOT}/v1/billing/byok/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider }) });
  if (!response.ok) await readJson(response);
}
export async function getProductContext(projectId: string, selection: ProductSelection = {}): Promise<ProductContext> {
  return readJson(await aiFetch(`${API_ROOT}/v1/projects/${projectId}/ai/context`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection) }));
}

/**
 * A page's id hints (claim, job, compared results) must never become an error banner: if the server refuses the request,
 * ask again with the view text alone and run without that grounding. A request with no id hints keeps its own error.
 */
export async function getProductContextOrFallback(projectId: string, hints: ProductSelection = {}): Promise<ProductContext> {
  try {
    return await getProductContext(projectId, hints);
  } catch (cause) {
    const idHints = Object.keys(hints).some((field) => field !== "current_view" && field !== "goal");
    if (!idHints) throw cause;
    return getProductContext(projectId, hints.current_view ? { current_view: hints.current_view } : {});
  }
}

/** DRAW mode: the model proposes typed editor commands; the server validates them with RDKit. */
export async function postAiDraw(
  projectId: string,
  conversationId: string,
  payload: DrawInput,
): Promise<DrawResponse> {
  return readJson(
    await aiFetch(`${API_ROOT}/v1/projects/${projectId}/ai/conversations/${conversationId}/draw`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}
