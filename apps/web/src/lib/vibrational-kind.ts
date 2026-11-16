import type { VibrationalAnalysis } from "@chemdft/schemas";

export type VibrationalKind = "ir" | "raman";

/** Raman results also carry IR intensities, so Raman takes precedence in labels. */
export function vibrationalKind(analysis: Pick<VibrationalAnalysis, "modes"> & Partial<Pick<VibrationalAnalysis, "raman_method">>): VibrationalKind {
  const hasRaman = Boolean(
    analysis.raman_method || analysis.modes?.some((mode) => mode.raman_activity !== undefined && mode.raman_activity !== null),
  );
  return hasRaman ? "raman" : "ir";
}

export function vibrationalSpectrumLabel(analysis: Pick<VibrationalAnalysis, "modes"> & Partial<Pick<VibrationalAnalysis, "raman_method">>): string {
  const name = vibrationalKind(analysis) === "raman" ? "Raman spectrum" : "IR spectrum";
  return `${name} · ${analysis.modes?.length ?? 0} modes`;
}
