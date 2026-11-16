/**
 * Display helpers for the sanitized native-log excerpt. Everything here works on the excerpt that `scientificLog`
 * allow-lists; none of it touches the original artifact, its bytes or its SHA-256. Sections are only offered when the
 * excerpt really contains the corresponding lines.
 */

export type LogSectionId = "initialization" | "iterations" | "convergence" | "input";

export type LogSection = { id: LogSectionId; label: string; line: number };

const SECTION_LABEL: Record<LogSectionId, string> = {
  initialization: "SCF initialization",
  iterations: "Iteration output",
  convergence: "Convergence & final energy",
  input: "Native input summary",
};

/** Which section a displayed line belongs to, from its own text only. */
export function lineSection(line: string): LogSectionId | null {
  if (/^(?:converged SCF energy|SCF not converged\. E) =/.test(line)) return "convergence";
  if (/^(?:cycle=|Extra cycle)/.test(line)) return "iterations";
  if (/^(?:method =|SCF conv_tol|SCF max_cycles|Set gradient conv threshold|init E)/.test(line)) return "initialization";
  if (/^(?:\[INPUT\]|nuclear repulsion|number of)/.test(line)) return "input";
  return null; // frontier-orbital lines inside the iterations keep the section of the lines around them
}

/** First line (0-based) of every section that is actually present, in the order the excerpt shows them. */
export function logSections(lines: readonly string[]): LogSection[] {
  const found = new Map<LogSectionId, number>();
  lines.forEach((line, index) => {
    const id = lineSection(line);
    if (id && !found.has(id)) found.set(id, index);
  });
  return [...found.entries()].map(([id, line]) => ({ id, label: SECTION_LABEL[id], line })).sort((a, b) => a.line - b.line);
}

export type LogMatch = { line: number; start: number; end: number };

/** Case-insensitive, literal (never a regular expression) matches within the displayed lines. */
export function findMatches(lines: readonly string[], query: string): LogMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: LogMatch[] = [];
  lines.forEach((line, index) => {
    const hay = line.toLowerCase();
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      matches.push({ line: index, start: at, end: at + needle.length });
      from = at + needle.length;
    }
  });
  return matches;
}

/** Split one line into plain and highlighted runs for rendering; `active` marks the current match. */
export function highlightRuns(line: string, matches: readonly LogMatch[], lineIndex: number, activeStart: number | null): Array<{ text: string; match: boolean; active: boolean }> {
  const mine = matches.filter((m) => m.line === lineIndex);
  if (mine.length === 0) return [{ text: line, match: false, active: false }];
  const runs: Array<{ text: string; match: boolean; active: boolean }> = [];
  let cursor = 0;
  for (const m of mine) {
    if (m.start > cursor) runs.push({ text: line.slice(cursor, m.start), match: false, active: false });
    runs.push({ text: line.slice(m.start, m.end), match: true, active: activeStart === m.start });
    cursor = m.end;
  }
  if (cursor < line.length) runs.push({ text: line.slice(cursor), match: false, active: false });
  return runs;
}
