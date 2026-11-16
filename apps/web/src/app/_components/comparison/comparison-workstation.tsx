"use client";

import type { ProjectScientificComparisonOutput } from "@chemdft/schemas";
import { AppIcon, StatusTag } from "@chemdft/ui";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ALL, codeLabel, visibleSelection } from "@/lib/claim-format";
import {
  agreementOf, comparisonCsv, comparisonFacetCounts, comparisonSearch, comparisonStateFromSearch, emptyComparisonFilters, rowMatches,
  type ComparisonFilters, type ComparisonView,
} from "@/lib/comparison-format";
import { useOverviewDock } from "@/lib/overview-dock";
import { useAiPageContext } from "@/lib/ai-context";
import { getScientificComparison } from "@/lib/phase7-api";
import { useWorkspaceState } from "../workspace-state-provider";
import { Chip, FacetSelect } from "../shared/filter-controls";
import { AgreementView } from "./agreement-chart";
import { ComparisonInspector } from "./comparison-inspector";
import { ComparisonTable } from "./comparison-rows";
import { ManualClaimDialog } from "../manual-claim/manual-claim-dialog";
import styles from "./comparison.module.css";

/** Known relations in display order; any other code the server sends is listed after them under its raw code. */
const RELATION_ORDER = ["SAME_QUANTITY", "NOT_DIRECTLY_COMPARABLE", "SEMANTICS_DIFFER", "DERIVED_FROM", "SOURCE_ONLY", "PROJECT_ONLY", "UNRESOLVED", "NEAREST_TO"];

