/** Display-only extraction. Original artifacts and their hashes are never changed. */
const NUMBER = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?";
const numeric = (text: string, pattern: RegExp): number | null => {
  const match = pattern.exec(text);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : null;
};

export type ScfLogEvidence = {
  excerpt: string;
  convergenceThreshold: number | null;
  nuclearRepulsion: number | null;
  electrons: number | null;
  basisFunctions: number | null;
  homo: number | null;
  lumo: number | null;
  convergedEnergy: number | null;
  convergenceRecords: number;
};

export function scientificLog(text: string): ScfLogEvidence {
  // PySCF prints __main__.__file__ between these markers. A tail can start
  // inside that source block: discard everything through its end marker too.
  const end = text.lastIndexOf("#INFO: ******************** input file end ********************");
  let body = end >= 0 ? text.slice(end).split("\n").slice(1).join("\n") : text;
  const start = body.indexOf("#INFO: **** input file is ");
  if (start >= 0) body = body.slice(0, start); // Incomplete echoed source: fail closed.
  const lines = body.split(/\r?\n/).map(line => line.trim());
  const patterns = [
    new RegExp(`^\\[INPUT\\] (?:num\\. atoms|num\\. electrons|charge|spin \\(= nelec alpha-beta = 2S\\)) = ${NUMBER}$`),
    /^\[INPUT\] Mole\.unit = (?:Angstrom|Bohr)$/,
    /^method = (?:RHF|UHF|RKS|UKS)$/,
    new RegExp(`^(?:nuclear repulsion|number of shells|number of NR [pc]GTOs|SCF conv_tol|SCF max_cycles|Set gradient conv threshold to|init E)\\s*(?:=\\s*)?${NUMBER}$`),
    new RegExp(`^HOMO = ${NUMBER}\\s+LUMO = ${NUMBER}(?:\\s+gap/eV = ${NUMBER})?$`),
    new RegExp(`^(?:cycle=\\s*\\d+|Extra cycle)\\s+E=\\s*${NUMBER}\\s+delta_E=\\s*${NUMBER}\\s+\\|g\\|=\\s*${NUMBER}\\s+\\|ddm\\|=\\s*${NUMBER}$`),
    new RegExp(`^(?:converged SCF energy|SCF not converged\\. E) = ${NUMBER}$`),
  ];
  // Allowlisted scientific lines only: no Python, paths, hostnames, environment,
  // terminal escapes or arbitrary diagnostics are rendered in the ordinary UI.
  const accepted = lines.filter(line => patterns.some(pattern => pattern.test(line)));
  const molecular = (line: string) => /^(?:\[INPUT\]|nuclear repulsion|number of)/.test(line);
  // SCF output first, followed by molecular metadata; order within each group
  // is retained. This is a presentation excerpt, never the original log.
  const excerpt = [...accepted.filter(line => !molecular(line)), ...accepted.filter(molecular)].join("\n");
  const convergences = [...excerpt.matchAll(new RegExp(`^converged SCF energy = (${NUMBER})$`, "gm"))];
  const frontier = [...excerpt.matchAll(new RegExp(`^HOMO = (${NUMBER})\\s+LUMO = (${NUMBER})(?:\\s+gap/eV = ${NUMBER})?$`, "gm"))].at(-1);
  const integer = (value: number | null) => value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    excerpt,
    convergenceThreshold: numeric(excerpt, new RegExp(`^SCF conv_tol = (${NUMBER})$`, "m")),
    nuclearRepulsion: numeric(excerpt, new RegExp(`^nuclear repulsion = (${NUMBER})$`, "m")),
    electrons: integer(numeric(excerpt, /^\[INPUT\] num\. electrons = (\d+)$/m)),
    basisFunctions: integer(numeric(excerpt, /^number of NR cGTOs = (\d+)$/m)),
    homo: frontier && Number.isFinite(Number(frontier[1])) ? Number(frontier[1]) : null,
    lumo: frontier && Number.isFinite(Number(frontier[2])) ? Number(frontier[2]) : null,
    convergedEnergy: convergences.length === 1 ? Number(convergences[0]![1]) : null,
    convergenceRecords: convergences.length,
  };
}
