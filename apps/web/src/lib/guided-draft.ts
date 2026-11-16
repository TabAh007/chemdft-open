/**
 * The Guided calculation draft: everything the researcher has chosen but not yet submitted, kept per
 * (project, structure version, task) so moving between stages, between Guided and Advanced, or reloading
 * the page never loses it. Browser storage is a convenience only: every access is guarded, and a missing
 * or malformed value simply means "start from defaults". A restored draft is never treated as submitted
 * or as confirmed scientific input unless `inputsConfirmed` was explicitly set by the researcher.
 */

/** Task-specific choices (engine, method, basis, numerical controls). */
export type GuidedDraft = {
  engine: "pyscf" | "xtb" | "psi4";
  method: string;
  basis: string;
  convergence: string;
  maxSteps: number;
  nstates: number;
};

/**
 * The electronic-state inputs belong to the structure version, not to one task, so they are kept (and
 * confirmed) once per version. `confirmed` is true only after the researcher explicitly confirmed these
 * exact values; changing either value clears it.
 */
export type GuidedInputs = { charge: number | null; multiplicity: number; confirmed: boolean };

/**
 * Parse the charge text input from the researcher.
 * Empty string or whitespace-only is treated as not entered (`null`), never silently `0`.
 * Non-numeric strings return `null`.
 */
export function parseChargeInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function draftKey(projectId: string, versionId: string, task: string): string {
  return `chemdft:guided-draft:${projectId}:${versionId}:${task}`;
}

export function inputsKey(projectId: string, versionId: string): string {
  return `chemdft:guided-inputs:${projectId}:${versionId}`;
}

function isDraft(value: unknown): value is GuidedDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return ["pyscf", "xtb", "psi4"].includes(String(draft.engine))
    && typeof draft.method === "string" && typeof draft.basis === "string"
    && typeof draft.convergence === "string" && Number.isInteger(draft.maxSteps) && Number.isInteger(draft.nstates);
}

function isInputs(value: unknown): value is GuidedInputs {
  if (!value || typeof value !== "object") return false;
  const inputs = value as Record<string, unknown>;
  const validCharge = inputs.charge === null || Number.isInteger(inputs.charge);
  const validMultiplicity = Number.isInteger(inputs.multiplicity) && (inputs.multiplicity as number) >= 1;
  const validConfirmed = typeof inputs.confirmed === "boolean";
  if (inputs.charge === null && inputs.confirmed === true) return false;
  return validCharge && validMultiplicity && validConfirmed;
}

export function loadInputs(key: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): GuidedInputs | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isInputs(parsed) ? parsed : null;
  } catch { return null; }
}

export function saveInputs(key: string, inputs: GuidedInputs, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try { storage?.setItem(key, JSON.stringify(inputs)); } catch { /* optional */ }
}

export function loadDraft(key: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): GuidedDraft | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch { return null; }
}

export function saveDraft(key: string, draft: GuidedDraft, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try { storage?.setItem(key, JSON.stringify(draft)); } catch { /* optional */ }
}

export function clearDraft(key: string, storage: Pick<Storage, "removeItem"> | null = safeStorage()): void {
  try { storage?.removeItem(key); } catch { /* optional */ }
}

function safeStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

/** The submitted calculation for a (project, structure version), so a reload restores its recorded state. */
export function submissionKey(projectId: string, versionId: string): string {
  return `chemdft:guided-submission:${projectId}:${versionId}`;
}

export function rememberSubmission(projectId: string, versionId: string, calculationId: string): void {
  try { safeStorage()?.setItem(submissionKey(projectId, versionId), calculationId); } catch { /* optional */ }
}

export function recallSubmission(projectId: string, versionId: string): string | null {
  try { return safeStorage()?.getItem(submissionKey(projectId, versionId)) ?? null; } catch { return null; }
}

export function forgetSubmission(projectId: string, versionId: string): void {
  try { safeStorage()?.removeItem(submissionKey(projectId, versionId)); } catch { /* optional */ }
}

/**
 * A submission that was sent but not yet acknowledged. Kept with its idempotency key so that a reload and a
 * second click on the same configuration re-send the same key and the server de-duplicates the request.
 */
export function pendingKey(projectId: string, versionId: string): string {
  return `chemdft:guided-pending:${projectId}:${versionId}`;
}

export function savePending(projectId: string, versionId: string, entry: { signature: string; payload: unknown }): void {
  try { safeStorage()?.setItem(pendingKey(projectId, versionId), JSON.stringify(entry)); } catch { /* optional */ }
}

export function loadPending(projectId: string, versionId: string): { signature: string; payload: unknown } | null {
  try {
    const raw = safeStorage()?.getItem(pendingKey(projectId, versionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { signature?: unknown; payload?: unknown };
    return typeof parsed.signature === "string" && parsed.payload ? { signature: parsed.signature, payload: parsed.payload } : null;
  } catch { return null; }
}

export function clearPending(projectId: string, versionId: string): void {
  try { safeStorage()?.removeItem(pendingKey(projectId, versionId)); } catch { /* optional */ }
}
