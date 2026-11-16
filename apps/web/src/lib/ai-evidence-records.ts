import type { AICitation, AIEvidenceView, AIMessageView } from "@chemdft/schemas";
import type { WorkspaceSelection } from "./workspace-selection";
import { humanizeDetail } from "./scientific-labels";

/**
 * Evidence tab records. Each label states the provenance the backend actually recorded; nothing
 * is promoted to "Verified" unless a source record says VERIFIED. Records from different answers
 * stay distinct even when they reuse a citation id such as E1.
 */
export type EvidenceKind = "Document" | "File" | "Structure" | "Calculation" | "Dataset" | "Project record";
export type EvidenceFilter = "All" | "Cited in chat" | "Documents" | "Structures" | "Calculations" | "Other";
export type EvidenceState =
  | "Verified" | "Not independently verified" | "Disputed" | "Superseded" | "Retracted"
  | "Source unavailable" | "Cited by AI answer" | "Candidate · unreviewed" | "Committed version" | "Not assessed";

export interface EvidenceRecord {
  key: string;
  citationId: string | null;
  title: string;
  source: string;
  locator: string;
  kind: EvidenceKind;
  state: EvidenceState;
  origin: "CITATION" | "PASSAGE" | "PROJECT_CATALOG";
  excerpt: string | null;
  citation: AICitation | null;
  selection: WorkspaceSelection | null;
  documentId: string | null;
  pageNumber: number | null;
  messageId: string | null;
}

const KIND_BY_CITATION: Record<string, EvidenceKind> = {
  DOCUMENT: "Document", STRUCTURE: "Structure", CALCULATION: "Calculation", DATASET: "Dataset", PROJECT_RECORD: "Project record",
};

export function passageState(passage: Pick<AIEvidenceView, "verification_state" | "available">): EvidenceState {
  if (passage.available === false) return "Source unavailable";
  switch (passage.verification_state) {
    case "VERIFIED": return "Verified";
    case "DISPUTED": return "Disputed";
    case "SUPERSEDED": return "Superseded";
    case "RETRACTED": return "Retracted";
    default: return "Not independently verified";
  }
}

export function stateTone(state: EvidenceState): "verified" | "warning" | "danger" | "neutral" {
  if (state === "Verified") return "verified";
  if (state === "Disputed" || state === "Retracted" || state === "Source unavailable") return "danger";
  if (state === "Superseded" || state === "Candidate · unreviewed" || state === "Not independently verified") return "warning";
  return "neutral";
}

function locatorText(page: number | null | undefined, anchor: string | null | undefined, entityId: string | null | undefined): string {
  if (page != null) return anchor ? `Page ${page} · anchor ${anchor}` : `Page ${page}`;
  if (anchor) return `Anchor ${anchor}`;
  return entityId ? `Record ${entityId.slice(0, 8)}…` : "No locator recorded";
}

export function buildEvidenceRecords(
  messages: AIMessageView[],
  catalog: Array<{ label: string; detail?: string | null; selection: WorkspaceSelection }> = [],
): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  const cited = new Set<string>();
  for (const message of messages) {
    const passages = new Map((message.evidence ?? []).map((passage) => [passage.citation_id, passage]));
    const seen = new Set<string>();
    for (const citation of message.citations ?? []) {
      const citationKey = citation.citation_id ?? `${citation.citation_type}:${citation.entity_id}:${citation.page_number ?? ""}`;
      if (seen.has(citationKey)) continue;
      seen.add(citationKey);
      cited.add(citation.entity_id);
      const passage = citation.citation_id ? passages.get(citation.citation_id) : undefined;
      if (passage) passages.delete(citation.citation_id ?? "");
      records.push({
        key: `${message.id}:${citationKey}`,
        citationId: citation.citation_id ?? null,
        title: passage?.source_title || citation.label,
        source: passage?.section_path || (citation.source_record_type ? `Project ${citation.source_record_type}` : `Project ${KIND_BY_CITATION[citation.citation_type]?.toLowerCase() ?? "record"}`),
        locator: locatorText(passage?.page_number ?? citation.page_number, passage?.source_anchor_id ?? citation.source_anchor_id, citation.entity_id),
        kind: KIND_BY_CITATION[citation.citation_type] ?? "Project record",
        state: passage ? passageState(passage)
          : /candidate/i.test(citation.source_record_type ?? "") ? "Candidate · unreviewed" : "Cited by AI answer",
        origin: passage ? "PASSAGE" : "CITATION",
        excerpt: passage?.passage || citation.reference_text || null,
        citation, selection: null,
        documentId: passage?.document_id ?? null,
        pageNumber: passage?.page_number ?? citation.page_number ?? null,
        messageId: message.id,
      });
    }
    // Retrieved passages the answer did not cite still carry their own source state.
    for (const passage of passages.values()) {
      records.push({
        key: `${message.id}:passage:${passage.citation_id}`,
        citationId: passage.citation_id,
        title: passage.source_title,
        source: passage.section_path || passage.source_type,
        locator: locatorText(passage.page_number, passage.source_anchor_id, passage.document_id),
        kind: "Document", state: passageState(passage), origin: "PASSAGE",
        excerpt: passage.passage || null, citation: null, selection: null,
        documentId: passage.document_id ?? null, pageNumber: passage.page_number ?? null, messageId: message.id,
      });
    }
  }
  for (const item of catalog) {
    const selection = item.selection;
    if (cited.has(selection.id)) continue;
    const kind: EvidenceKind = selection.kind === "document" || selection.kind === "documentEvidence" ? "Document"
      : selection.kind === "structureVersion" || selection.kind === "structureCandidate" ? "Structure"
      : selection.kind === "calculation" || selection.kind === "calculationResult" ? "Calculation"
      : selection.kind === "file" ? "File" : "Project record";
    records.push({
      key: `catalog:${selection.kind}:${selection.id}`,
      citationId: null, title: item.label,
      source: selection.kind === "structureCandidate" ? "Candidate structure (unreviewed)"
        : kind === "Project record" ? "Saved project record" : `Saved project ${kind.toLowerCase()}`,
      locator: humanizeDetail(item.detail) || `Record ${selection.id.slice(0, 8)}…`,
      kind,
      state: selection.kind === "structureCandidate" ? "Candidate · unreviewed" : selection.kind === "structureVersion" ? "Committed version" : "Not assessed",
      origin: "PROJECT_CATALOG", excerpt: null, citation: null, selection,
      documentId: kind === "Document" ? selection.id : null, pageNumber: null, messageId: null,
    });
  }
  return records;
}

export function evidenceMatchesFilter(record: EvidenceRecord, filter: EvidenceFilter): boolean {
  switch (filter) {
    case "Cited in chat": return record.origin !== "PROJECT_CATALOG";
    case "Documents": return record.kind === "Document";
    case "Structures": return record.kind === "Structure";
    case "Calculations": return record.kind === "Calculation";
    case "Other": return record.kind === "File" || record.kind === "Dataset" || record.kind === "Project record";
    default: return true;
  }
}
