/**
 * Release 0.0.25 follow-up: plain wording for the reasons an engine cannot be chosen. The raw server wording is
 * never discarded: it is shown under "Technical details". Only reasons whose cause is stated by the text itself
 * are rewritten; any other reason is shown as the server wrote it.
 */
const PLAIN: ReadonlyArray<[RegExp, string]> = [
  [/^No accepted native Psi4 CLI is configured\.?$/i, "Psi4 is not set up on this server, so Psi4 calculations cannot be run here."],
  [/^Accepted CREST executable did not identify itself\.?$/i, "The conformer-search program on this server could not be identified, so it is not used."],
  [/^Accepted CREST executable cannot run on this host\.?$/i, "The conformer-search program cannot run on this server."],
];

export function plainEngineReason(raw: string | null | undefined): { plain: string; technical: string | null } {
  const text = (raw ?? "").trim();
  if (!text) return { plain: "", technical: null };
  for (const [pattern, plain] of PLAIN) if (pattern.test(text)) return { plain, technical: text };
  return { plain: text, technical: null };
}
