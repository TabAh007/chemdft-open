"use client";

import { useMemo, useState } from "react";
import type { AICitation, AIMessageView } from "@chemdft/schemas";
import { AppIcon } from "@chemdft/ui";
import { useOptionalWorkspaceState } from "@/app/_components/workspace-state-provider";
import {
  buildEvidenceRecords,
  evidenceMatchesFilter,
  stateTone,
  type EvidenceFilter,
  type EvidenceRecord,
} from "@/lib/ai-evidence-records";

const FILTERS: EvidenceFilter[] = ["All", "Cited in chat", "Documents", "Structures", "Calculations", "Other"];
const PAGE_SIZE = 8;

interface AIScientistEvidenceTabProps {
  projectId: string;
  conversationMessages?: AIMessageView[];
  onOpenCitation?: ((citation: AICitation) => void) | undefined;
}

export function AIScientistEvidenceTab({ projectId, conversationMessages = [], onOpenCitation }: AIScientistEvidenceTabProps) {
  const workspace = useOptionalWorkspaceState();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<EvidenceFilter>("All");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const records = useMemo(
    () => buildEvidenceRecords(conversationMessages, workspace?.catalog ?? []),
    [conversationMessages, workspace?.catalog],
  );
  const counts = useMemo(() => Object.fromEntries(
    FILTERS.map((filter) => [filter, records.filter((record) => evidenceMatchesFilter(record, filter)).length]),
  ) as Record<EvidenceFilter, number>, [records]);
  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return records.filter((record) => evidenceMatchesFilter(record, activeFilter) && (!query ||
      [record.title, record.source, record.locator, record.excerpt ?? "", record.citationId ?? ""].some((text) => text.toLowerCase().includes(query))));
  }, [records, activeFilter, searchQuery]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const canOpen = (record: EvidenceRecord) => Boolean(
    (record.citation && onOpenCitation) || (workspace && (record.selection || record.documentId)),
  );
  const openRecord = (record: EvidenceRecord) => {
    // Citations go through the dock's existing citation resolver (documents by page/anchor,
    // records by catalog identity); catalog rows open their own saved selection.
    if (record.citation && onOpenCitation) { onOpenCitation(record.citation); return; }
    if (!workspace) return;
    if (record.selection) workspace.openSelection(record.selection, record.title);
    else if (record.documentId) {
      workspace.openSelection({ kind: "document", id: record.documentId, projectId,
        ...(record.pageNumber != null ? { locator: { page: record.pageNumber } } : {}) }, record.title);
    }
  };

  const toggle = (key: string) => setSelectedKeys((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const exportSelected = () => {
    const selected = records.filter((record) => selectedKeys.has(record.key));
    if (selected.length === 0) return;
    const payload = {
      projectId, exportedAt: new Date().toISOString(),
      note: "Provenance as recorded by ChemDFT. A citation shows what an AI answer referenced; it is not independent verification.",
      records: selected.map((record) => ({
        citationId: record.citationId, title: record.title, source: record.source, locator: record.locator,
        kind: record.kind, recordedState: record.state, origin: record.origin, messageId: record.messageId,
        entityId: record.citation?.entity_id ?? record.selection?.id ?? null, documentId: record.documentId,
        pageNumber: record.pageNumber, sourceAnchorId: record.citation?.source_anchor_id ?? null,
        knowledgeChunkId: record.citation?.knowledge_chunk_id ?? null, excerpt: record.excerpt,
      })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `chemdft-evidence-${projectId.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ai-evidence-view-container" data-testid="ai-evidence-view">
      <div className="ai-evidence-intro-header">
        <h3 className="ai-evidence-heading">Scientific Evidence</h3>
        <p className="ai-evidence-subtitle">
          Sources cited in this conversation and records saved in this project, with the provenance state ChemDFT recorded for each.
        </p>
      </div>

      <div className="ai-evidence-search-box">
        <AppIcon icon="search" />
        <input type="search" className="ai-evidence-search-input" placeholder="Search titles, sources, citation IDs…"
          value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setPage(1); }}
          aria-label="Search evidence records" data-testid="ai-evidence-search-input" />
      </div>

      <div className="ai-evidence-filter-chips" role="group" aria-label="Evidence filter">
        {FILTERS.map((filter) => (
          <button key={filter} type="button" className={`ai-filter-chip ${activeFilter === filter ? "active" : ""}`}
            onClick={() => { setActiveFilter(filter); setPage(1); }} aria-pressed={activeFilter === filter}
            data-testid={`ai-evidence-filter-${filter.toLowerCase().replaceAll(" ", "-")}`}>
            <span>{filter}</span>
            <span className="ai-chip-count">({counts[filter]})</span>
          </button>
        ))}
      </div>

      <div className="ai-evidence-list">
        {paged.length === 0 ? (
          <div className="ai-evidence-empty-state" role="status">
            <AppIcon icon="book" />
            <p className="ai-evidence-empty-title">{records.length === 0 ? "No evidence yet" : "No evidence matches this filter"}</p>
            <p className="ai-evidence-empty-desc">
              Citations appear when an AI answer references project documents or records. External literature is not searched.
            </p>
          </div>
        ) : paged.map((record) => {
          const selected = selectedKeys.has(record.key);
          const openable = canOpen(record);
          return (
            <div key={record.key} className={`ai-evidence-row ${selected ? "selected" : ""}`}
              data-testid="ai-evidence-item" data-origin={record.origin}>
              <div className="ai-evidence-check-col">
                <input type="checkbox" checked={selected} onChange={() => toggle(record.key)} aria-label={`Select ${record.title}`} />
              </div>
              <div className="ai-evidence-icon-col" aria-hidden="true">
                <AppIcon icon={record.kind === "Structure" ? "cube" : record.kind === "Calculation" ? "database" : "document"} />
              </div>
              <div className="ai-evidence-main-col">
                <strong className="ai-evidence-title">
                  {record.citationId ? <span className="ai-evidence-citation-id">[{record.citationId}] </span> : null}
                  {record.title}
                </strong>
                <p className="ai-evidence-authors">{record.source}</p>
                <p className="ai-evidence-publication">{record.locator}</p>
                {record.excerpt ? (
                  <p className="ai-evidence-excerpt">&ldquo;{record.excerpt.slice(0, 160)}{record.excerpt.length > 160 ? "…" : ""}&rdquo;</p>
                ) : null}
                <div className="ai-evidence-tags-row">
                  <span className="ai-evidence-tag type-tag">{record.kind}</span>
                  <span className="ai-evidence-tag format-tag">{record.origin === "PROJECT_CATALOG" ? "Saved in project" : "Cited in chat"}</span>
                  <span className={`ai-evidence-tag trust-tag tone-${stateTone(record.state)}`} data-testid="ai-evidence-state">{record.state}</span>
                </div>
              </div>
              <div className="ai-evidence-actions-col">
                <button type="button" className="ai-evidence-open-btn" onClick={() => openRecord(record)} disabled={!openable}
                  title={openable ? "Open the source in the workspace" : "No navigable source recorded"}
                  aria-label={`Open source: ${record.title}`}>
                  <AppIcon icon="share" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="ai-evidence-footer">
        {totalPages > 1 ? (
          <div className="ai-evidence-pagination">
            <button type="button" className="ai-page-btn" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous page">
              <AppIcon icon="chevron-left" />
            </button>
            {Array.from({ length: totalPages }).map((_, index) => (
              <button key={index} type="button" className={`ai-page-num ${currentPage === index + 1 ? "active" : ""}`}
                aria-current={currentPage === index + 1 ? "page" : undefined} onClick={() => setPage(index + 1)}>
                {index + 1}
              </button>
            ))}
            <button type="button" className="ai-page-btn" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} aria-label="Next page">
              <AppIcon icon="chevron-right" />
            </button>
          </div>
        ) : <div />}
        <button type="button" className="ai-evidence-export-btn" disabled={selectedKeys.size === 0} onClick={exportSelected}>
          <AppIcon icon="download" />
          <span>Export selected ({selectedKeys.size})</span>
        </button>
      </div>
    </div>
  );
}
