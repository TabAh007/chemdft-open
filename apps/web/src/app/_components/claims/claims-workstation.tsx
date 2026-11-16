"use client";

import type { ProjectScientificClaimsOutput, ScientificClaim } from "@chemdft/schemas";
import { AppIcon, StatusTag } from "@chemdft/ui";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ALL, claimMatches, codeLabel, emptyFilters, facetCounts, filtersFromSearch, searchFromFilters, uncertaintyView, valueText, valueView,
  visibleSelection, type ClaimFilters,
} from "@/lib/claim-format";
import { useOverviewDock } from "@/lib/overview-dock";
import { useAiPageContext } from "@/lib/ai-context";
import { listScientificClaims } from "@/lib/phase7-api";
import { useWorkspaceState } from "../workspace-state-provider";
import { ClaimInspector } from "./claim-inspector";
import { FacetSelect, Chip } from "../shared/filter-controls";
import { ClaimValue } from "./claim-value";
import { ManualClaimDialog } from "../manual-claim/manual-claim-dialog";

/** Known claim types in display order. Any other type the server sends gets its own group, titled with its raw code. */
const TYPE_ORDER = [
  "USER_ENTERED_LITERATURE_VALUE",
  "EXPERIMENTAL_CONDITION", "COMPOSITION", "STRUCTURAL_PARAMETER", "PEAK_POSITION", "PARTICLE_SIZE", "RANGE",
  "DISTRIBUTION_SUMMARY", "STRUCTURE_ASSERTION", "NUMERIC_VALUE", "CALCULATION_RESULT",
];