export function ComparisonWorkstation({ projectId, locale }: { projectId: string; locale: string }) {
  const { workspaceMode } = useWorkspaceState();
  useOverviewDock(projectId, workspaceMode); // the header AI Scientist toggle shows or hides the dock; this page never changes it
  const searchParams = useSearchParams();
  const current = useMemo(() => comparisonStateFromSearch(new URLSearchParams(searchParams.toString())), [searchParams]);
  const { row: rowId, view, ...filters } = current;
  const [data, setData] = useState<ProjectScientificComparisonOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addClaimOpen, setAddClaimOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    getScientificComparison(projectId, locale)
      .then((result) => { if (active) setData(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Comparison could not be loaded."); });
    return () => { active = false; };
  }, [projectId, locale, refreshKey]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const visible = useMemo(() => rows.filter((row) => rowMatches(row, filters)), [rows, filters]);
  const sections = useMemo(() => [...new Set(visible.map((row) => row.section))], [visible]);
  const selected = visibleSelection(visible, rowId);
  // The paper claim and the calculated results of the selected row (ids only; the server reads the stored records).
  const rowClaimId = selected?.source_claims?.[0]?.id;
  const rowResultIds = (selected?.project_claims ?? []).filter((claim) => claim.source_record_type === "calculation_result").map((claim) => claim.source_record_id);
  useAiPageContext(projectId, { page: "paper-vs-chemdft", label: "Paper vs ChemDFT comparison", rowId: selected?.id ?? null, readOnly: true, claimId: rowClaimId, resultIds: rowResultIds });
  const hiddenSelection = rowId && !selected && rows.some((row) => row.id === rowId);
  const agreement = useMemo(() => agreementOf(visible), [visible]);
  const activeFilters = filters.relation !== ALL || filters.section !== ALL || filters.authority !== ALL || filters.review !== ALL || filters.q.trim() !== "";

  // Selecting a row is a navigation step (history entry); editing filters or the view replaces the entry.
  const navigate = useCallback((next: ComparisonFilters, row: string | null, nextView: ComparisonView, mode: "push" | "replace") => {
    const url = `${window.location.pathname}${comparisonSearch(next, row, nextView)}`;
    if (mode === "push") window.history.pushState(null, "", url); else window.history.replaceState(null, "", url);
  }, []);
  const setFilter = (patch: Partial<ComparisonFilters>) => navigate({ ...filters, ...patch }, rowId, view, "replace");
  const select = (id: string) => navigate(filters, id, view, "push");

  const exportCsv = () => {
    const blob = new Blob(["﻿", comparisonCsv(visible)], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `paper-vs-chemdft-${projectId}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  };

  const emptyText = !data ? null : rows.length === 0 ? "This project has no comparison rows yet." : visible.length === 0 ? "No rows match these filters." : null;
  const summary = data?.summary;
  const metrics: Array<[string, number]> = summary ? [
    ["Source claims", summary.source_claims], ["ChemDFT claims", summary.project_claims], ["Comparable pairs", summary.directly_comparable_pairs],
    ["Not directly comparable", summary.not_directly_comparable], ["Source only", summary.source_only_claims], ["ChemDFT only", summary.project_only_claims],
    ["Reconstructed", summary.reconstructed_structures], ["Digitized datasets", summary.digitized_datasets], ["Calculated results", summary.calculated_results],
  ] : [];

  return <div className={`comparison-page ${styles.page}`}>
    <header className={styles.heading}>
      <div>
        <p className="claims-eyebrow">DETERMINISTIC READ MODEL · READ ONLY</p>
        <h1>Paper vs ChemDFT</h1>
        <p className={styles.lede}>Source claims and project records, connected only by recorded provenance and deterministic rules. Values are exactly as the server recorded them.</p>
      </div>
      <div className={styles.headingActions}>
        <StatusTag intent="success">{data ? (activeFilters ? `${visible.length} of ${rows.length} rows` : `${rows.length} rows`) : "Loading"}</StatusTag>
        <button
          className="bp6-button bp6-intent-primary"
          type="button"
          data-testid="open-add-claim-dialog-btn"
          onClick={() => setAddClaimOpen(true)}
        >
          <AppIcon icon="plus" />
          <span className="bp6-button-text">Add paper claim</span>
        </button>
        <div className={styles.quick} role="group" aria-label="View">
          <button type="button" aria-pressed={view === "rows"} onClick={() => navigate(filters, rowId, "rows", "replace")}><AppIcon icon="th-list" /> Rows</button>
          <button type="button" aria-pressed={view === "agreement"} onClick={() => navigate(filters, rowId, "agreement", "replace")}><AppIcon icon="scatter-plot" /> Agreement</button>
        </div>
        <button className="bp6-button" type="button" disabled={visible.length === 0} onClick={exportCsv}><AppIcon icon="download" /><span className="bp6-button-text">Export CSV ({visible.length})</span></button>
        <button className="bp6-button" type="button" onClick={() => window.dispatchEvent(new CustomEvent("chemdft:comparison-summary"))}><AppIcon icon="predictive-analysis" /><span className="bp6-button-text">Summarize comparison</span></button>
      </div>
    </header>
    {addClaimOpen ? (
      <ManualClaimDialog
        projectId={projectId}
        onClose={() => setAddClaimOpen(false)}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />
    ) : null}

    {summary ? <div className={styles.summary} aria-label="Comparison summary">
      {metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div> : null}

    <div className={`claims-toolbar ${styles.toolbar}`} role="search">
      <label className="claims-search"><AppIcon icon="search" />
        <input aria-label="Search comparison rows" placeholder="Search topic, quantity, value, source or rule" value={filters.q} onChange={(event) => setFilter({ q: event.target.value })} />
      </label>
      <FacetSelect label="Relation" ariaLabel="Filter by relation" allLabel="All relations" kind="relation" value={filters.relation}
        counts={comparisonFacetCounts(rows, filters, "relation")} known={RELATION_ORDER} onChange={(value) => setFilter({ relation: value })} />
      <FacetSelect label="Section" ariaLabel="Filter by section" allLabel="All sections" value={filters.section}
        counts={comparisonFacetCounts(rows, filters, "section")} known={[]} onChange={(value) => setFilter({ section: value })} />
      <FacetSelect label="Authority" ariaLabel="Filter by authority" allLabel="All authorities" kind="source_authority" value={filters.authority}
        counts={comparisonFacetCounts(rows, filters, "authority")} known={[]} onChange={(value) => setFilter({ authority: value })} />
      <FacetSelect label="Review state" ariaLabel="Filter by review state" allLabel="All states" kind="review_state" value={filters.review}
        counts={comparisonFacetCounts(rows, filters, "review")} known={[]} onChange={(value) => setFilter({ review: value })} />
    </div>
    {activeFilters ? <div className="claims-chips" aria-label="Active filters">
      {filters.q.trim() ? <Chip label={`Search: ${filters.q.trim()}`} onRemove={() => setFilter({ q: "" })} /> : null}
      {filters.relation !== ALL ? <Chip label={`Relation: ${codeLabel("relation", filters.relation)}`} onRemove={() => setFilter({ relation: ALL })} /> : null}
      {filters.section !== ALL ? <Chip label={`Section: ${filters.section}`} onRemove={() => setFilter({ section: ALL })} /> : null}
      {filters.authority !== ALL ? <Chip label={`Authority: ${codeLabel("source_authority", filters.authority)}`} onRemove={() => setFilter({ authority: ALL })} /> : null}
      {filters.review !== ALL ? <Chip label={`Review: ${codeLabel("review_state", filters.review)}`} onRemove={() => setFilter({ review: ALL })} /> : null}
      <button type="button" className="claims-chip-clear" onClick={() => navigate(emptyComparisonFilters, rowId, view, "replace")}>Clear filters</button>
    </div> : null}
    {hiddenSelection ? <div className="claims-hidden-selection" role="status">The row named in the link is hidden by the current filters. <button type="button" onClick={() => navigate(emptyComparisonFilters, rowId, view, "replace")}>Clear filters to show it</button></div> : null}
    {error ? <div className="claims-error" role="alert">{error}</div> : null}

    <div className={styles.layout}>
      <section className={styles.main} aria-label="Scientific comparison matrix" tabIndex={0}>
        {view === "agreement" && data
          ? <AgreementView agreement={agreement} selectedId={selected?.id ?? null} onSelect={select} />
          : <ComparisonTable rows={visible} sections={sections} selectedId={selected?.id ?? null} onSelect={select} loading={!data && !error} emptyText={emptyText} />}
      </section>
      <ComparisonInspector row={selected} />
    </div>
  </div>;
}
