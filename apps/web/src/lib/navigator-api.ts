import type { NavigatorState } from "@chemdft/schemas";

export type NavigatorGoalId = NonNullable<NavigatorState["goal"]>;
const API_ROOT = process.env.NEXT_PUBLIC_CHEMDFT_API_ROOT ?? "/api/chemdft";

export async function getNavigator(projectId: string, options: {
  goal?: NavigatorGoalId | undefined; structureVersionId?: string | undefined; signal?: AbortSignal | undefined;
} = {}): Promise<NavigatorState> {
  const params = new URLSearchParams();
  if (options.goal) params.set("goal", options.goal);
  if (options.structureVersionId) params.set("structure_version_id", options.structureVersionId);
  const response = await fetch(`${API_ROOT}/v1/projects/${encodeURIComponent(projectId)}/navigator?${params}`, { cache: "no-store", signal: options.signal ?? null });
  if (!response.ok) throw new Error(`Navigator request failed (${response.status})`);
  return response.json() as Promise<NavigatorState>;
}

export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}
