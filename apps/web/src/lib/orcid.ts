/** ORCID iD client helpers (ADR-044). The iD shown anywhere is one the API authenticated through ORCID; this module never builds one. */

export type OrcidStatus = {
  enabled: boolean;
  environment: "sandbox" | "production" | string;
  linked: boolean;
  orcid_id: string | null;
  record_url: string | null;
  verified_at: string | null;
  display_name: string | null;
};

/** The state the API issues starts with "l." (link) or "s." (sign-in), so the callback page knows the flow without browser storage. */
export const orcidFlowOf = (state: string | null): "link" | "signin" | null => (state?.startsWith("l.") ? "link" : state?.startsWith("s.") ? "signin" : null);

const ORCID_ID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
export const isOrcidId = (value: string): boolean => ORCID_ID.test(value);

export function orcidBase(environment: string): string {
  return environment === "production" ? "https://orcid.org" : "https://sandbox.orcid.org";
}

/** The full iD URL ORCID's display guidelines ask for, for the environment the iD was authenticated in. */
export function orcidIdUrl(orcidId: string, environment: string): string {
  return `${orcidBase(environment)}/${orcidId}`;
}

export class OrcidApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "OrcidApiError";
  }
}

/** A sentence for the person; the raw code stays available as `OrcidApiError.code`. */
export function plainOrcidError(code: string): string {
  switch (code) {
    case "orcid_id_unavailable":
      return "That ORCID iD cannot be linked to this account. If you think it should be, contact the ChemDFT owner.";
    case "already_linked":
      return "This account already has an ORCID iD. Unlink it first to link a different one.";
    case "not_linked":
      return "No ChemDFT account is linked to that ORCID iD. Sign in with your email and password, then link your iD in Settings.";
    case "rate_limited":
    case "busy":
      return "Too many attempts. Wait a few minutes and try again.";
    case "state_invalid":
      return "This ORCID sign-in link has expired or was already used. Start again.";
    case "orcid_unavailable":
    case "unavailable":
      return "ORCID could not be reached. Try again in a moment.";
    case "access_denied":
      return "You did not allow ChemDFT to confirm your ORCID iD, so nothing was linked.";
    default:
      return "ORCID could not confirm your iD. Nothing was changed.";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/chemdft${path}`, { cache: "no-store", ...init, headers: { "content-type": "application/json" } });
  if (!response.ok) {
    const detail = ((await response.json().catch(() => ({}))) as { detail?: unknown }).detail;
    throw new OrcidApiError(response.status, typeof detail === "string" ? detail : "orcid_failed");
  }
  return (await response.json()) as T;
}

export const getOrcidStatus = () => call<OrcidStatus>("/v1/orcid");
export const startOrcidLink = (keepName: boolean) =>
  call<{ authorize_url: string }>("/v1/orcid/link/start", { method: "POST", body: JSON.stringify({ keep_name: keepName }) });
export const completeOrcidLink = (code: string, state: string) =>
  call<OrcidStatus>("/v1/orcid/link/complete", { method: "POST", body: JSON.stringify({ code, state }) });
export const unlinkOrcid = () => call<OrcidStatus>("/v1/orcid/unlink", { method: "POST", body: "{}" });
