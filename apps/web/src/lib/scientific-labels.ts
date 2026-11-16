/**
 * Researcher-facing labels for stored codes. Display only: the raw identifier stays available
 * (approval audit, exports, tooltips) and is never replaced in requests or records.
 */

const ENGINE: Record<string, string> = { pyscf: "PySCF", xtb: "xTB", crest: "CREST", psi4: "Psi4" };
// Mirrors the server's SCIENTIFIC_METHOD_CATALOG / SCIENTIFIC_BASIS_CATALOG display names.
const METHOD: Record<string, string> = { hf: "Hartree–Fock (HF)", b3lyp: "B3LYP", pbe: "PBE", gfn2: "GFN2-xTB", mp2: "MP2" };
const BASIS: Record<string, string> = { "sto-3g": "STO-3G", "6-31g": "6-31G", "def2-svp": "def2-SVP", "def2-svpd": "def2-SVPD" };
const TASK: Record<string, string> = {
  ENERGY: "Single-point energy", GEOMETRY_OPTIMIZATION: "Geometry optimization", FREQUENCY: "Harmonic frequencies",
  ORBITAL: "Molecular orbitals", TDDFT: "TD-DFT excited states", THERMOCHEMISTRY: "Thermochemistry", CONFORMER_SEARCH: "Conformer search",
};
const SPIN: Record<number, string> = { 1: "singlet", 2: "doublet", 3: "triplet", 4: "quartet", 5: "quintet" };
const PROVIDER: Record<string, string> = {
  nvidia: "NVIDIA", fake: "Local test fixture", openai: "OpenAI", openrouter: "OpenRouter", huggingface: "Hugging Face", moonshot: "Moonshot",
};
const RUN_STATUS: Record<string, string> = {
  CREATED: "Starting", PLANNING: "Planning", EXECUTING: "Working", WAITING_FOR_APPROVAL: "Awaiting your approval",
  WAITING_FOR_CALCULATION: "Waiting for calculation", PAUSED: "Paused", SUCCEEDED: "Completed", FAILED: "Failed", CANCELED: "Canceled",
};
export const runStatusLabel = (code: string | null | undefined) => (code ? RUN_STATUS[code] ?? sentence(code) : "—");
const AI_MODE: Record<string, string> = { MANAGED: "Managed by ChemDFT", BYOK: "Your API key", NONE: "AI turned off" };
const MODEL_STATUS: Record<string, string> = {
  "LIVE-VERIFIED": "Verified (limited scope)", CONFIGURED: "Configured, not verified", DOCUMENTED: "Documented only",
  UNAVAILABLE: "Unavailable", UNSUPPORTED: "Not supported",
};
const AI_ERROR: Record<string, string> = {
  AI_DISABLED: "AI is turned off in your settings",
  AI_UNAVAILABLE: "AI is unavailable",
  PROVIDER_UNAVAILABLE: "The selected provider is not configured on this server",
  MODEL_UNAVAILABLE: "The selected model is not available on this server",
  MANAGED_AI_UNAVAILABLE: "Managed AI is not enabled for this account",
  MANAGED_PROVIDER_UNAVAILABLE: "The managed AI provider is not connected",
  ALLOWANCE_EXCEEDED: "The AI allowance for this period is used up",
  BYOK_DISABLED: "Your-own-key mode is not enabled",
  BYOK_KEY_MISSING: "No API key is saved for the selected provider",
  BYOK_KEY_REVOKED: "The saved API key was revoked",
  SECRET_PROVIDER_UNAVAILABLE: "Secure key storage is unavailable",
  BYOK_KEY_INVALID: "The saved API key was rejected by the provider",
  PROVIDER_TIMEOUT: "The AI provider did not answer in time",
  PROVIDER_CONNECTION_TIMEOUT: "The connection to the AI provider timed out",
  PROVIDER_READ_TIMEOUT: "The AI provider took too long to send its answer",
  PROVIDER_WRITE_TIMEOUT: "The request to the AI provider timed out while it was being sent",
  PROVIDER_RATE_LIMIT: "The AI provider is limiting requests right now",
  PROVIDER_AUTHENTICATION_FAILED: "The AI provider did not accept the server's sign-in",
  PROVIDER_NETWORK_ERROR: "The AI provider could not be reached",
  PROVIDER_OUTPUT_BUDGET_INSUFFICIENT: "The answer needed more room than the response limit allows",
  PROVIDER_INPUT_BUDGET_INSUFFICIENT: "The request was larger than the provider's input limit",
  PROVIDER_PROTOCOL_ERROR: "The AI provider returned a response that ChemDFT could not use",
};
/** Stored authority / review / lifecycle tokens that appear inside record details. */
const TOKEN: Record<string, string> = {
  USER_SUPPLIED: "supplied by researcher", AUTHORITATIVE: "authoritative", CANDIDATE: "candidate", IMPORTED: "imported",
  CALCULATED: "calculated", EXTRACTED: "extracted from document", NOT_REVIEWED: "not reviewed", "NOT REVIEWED": "not reviewed",
  UNVERIFIED: "not independently verified", VERIFIED: "independently verified", DISPUTED: "disputed", SUPERSEDED: "superseded",
  RETRACTED: "retracted", SUCCEEDED: "succeeded", FAILED: "failed", CANCELED: "canceled", QUEUED: "queued", RUNNING: "running",
  PENDING: "pending", APPROVED: "approved", REJECTED: "rejected", EXPIRED: "expired", VALIDATED: "validated", COMMITTED: "committed",
  AVAILABLE: "available", UNAVAILABLE: "unavailable", MISCONFIGURED: "misconfigured",
};

