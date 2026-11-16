import { describe, expect, it } from "vitest";
import type { EvidenceCandidate } from "@chemdft/schemas";
import { canonicalEvidenceRows, figureCanBeDigitized, hasPreciseSourceRegion } from "../src/lib/evidence-review";

function figure(id: string, figureNumber: string, caption: string, evidenceType = "FIGURE") {
  return {
    id,
    evidence_type: evidenceType,
    source_class: "EXTRACTED",
    structured_payload: { caption },
    source_anchor: {
      document_id: "document-1",
      page_number: 6,
      source_type: "FIGURE",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      figure_number: figureNumber,
      caption,
      snippet: caption,
    },
    extraction_method: "caption-detector",
    extractor_version: "pypdf-test",
    review_state: "DETECTED",
  } as unknown as EvidenceCandidate;
}

describe("canonical document evidence", () => {
  it("groups repeated extractor records under one figure and retains their provenance records", () => {
    const full = figure("finding-full", "3", "X-Ray diffraction pattern of the chromium compound");
    const fragment = figure("finding-fragment", "3", ", which shows a maximum at");
    const rows = canonicalEvidenceRows([fragment, full]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("Figure 3 · XRD");
    expect(rows[0]?.primary.id).toBe("finding-full");
    expect(rows[0]?.candidates.map((item) => item.id)).toEqual(["finding-fragment", "finding-full"]);
  });

  it("keeps hypothetical structure figures out of the numeric digitizer", () => {
    const row = canonicalEvidenceRows([
      figure("structure", "2", "Hypothetical chromium crystal structure", "STRUCTURE_FIGURE_CANDIDATE"),
    ])[0]!;
    expect(row.modality).toBe("structure");
    expect(figureCanBeDigitized(row)).toBe(false);
  });

  it("does not treat a page-level fallback as a region box", () => {
    const row = canonicalEvidenceRows([
      figure("page-only", "4", "DLS particle-size distribution"),
    ])[0]!;
    expect(figureCanBeDigitized(row)).toBe(true);
    expect(hasPreciseSourceRegion(row.primary)).toBe(false);
    const precise = {
      ...row.primary,
      source_anchor: { ...row.primary.source_anchor!, x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    };
    expect(hasPreciseSourceRegion(precise)).toBe(true);
  });
});
