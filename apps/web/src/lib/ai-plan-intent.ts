/**
 * Release 0.0.24: one AI box. A message that looks like a calculation request makes the composer offer
 * "Plan this as a calculation"; nothing is planned, proposed or started unless the researcher chooses it,
 * and a proposal always needs explicit approval. Deterministic, no model call.
 */
const QUESTION_START = /^\s*(how|what|where|why|which|who|when|is|are|does|do|did|can i|could i|should i|explain|tell me)\b/i;

const PLAN_PATTERNS: readonly RegExp[] = [
  /\boptimi[sz](e|ation|ing)\b|\bgeometry optimi/i,
  /\bsingle[- ]point\b/i,
  /\b(calculate|compute|simulate)\b.{0,60}\b(energy|energies|spectrum|spectra|orbitals?|homo|lumo|gap|frequenc\w*|thermo\w*|dipole|charges)\b/i,
  /\b(ir|infrared|raman|uv[- ]?vis|tddft|nmr)\b.{0,40}\b(spectr\w*|calculation|simulat\w*|compute)\b/i,
  /\b(thermochemistry|gibbs|enthalpy|zpve|free energy)\b/i,
  /\b(plan|propose|set up|setup|start|run|submit|launch)\b.{0,30}\b(calculation|job|simulation|dft|xtb|pyscf|crest)\b/i,
  /\b(orbitals?|homo[- ]lumo)\b.{0,30}\b(calculation|compute|calculate)\b/i,
];

export function looksLikePlanningRequest(message: string): boolean {
  const text = message.trim();
  if (text.length < 4) return false;
  if (QUESTION_START.test(text)) return false;
  return PLAN_PATTERNS.some((pattern) => pattern.test(text));
}
