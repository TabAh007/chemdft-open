import type { Locale } from "@chemdft/i18n";
import type { NavigatorReason } from "@chemdft/schemas";
import { HELP_MESSAGES } from "./help-messages";
import type { GoalId, StartingWorkflowId } from "./onboarding-flow";
import { safeRedirectPath } from "./auth/safe-redirect";

export type HelpTopicId = keyof typeof HELP_MESSAGES;
export type HelpTopic = {
  id: HelpTopicId;
  group: "structure" | "calculation" | "spectra" | "integrity";
  goal: GoalId | null;
  path: StartingWorkflowId;
};
export const HELP_TOPICS = [
  {
    id: "structure.charge",
    group: "structure",
    goal: "energy",
    path: "molecule",
  },
  {
    id: "structure.multiplicity",
    group: "structure",
    goal: "energy",
    path: "molecule",
  },
  {
    id: "calculation.method",
    group: "calculation",
    goal: "energy",
    path: "molecule",
  },
  {
    id: "calculation.basis",
    group: "calculation",
    goal: "energy",
    path: "molecule",
  },
  {
    id: "calculation.optimization",
    group: "calculation",
    goal: "optimize",
    path: "molecule",
  },
  {
    id: "calculation.frequency",
    group: "calculation",
    goal: "ir",
    path: "molecule",
  },
  {
    id: "spectra.ir",
    group: "spectra",
    goal: "ir",
    path: "experimental",
  },
  {
    id: "spectra.raman",
    group: "spectra",
    goal: "raman",
    path: "experimental",
  },
  {
    id: "spectra.uv_vis",
    group: "spectra",
    goal: "uv_vis",
    path: "experimental",
  },
  {
    id: "spectra.experimental",
    group: "spectra",
    goal: "compare",
    path: "experimental",
  },
  {
    id: "thermochemistry.frequency_requirement",
    group: "calculation",
    goal: "thermochemistry",
    path: "molecule",
  },
  {
    id: "electronic.homo_lumo",
    group: "calculation",
    goal: "orbitals",
    path: "molecule",
  },
  {
    id: "crystal.unit_cell",
    group: "structure",
    goal: "crystal",
    path: "molecule",
  },
  {
    id: "crystal.supercell",
    group: "structure",
    goal: "crystal",
    path: "molecule",
  },
  {
    id: "provenance.authority",
    group: "integrity",
    goal: null,
    path: "calculation",
  },
  {
    id: "firewall.ai_vs_calculation",
    group: "integrity",
    goal: null,
    path: "compare",
  },
] as const satisfies readonly HelpTopic[];
export function isHelpTopic(value: string): value is HelpTopicId {
  return Object.hasOwn(HELP_MESSAGES, value);
}
export function helpTopic(_locale: Locale, id: HelpTopicId) {
  return HELP_MESSAGES[id];
}
export function helpHref(
  locale: Locale,
  id: HelpTopicId,
  returnTo?: string,
): string {
  const safe = workspaceReturn(locale, returnTo);
  return `/${locale}/learn/${id}${safe ? `?${new URLSearchParams({ return_to: safe })}` : ""}`;
}
export function workspaceReturn(
  locale: Locale,
  value?: unknown,
): string | null {
  if (typeof value !== "string" || !value) return null;
  const safe = safeRedirectPath(value, locale);
  return safe.startsWith(`/${locale}/projects/`) ? safe : null;
}
export const REASON_HELP = {
  charge_required: "structure.charge",
  multiplicity_required: "structure.multiplicity",
  lattice_required: "crystal.unit_cell",
  crystal_required: "crystal.unit_cell",
  periodic_compute_unsupported: "crystal.unit_cell",
  optimization_required: "calculation.optimization",
  frequency_required: "calculation.frequency",
  imaginary_frequencies: "thermochemistry.frequency_requirement",
  stationarity_unproven: "thermochemistry.frequency_requirement",
  frequency_geometry_mismatch: "thermochemistry.frequency_requirement",
  matching_level_required: "thermochemistry.frequency_requirement",
  thermochemistry_required: "thermochemistry.frequency_requirement",
  closed_shell_required: "structure.multiplicity",
  orbitals_required: "electronic.homo_lumo",
  computed_spectrum_required: "spectra.experimental",
  experimental_spectrum_required: "spectra.experimental",
  spectrum_association_required: "spectra.experimental",
  experimental_peaks_required: "spectra.experimental",
  matching_spectrum_type_required: "spectra.experimental",
  provenance_required: "provenance.authority",
} as const satisfies Partial<Record<NavigatorReason["code"], HelpTopicId>>;
export function reasonHelp(code: NavigatorReason["code"]): HelpTopicId | null {
  return (
    (REASON_HELP as Partial<Record<NavigatorReason["code"], HelpTopicId>>)[
      code
    ] ?? null
  );
}