function sentence(value: string): string {
  const text = value.toLowerCase().replaceAll("_", " ").replaceAll(".", " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const engineLabel = (id: string | null | undefined) => (id ? ENGINE[id.toLowerCase()] ?? id : "—");
export const methodLabel = (id: string | null | undefined) => (id ? METHOD[id.toLowerCase()] ?? id : "—");
export const basisLabel = (id: string | null | undefined) => (id ? BASIS[id.toLowerCase()] ?? id : "—");
export const taskLabel = (code: string | null | undefined) => (code ? TASK[code] ?? sentence(code) : "—");
export const providerLabel = (id: string | null | undefined) => (id ? PROVIDER[id.toLowerCase()] ?? id : "—");
export const aiModeLabel = (code: string | null | undefined) => (code ? AI_MODE[code] ?? sentence(code) : "—");
export const modelStatusLabel = (code: string | null | undefined) => (code ? MODEL_STATUS[code] ?? sentence(code) : "—");
/** Registry display name without a trailing "(Provider)" when the provider is shown beside it. */
export function modelDisplayName(name: string | null | undefined, provider: string | null | undefined): string {
  if (!name) return "—";
  const suffix = ` (${providerLabel(provider)})`;
  return provider && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}
export const aiErrorLabel = (code: string | null | undefined) => (code ? AI_ERROR[code] ?? sentence(code) : AI_ERROR.AI_UNAVAILABLE!);

export function multiplicityLabel(value: number | string | null | undefined): string {
  const number = typeof value === "string" ? Number(value) : value;
  if (number == null || !Number.isInteger(number)) return "—";
  const name = SPIN[number];
  return name ? `${number} (${name})` : String(number);
}

/** Replace stored tokens inside a record detail line, e.g. "Authority: USER_SUPPLIED · Verification: NOT REVIEWED". */
export function humanizeDetail(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\b[a-z]+(?:\.[a-z_]+)+\b/g, (token) => sentence(token))
    .replace(/NOT REVIEWED|\b[A-Z][A-Z_]{2,}\b/g, (token) => TOKEN[token] ?? token);
}

/** Time left before an approval expires, for a countdown that never goes negative. */
export function expiryCountdown(expiresAt: number, now: number): { expired: boolean; label: string; urgent: boolean } {
  const seconds = Math.floor((expiresAt - now) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return { expired: true, label: "Expired", urgent: true };
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const label = hours > 0 ? `${hours} h ${minutes} min left` : minutes > 0 ? `${minutes} min ${rest.toString().padStart(2, "0")} s left` : `${rest} s left`;
  return { expired: false, label, urgent: seconds < 300 };
}

// --- AI-6: what the researcher asked for against what was proposed -----------------------------

const PARAMETER: Record<string, string> = {
  task: "Calculation type", engine: "Engine", method: "Method", basis: "Basis set", charge: "Charge",
  multiplicity: "Spin multiplicity", dispersion: "Dispersion correction", solvation: "Solvation", constraints: "Constraints",
};
const FIELD: Record<string, string> = {
  "specification.task_type": PARAMETER.task!,
  "specification.engine_preference.engine": PARAMETER.engine!,
  "specification.engine_preference": PARAMETER.engine!,
  "specification.method.identifier": PARAMETER.method!,
  "specification.method": PARAMETER.method!,
  "specification.basis.identifier": PARAMETER.basis!,
  "specification.basis": PARAMETER.basis!,
  "specification.charge": PARAMETER.charge!,
  "specification.multiplicity": PARAMETER.multiplicity!,
  "specification.dispersion": PARAMETER.dispersion!,
  "specification.solvation": PARAMETER.solvation!,
  "specification.constraints": PARAMETER.constraints!,
  "structure_version.entity_id": "Structure version",
  "structure_version": "Structure version",
};
export const parameterLabel = (parameter: string | null | undefined) => (parameter ? PARAMETER[parameter] ?? sentence(parameter) : "—");
/** Label for a proposal field path the server named in a refusal ("specification.basis.identifier" → "Basis set"). */
export function fieldLabel(path: string | null | undefined): string {
  if (!path) return "Proposal";
  return FIELD[path] ?? sentence(path.split(".").at(-1) ?? path);
}
/** A requested or proposed value in the researcher's vocabulary. Unknown values stay as written. */
export function matchValueLabel(parameter: string, value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "not set";
  if (typeof value === "boolean") return value ? "present" : "none";
  switch (parameter) {
    case "engine": return engineLabel(String(value));
    case "method": return methodLabel(String(value));
    case "basis": return basisLabel(String(value));
    case "task": return taskLabel(String(value));
    case "multiplicity": return multiplicityLabel(value);
    case "dispersion": case "solvation": case "constraints": return "requested";
    default: return String(value);
  }
}
export const MATCH_OUTCOME: Record<string, string> = {
  MATCH: "Matches", MISMATCH: "Differs", NOT_SPECIFIED: "Not specified", AMBIGUOUS: "Several named",
};
/** One line for the approval header: how the proposal compares with what the researcher named. */
export function requestCheckSummary(items: ReadonlyArray<{ outcome: string }>): { text: string; tone: "ok" | "danger" | "muted" } {
  if (!items.length) return { text: "Not recorded; compare the proposal with your request yourself", tone: "muted" };
  const count = (outcome: string) => items.filter((item) => item.outcome === outcome).length;
  const match = count("MATCH"), differ = count("MISMATCH"), chosen = count("NOT_SPECIFIED"), several = count("AMBIGUOUS");
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (differ) return { text: `${plural(differ, "named parameter differs", "named parameters differ")} from your request. Approval is blocked`, tone: "danger" };
  const notes = [
    chosen ? `${chosen} chosen by the model` : null,
    several ? `${several} not checked (several named)` : null,
  ].filter((note): note is string => note !== null);
  const lead = match ? `${plural(match, "named parameter matches", "named parameters match")} your request` : "Your message named no parameter to check";
  return { text: [lead, ...notes].join(" · "), tone: "ok" };
}
const ELIGIBILITY: Record<string, string> = { STANDARD: "Standard selection", DEVELOPMENT: "Development use only" };
export const eligibilityLabel = (code: string | null | undefined) => (code ? ELIGIBILITY[code] ?? sentence(code) : null);

interface SamplingLike {
  source: string; temperature: number; top_p?: number | null; chat_template_kwargs?: Record<string, boolean> | null;
}
/** The sampling a model call actually used, recorded by the server. */
export function samplingLabel(sampling: SamplingLike | null | undefined): string {
  if (!sampling) return "Not recorded";
  const parts = [`temperature ${sampling.temperature}`];
  if (sampling.top_p != null) parts.push(`top-p ${sampling.top_p}`);
  const thinking = sampling.chat_template_kwargs;
  if (thinking && Object.keys(thinking).length) {
    parts.push(`reasoning ${Object.entries(thinking).map(([key, on]) => `${key.replaceAll("_", " ")} ${on ? "on" : "off"}`).join(", ")}`);
  }
  return `${sampling.source === "MODEL_CARD_PROFILE" ? "Model-card profile" : "Server default"}: ${parts.join(" · ")}`;
}
