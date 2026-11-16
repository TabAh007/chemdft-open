import type { EvidenceCandidate } from "@chemdft/schemas";

export type CanonicalEvidenceRow = {
  key: string;
  label: string;
  candidates: EvidenceCandidate[];
  primary: EvidenceCandidate;
  figureNumber: string | null;
  modality: "structure" | "xrd" | "thermal" | "dls" | "spectrum" | "other";
};

function captionScore(candidate: EvidenceCandidate): number {
  if (candidate.evidence_type === "STRUCTURE_FIGURE_CANDIDATE") return 10_000;
  const caption = candidate.source_anchor?.caption?.trim() ?? "";
  const words = caption.split(/\s+/u).filter(Boolean).length;
  const fragmentPenalty = /^[,.;:)\]]/u.test(caption) || words <= 1 ? 100 : 0;
  return Math.min(caption.length, 300) + Math.min(words, 30) * 3 - fragmentPenalty;
}

function figureModality(candidates: EvidenceCandidate[]): CanonicalEvidenceRow["modality"] {
  const text = candidates.map((candidate) => [
    candidate.evidence_type,
    candidate.source_anchor?.caption,
    candidate.source_anchor?.snippet,
    candidate.structured_payload.caption,
  ].filter(Boolean).join(" ")).join(" ").toLocaleLowerCase();
  if (candidates.some((candidate) => candidate.evidence_type === "STRUCTURE_FIGURE_CANDIDATE")) return "structure";
  if (/\bxrd\b|x[-\s]?ray|diffract|дифракт|рентген|2\s*θ|2theta/u.test(text)) return "xrd";
  if (/thermal|tg\b|dtg|dta|термич|тг\b|дтг|дта/u.test(text)) return "thermal";
  if (/\bdls\b|dynamic light|particle.{0,14}size|дрс|гистограмм|частиц/u.test(text)) return "dls";
  if (/spectrum|spectra|спектр|raman|infrared|ftir/u.test(text)) return "spectrum";
  if (/structure|molecular|crystal|кристалл|структур|строени/u.test(text)) return "structure";
  return "other";
}

function modalityLabel(modality: CanonicalEvidenceRow["modality"]): string {
  return {
    structure: "structure evidence",
    xrd: "XRD",
    thermal: "thermal analysis",
    dls: "DLS distribution",
    spectrum: "spectrum",
    other: "figure evidence",
  }[modality];
}

/** Collapse repeated extractor records into one visible figure while retaining each source record. */
export function canonicalEvidenceRows(candidates: EvidenceCandidate[]): CanonicalEvidenceRow[] {
  const rows: CanonicalEvidenceRow[] = [];
  const figures = new Map<string, EvidenceCandidate[]>();
  for (const candidate of candidates) {
    const figureNumber = candidate.source_anchor?.figure_number?.trim();
    if (candidate.source_anchor?.source_type !== "FIGURE" || !figureNumber) {
      rows.push({
        key: `evidence:${candidate.id}`,
        label: candidate.evidence_type.replaceAll("_", " "),
        candidates: [candidate],
        primary: candidate,
        figureNumber: null,
        modality: "other",
      });
      continue;
    }
    const key = `figure:${figureNumber.toLocaleLowerCase()}`;
    const group = figures.get(key);
    if (group) group.push(candidate);
    else figures.set(key, [candidate]);
  }
  for (const [key, records] of figures) {
    const modality = figureModality(records);
    const primary = [...records].sort((a, b) => captionScore(b) - captionScore(a))[0]!;
    const figureNumber = primary.source_anchor?.figure_number?.trim() ?? "?";
    rows.push({
      key,
      label: `Figure ${figureNumber} · ${modalityLabel(modality)}`,
      candidates: records,
      primary,
      figureNumber,
      modality,
    });
  }
  return rows.sort((a, b) => {
    const aPage = a.primary.source_anchor?.page_number ?? Number.MAX_SAFE_INTEGER;
    const bPage = b.primary.source_anchor?.page_number ?? Number.MAX_SAFE_INTEGER;
    return aPage - bPage || a.key.localeCompare(b.key);
  });
}

export function figureCanBeDigitized(row: CanonicalEvidenceRow | null): boolean {
  return row !== null && ["xrd", "thermal", "dls", "spectrum"].includes(row.modality);
}

/** A full-page fallback is useful for navigation but must never be painted as a region box. */
export function hasPreciseSourceRegion(candidate: EvidenceCandidate): boolean {
  const anchor = candidate.source_anchor;
  if (!anchor || anchor.x == null || anchor.y == null || anchor.width == null || anchor.height == null) return false;
  if (![anchor.x, anchor.y, anchor.width, anchor.height].every(Number.isFinite)) return false;
  return anchor.width > 0 && anchor.height > 0 && !(anchor.x === 0 && anchor.y === 0 && anchor.width === 1 && anchor.height === 1);
}
