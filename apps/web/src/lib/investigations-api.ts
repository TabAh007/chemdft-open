import type {
  CreateHypothesisInput,
  CreateInvestigationInput,
  CreatePlanInput,
  InvestigationListOutput,
  InvestigationView,
} from "@chemdft/schemas";

const API_ROOT = process.env.NEXT_PUBLIC_CHEMDFT_API_ROOT ?? "/api/chemdft";

export async function listInvestigations(projectId: string): Promise<InvestigationListOutput> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/investigations`, { cache: "no-store" }));
}

export async function createInvestigation(projectId: string, payload: CreateInvestigationInput): Promise<InvestigationView> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/investigations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
}

export async function addInvestigationHypothesis(projectId: string, investigationId: string, payload: CreateHypothesisInput): Promise<InvestigationView> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/investigations/${investigationId}/hypotheses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
}

export async function addInvestigationPlan(projectId: string, investigationId: string, payload: CreatePlanInput): Promise<InvestigationView> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/investigations/${investigationId}/plans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
}

export async function decideInvestigationApproval(
  projectId: string,
  investigationId: string,
  approvalId: string,
  decision: "APPROVE" | "REJECT",
): Promise<InvestigationView> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/investigations/${investigationId}/approvals/${approvalId}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  }));
}

export async function startInvestigation(projectId: string, investigationId: string): Promise<InvestigationView> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/investigations/${investigationId}/start`, { method: "POST" }));
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Investigation request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}
