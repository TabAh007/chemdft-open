/**
 * Release 0.0.25: ONE display formatter for stored quantities. Display only: the stored value, its full
 * precision and the raw unit string stay untouched in the record and in every data export.
 */
const SUPERSCRIPT: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

/** "cm^-1" → "cm⁻¹", "A^2" → "A²", "1" (dimensionless) → "". Anything else is returned unchanged. */
export function displayUnit(unit: string): string {
  if (unit === "1") return "";
  if (["E_h", "HARTREE", "hartree", "Hartree"].includes(unit)) return "Eh";
  if (unit === "cm-1" || unit === "1/cm") return "cm⁻¹";
  return unit.replace(/\^(-?\d+)/g, (_match, exponent: string) => [...exponent].map((ch) => SUPERSCRIPT[ch] ?? ch).join(""));
}

const WAVENUMBER = new Set(["cm^-1", "cm-1", "cm⁻¹", "1/cm"]);
export const isWavenumberUnit = (unit: string): boolean => WAVENUMBER.has(unit);

/** Frequencies and wavenumbers: one decimal, matching the mode tables. Other units keep ten significant digits. */
export function formatDisplayValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return "—";
  if (isWavenumberUnit(unit)) return value.toFixed(1);
  if (["Eh", "HARTREE", "hartree"].includes(unit)) return value.toFixed(10);
  return value.toPrecision(10).replace(/\.?0+$/, "");
}

/* ---------------------------------------------------------------------------------------------------------------
 * Precision policy for screens (release 0.0.25 follow-up). DISPLAY ONLY: the stored value keeps full precision and
 * is shown in a tooltip ("full value"), copied by copy actions and written to exports. Documented as a table in
 * docs/implementation/RELEASE_0_0_25.md.
 *   energies (Eh)              6 decimals          relative energies (kcal/mol)   2 decimals
 *   frequencies (cm⁻¹)         1 decimal           coordinates (Å)                4 decimals
 *   gradients (Eh/bohr)        scientific, 3 s.f.  unit spelling                  "Eh", "kcal/mol", "cm⁻¹", "Å"
 * ------------------------------------------------------------------------------------------------------------- */
export const formatEnergyEh = (value: number): string => (Number.isFinite(value) ? value.toFixed(6) : "—");
export const formatRelativeKcal = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : "—");
export const formatFrequencyCm1 = (value: number): string => (Number.isFinite(value) ? value.toFixed(1) : "—");
export const formatCoordinateAngstrom = (value: number): string => (Number.isFinite(value) ? value.toFixed(4) : "—");
export const formatGradient = (value: number): string => (Number.isFinite(value) ? value.toExponential(2) : "—");
/** The full-precision text for a tooltip. */
export const fullValueTitle = (value: number | string): string => `Full value: ${String(value)}`;

/** Local, human-readable time of an ISO timestamp; the UTC value belongs in a tooltip. */
export function formatLocalTime(iso: string): { text: string; utc: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { text: iso, utc: iso };
  return { text: date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }), utc: date.toISOString() };
}

/** Energy unit spelling: one rendering everywhere ("Eh"), whatever the stored code is. */
export function energyUnitLabel(code: string): string {
  return ["Eh", "E_h", "HARTREE", "hartree", "Hartree", "Ha"].includes(code) ? "Eh" : displayUnit(code);
}
