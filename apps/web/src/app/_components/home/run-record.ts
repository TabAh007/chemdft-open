import record from "./reference/water-run-record.json";

/**
 * The real stored water calculation shown in Act II and Act V. Every value comes from `reference/water-run-record.json`,
 * exported once from a genuine ChemDFT run (`tools/homepage_reference_run_record.py`): nothing on the page is typed in.
 */
export const RUN = record;
export const RUN_IDENTITY = `Water · HF / ${record.method.basis} · ${record.engine.name} ${record.engine.version}`;

/** Hartree values keep the digits the product shows; nothing is rounded beyond that. */
export const fixed = (value: number, digits: number) => value.toFixed(digits);
export const shortHash = (hash: string) => `${hash.slice(0, 12)}…${hash.slice(-6)}`;
/** "2026-09-27 14:19:44.957548" → "2026-09-27 14:19:44 UTC" */
export const utc = (stamp: string) => `${stamp.slice(0, 19)} UTC`;
export const attemptSeconds = () => (Date.parse(`${record.attempt.finished_utc.replace(" ", "T")}Z`) - Date.parse(`${record.attempt.started_utc.replace(" ", "T")}Z`)) / 1000;

const SUPERSCRIPT: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
/** 1e-10 → "1×10⁻¹⁰" */
export const scientific = (value: number) => {
  const [mantissa, exponent] = value.toExponential(0).split("e");
  return `${mantissa}×10${[...String(Number(exponent))].map((c) => SUPERSCRIPT[c] ?? c).join("")}`;
};
