import type { CalculationResult } from "@chemdft/schemas";

/**
 * Researcher-facing scientific state of a published result.
 *
 * Three independent axes are kept apart and never merged into one badge:
 *   AUTHORITY      what role the result may play (authoritative / candidate / ...)
 *   VALIDATION     whether the platform's own validators accepted it
 *   VERIFICATION   whether it was reproduced by an independent method
 *
 * The backend's read-time `effective_state` is the only source for "currently authoritative".
 * Stored axes describe history; a retracted, superseded, disputed or invalidated lineage
 * downgrades effective authority, and a missing effective state fails closed.
 */

export type StateIntent = "success" | "primary" | "warning" | "danger" | "none";

export type StateAxis = { value: string; label: string; intent: StateIntent };

export type ScientificStateInput = {
  authority?: string | null | undefined;
  validation_state?: string | null | undefined;
  verification_state?: string | null | undefined;
  source_class?: string | null | undefined;
  /** Lets the strip offer exports for the calculation that produced this result. */
  calculation_id?: string | null | undefined;
  effective_state?: CalculationResult["effective_state"] | undefined;
};

export type ScientificStateView = {
  /** True only when the effective (read-time) state is authoritative, validated and ACTIVE. */
  currentlyAuthoritative: boolean;
  /** False when the server returned no effective state (older API); nothing is then asserted as current. */
  effectiveKnown: boolean;
  headline: string;
  authority: StateAxis;
  validation: StateAxis;
  verification: StateAxis;
  lineage: StateAxis;
  /** Plain-language limitation notes, in the order they should be read. */
  notes: string[];
  /** Present when stored (historical) axes differ from the effective ones. */
  stored: { authority: string; validation: string; verification: string } | null;
  inactiveResultIds: string[];
};

const AUTHORITY_LABEL: Record<string, string> = {
  AUTHORITATIVE: "Authoritative",
  CANDIDATE: "Candidate",
  VERIFICATION: "Verification run",
  IMPORTED: "Imported",
};

const VALIDATION_INTENT: Record<string, StateIntent> = {
  VALIDATED: "success",
  VALIDATED_IMPORT: "primary",
  SUPERSEDED: "warning",
  DISPUTED: "danger",
  REJECTED: "danger",
};

const LINEAGE_LABEL: Record<string, string> = {
  ACTIVE: "Source lineage active",
  RETRACTED: "Source lineage retracted",
  SUPERSEDED: "Source lineage superseded",
  DISPUTED: "Source lineage disputed",
  INVALIDATED: "Source lineage invalidated",
};

function title(value: string): string {
  const text = value.toLowerCase().replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function verificationAxis(value: string | null | undefined): StateAxis {
  const state = value ?? "UNVERIFIED";
  if (state === "UNVERIFIED") return { value: state, label: "Not independently verified", intent: "none" };
  if (state === "VERIFIED") return { value: state, label: "Independently verified", intent: "success" };
  return { value: state, label: title(state), intent: state === "DISPUTED" || state === "RETRACTED" ? "danger" : "warning" };
}

export function describeScientificState(input: ScientificStateInput): ScientificStateView {
  const effective = input.effective_state ?? null;
  const effectiveKnown = effective !== null;
  const authority = effective?.authority ?? input.authority ?? "CANDIDATE";
  const validation = effective?.validation_state ?? input.validation_state ?? "UNKNOWN";
  const verification = effective?.verification_state ?? input.verification_state ?? "UNVERIFIED";
  const lineage = effective?.source_lineage_validity ?? null;
  const active = effectiveKnown && lineage === "ACTIVE" && effective.eligible_for_derivation === true;
  // A retracted/superseded/disputed verification record also ends current standing (the backend derives
  // lineage from the same records, so this only restates it defensively).
  const verificationActive = !["RETRACTED", "SUPERSEDED", "DISPUTED"].includes(verification);
  const currentlyAuthoritative = active && verificationActive && authority === "AUTHORITATIVE" && validation === "VALIDATED";

  const notes: string[] = [];
  if (!effectiveKnown) {
    notes.push("Current effective state was not reported by the API; this result is not presented as currently authoritative.");
  } else if (!active) {
    notes.push(effective.reason ?? `Historical result; current source lineage is ${lineage ?? "unknown"}.`);
  } else if (!verificationActive) {
    notes.push(`Historical result; its verification record is ${verification}.`);
  }
  if (effectiveKnown && active && verificationActive && !currentlyAuthoritative) {
    notes.push(`Effective authority is ${authority} and validation is ${validation}; this result is not presented as authoritative.`);
  }
  if (verification === "UNVERIFIED") {
    notes.push("Validation means the platform's checks passed, not that another method reproduced the value.");
  }
  if (input.source_class === "IMPORTED" || authority === "IMPORTED") {
    notes.push("Imported from an external calculation; not produced or re-validated by a ChemDFT engine.");
  }

  const headline = currentlyAuthoritative
    ? "Authoritative engine result"
    : effectiveKnown && (!active || !verificationActive)
      ? `Historical result · ${(lineage ?? "inactive").toLowerCase()}`
      : authority === "IMPORTED"
        ? "Imported result"
        : "Engine result · not currently authoritative";

  const storedDiffers = effectiveKnown && (
    effective.stored_authority !== effective.authority ||
    effective.stored_validation_state !== effective.validation_state ||
    effective.stored_verification_state !== effective.verification_state
  );

  return {
    currentlyAuthoritative,
    effectiveKnown,
    headline,
    authority: {
      value: authority,
      label: AUTHORITY_LABEL[authority] ?? title(authority),
      intent: authority === "AUTHORITATIVE" && active ? "success" : "warning",
    },
    validation: { value: validation, label: title(validation), intent: VALIDATION_INTENT[validation] ?? "none" },
    verification: verificationAxis(verification),
    lineage: {
      value: lineage ?? "UNKNOWN",
      label: lineage ? (LINEAGE_LABEL[lineage] ?? title(lineage)) : "Lineage state unavailable",
      intent: lineage === "ACTIVE" ? "success" : lineage ? "danger" : "warning",
    },
    notes,
    stored: storedDiffers
      ? { authority: effective.stored_authority, validation: effective.stored_validation_state, verification: effective.stored_verification_state }
      : null,
    inactiveResultIds: effective ? [...(effective.inactive_result_ids ?? [])].map(String) : [],
  };
}

/** One-line axes summary built only from the effective (or, if absent, stored) axes. */
export function axesSummary(view: ScientificStateView): string {
  return `Authority: ${view.authority.value} · Validation: ${view.validation.value} · Independent verification: ${view.verification.value}`;
}