export function ClaimsWorkstation({ projectId, locale }: { projectId: string; locale: string }) {
  const { workspaceMode } = useWorkspaceState();
  useOverviewDock(projectId, workspaceMode); // the header AI Scientist toggle shows or hides the dock; Claims never changes it
  const searchParams = useSearchParams();
  const current = useMemo(() => filtersFromSearch(new URLSearchParams(searchParams.toString())), [searchParams]);
  const { claim: claimId, ...filters } = current;
  const [data, setData] = useState<ProjectScientificClaimsOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addClaimOpen, setAddClaimOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    listScientificClaims(projectId, locale)
      .then((result) => { if (active) setData(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Claims could not be loaded."); });
    return () => { active = false; };
  }, [projectId, locale, refreshKey]);

  const claims = useMemo(() => data?.claims ?? [], [data]);
  const visible = useMemo(() => claims.filter((claim) => claimMatches(claim, filters)), [claims, filters]);
  const selected = visibleSelection(visible, claimId);
  useAiPageContext(projectId, selected
    ? { page: "claim", label: `Scientific Claims · claim ${selected.id.slice(0, 8)}`, claimId: selected.id }
    : { page: "project", section: "claims", label: "Scientific Claims" });
  const hiddenSelection = claimId && !selected && claims.some((claim) => claim.id === claimId);

  // Selecting a claim is a navigation step (history entry); editing filters replaces the entry so Back does not step through keystrokes.
  const navigate = useCallback((next: ClaimFilters, claim: string | null, mode: "push" | "replace") => {
    const url = `${window.location.pathname}${searchFromFilters(next, claim)}`;
    if (mode === "push") window.history.pushState(null, "", url); else window.history.replaceState(null, "", url);
  }, []);
  const setFilter = (patch: Partial<ClaimFilters>) => navigate({ ...filters, ...patch }, claimId, "replace");
  const select = (id: string) => navigate(filters, id, "push");
  const activeFilters = filters.type !== ALL || filters.authority !== ALL || filters.review !== ALL || filters.q.trim() !== "";

  const grouped = useMemo(() => {
    const types = [...new Set(visible.map((claim) => claim.claim_type))];
    const ordered = [...TYPE_ORDER.filter((type) => types.includes(type)), ...types.filter((type) => !TYPE_ORDER.includes(type)).sort()];
    return ordered.map((type) => ({ type, rows: visible.filter((claim) => claim.claim_type === type) }));
  }, [visible]);

  const relationsOfSelected = useMemo(() => data?.relations ?? [], [data]);

  return <div className="claims-page">
    <header className="claims-heading">
      <div>
        <p className="claims-eyebrow">PROJECT RECORDS</p>
        <h1>Scientific claims</h1>
      </div>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <button
          type="button"
          className="bp6-button bp6-intent-primary"
          data-testid="open-add-claim-dialog-btn"
          onClick={() => setAddClaimOpen(true)}
        >
          <AppIcon icon="plus" />
          <span className="bp6-button-text">Add paper claim</span>
        </button>
        <StatusTag intent="success">{data ? (activeFilters ? `${visible.length} of ${claims.length} claims` : `${claims.length} claims`) : "Loading"}</StatusTag>
      </div>
    </header>
    {addClaimOpen ? (
      <ManualClaimDialog
        projectId={projectId}
        onClose={() => setAddClaimOpen(false)}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />
    ) : null}
    <div className="claims-notice"><AppIcon icon="info-sign" /> Statements projected from source records, shown as the server recorded them. Similar wording does not reconcile different quantities.</div>

    <div className="claims-toolbar" role="search">
      <label className="claims-search"><AppIcon icon="search" />
        <input aria-label="Search claims" placeholder="Search subject, quantity, value or source" value={filters.q} onChange={(event) => setFilter({ q: event.target.value })} />
      </label>
      <FacetSelect label="Claim type" ariaLabel="Filter by claim type" allLabel="All types" kind="claim_type" value={filters.type}
        counts={facetCounts(claims, filters, "type")} known={TYPE_ORDER} onChange={(value) => setFilter({ type: value })} />
      <FacetSelect label="Authority" ariaLabel="Filter by authority" allLabel="All authorities" kind="source_authority" value={filters.authority}
        counts={facetCounts(claims, filters, "authority")} known={[]} onChange={(value) => setFilter({ authority: value })} />
      <FacetSelect label="Review state" ariaLabel="Filter by review state" allLabel="All states" kind="review_state" value={filters.review}
        counts={facetCounts(claims, filters, "review")} known={[]} onChange={(value) => setFilter({ review: value })} />
    </div>
    {activeFilters ? <div className="claims-chips" aria-label="Active filters">
      {filters.q.trim() ? <Chip label={`Search: ${filters.q.trim()}`} onRemove={() => setFilter({ q: "" })} /> : null}
      {filters.type !== ALL ? <Chip label={`Type: ${codeLabel("claim_type", filters.type)}`} onRemove={() => setFilter({ type: ALL })} /> : null}
      {filters.authority !== ALL ? <Chip label={`Authority: ${codeLabel("source_authority", filters.authority)}`} onRemove={() => setFilter({ authority: ALL })} /> : null}
      {filters.review !== ALL ? <Chip label={`Review: ${codeLabel("review_state", filters.review)}`} onRemove={() => setFilter({ review: ALL })} /> : null}
      <button type="button" className="claims-chip-clear" onClick={() => navigate(emptyFilters, claimId, "replace")}>Clear filters</button>
    </div> : null}
    {hiddenSelection ? <div className="claims-hidden-selection" role="status">The claim named in the link is hidden by the current filters. <button type="button" onClick={() => navigate(emptyFilters, claimId, "replace")}>Clear filters to show it</button></div> : null}
    {error ? <div className="claims-error" role="alert">{error}</div> : null}

    <div className="claims-layout">
      <section className="claims-table-wrap" aria-label="Project scientific claim records" tabIndex={0}>
        <table className="claims-table">
          <thead><tr><th>Claim</th><th>Value as recorded</th><th>Source and state</th></tr></thead>
          <tbody>
            {grouped.map(({ type, rows }) => <GroupRows key={type} type={type} rows={rows} selectedId={selected?.id ?? null} onSelect={select} />)}
            {!data && !error ? <tr><td colSpan={3}>Loading project records…</td></tr> : null}
            {data && claims.length === 0 ? <tr><td colSpan={3}>This project has no scientific claims yet.</td></tr> : null}
            {data && claims.length > 0 && visible.length === 0 ? <tr><td colSpan={3}>No claims match these filters.</td></tr> : null}
          </tbody>
        </table>
      </section>
      <ClaimInspector claim={selected} claims={claims} relations={[...relationsOfSelected]} />
    </div>
  </div>;
}

function GroupRows({ type, rows, selectedId, onSelect }: { type: string; rows: ScientificClaim[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <>
    <tr className="claims-group"><th colSpan={3} title={`Server code: ${type}`}>{codeLabel("claim_type", type)}<span>{rows.length}</span></th></tr>
    {rows.map((claim) => <ClaimRow key={claim.id} claim={claim} active={claim.id === selectedId} onSelect={onSelect} />)}
  </>;
}

function ClaimRow({ claim, active, onSelect }: { claim: ScientificClaim; active: boolean; onSelect: (id: string) => void }) {
  const context = { claimType: claim.claim_type, qualifier: claim.qualifier };
  const uncertainty = uncertaintyView(claim.uncertainty, claim.unit);
  return <tr className={active ? "claim-row selected" : "claim-row"} data-claim-id={claim.id} data-claim-type={claim.claim_type}
    data-authority={claim.source_authority} data-review={claim.review_state}
    onClick={() => onSelect(claim.id)} aria-selected={active} tabIndex={0}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(claim.id); } }}>
    <td title={`${claim.predicate} · ${claim.subject}`}><strong>{claim.predicate}</strong><small>{claim.subject}</small></td>
    <td className="claim-value-cell" title={valueText(claim.value, claim.unit, context)}>
      <ClaimValue view={valueView(claim.value, context)} unit={claim.unit} compact original={claim.original_value_text} />
      {claim.qualifier ? <small className="claim-row-qualifier">{claim.qualifier}</small> : null}
      {uncertainty ? <small className="claim-row-uncertainty">Uncertainty (as recorded): <ClaimValue view={uncertainty} compact /></small> : null}
    </td>
    <td className="claim-provenance-cell">
      <span title={`${claim.source_label}${claim.page ? ` · page ${claim.page}` : ""}`}>{claim.page ? `p. ${claim.page} · ` : ""}{claim.source_label}</span>
      <small>
        <span className={`claim-authority authority-${claim.source_authority.toLowerCase().replaceAll("_", "-")}`} title={`Server code: ${claim.source_authority}`}>{codeLabel("source_authority", claim.source_authority)}</span>
        {" · "}<span title={`Server code: ${claim.review_state}`}>{codeLabel("review_state", claim.review_state)}</span>
        {claim.semantic_status === "INACTIVE_SOURCE" ? <span className="claim-inactive-tag" title="Server code: INACTIVE_SOURCE">Inactive source</span> : null}
      </small>
    </td>
  </tr>;
}
