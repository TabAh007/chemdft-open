"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "@chemdft/ui";
import type { Locale } from "@chemdft/i18n";
import type { OverviewRow, SavedComparisonOpenOutput } from "@chemdft/schemas";
import { downloadComparison } from "@/lib/analysis-api";
import {
  comparisonTitle, MAX_SELECTION, MIN_SELECTION, positionLetter, selectionAnnouncement, shortLabel, STATUS, type CompareItem,
} from "@/lib/compare-model";
import { saveBlob } from "@/lib/download";
import { useOverviewDock } from "@/lib/overview-dock";
import { useAiPageContext } from "@/lib/ai-context";
import { useComparison, useCompareSelection, useSavedComparisons, useSelectedItems, useStoredPayloads } from "@/lib/use-compare";
import { useProjectWriteAccess } from "@/lib/use-project-role";
import { archiveSavedComparison, createSavedComparison, downloadReport, openSavedComparison, type ReportFormat } from "@/lib/workflows-api";
import { useWorkspaceState } from "../workspace-state-provider";
import { ExportMenu, SavedMenu, SavePopover, type ExportKind } from "./compare-actions";
import { CompareLibrary } from "./compare-library";
import { CompatibilityPanel, SelectionOverview, StatusBadge } from "./compare-selected";
import { DifferenceView, ProvenanceView, RulesView, StoredDataView } from "./compare-views";
import styles from "./compare.module.css";

const PlotsView = dynamic(() => import("./compare-charts"), { ssr: false, loading: () => <p className={styles.muted} role="status">Loading plots…</p> });
const StructuresView = dynamic(() => import("./compare-structures"), { ssr: false, loading: () => <p className={styles.muted} role="status">Loading structure viewers…</p> });

type TabKey = "key" | "plots" | "data" | "structures" | "provenance" | "rules";
const TABS: { key: TabKey; label: string; icon: "comparison" | "timeline-line-chart" | "th" | "cube" | "diagram-tree" | "properties" }[] = [
  { key: "key", label: "Key comparison", icon: "comparison" },
  { key: "plots", label: "Plots", icon: "timeline-line-chart" },
  { key: "data", label: "Data", icon: "th" },
  { key: "structures", label: "Structures", icon: "cube" },
  { key: "provenance", label: "Provenance", icon: "diagram-tree" },
  { key: "rules", label: "Rules", icon: "properties" },
];

const SPLIT_KEY = "chemdft:compare:library-width";
const MIN_LIBRARY = 320;
const MIN_ANALYSIS = 440;

const REVALIDATION_TEXT = {
  UNCHANGED: "Unchanged",
  STATE_CHANGED: "Scientific standing changed",
  SOURCE_CHANGED: "Stored source changed",
  MISSING: "Source no longer exists",
} as const;

export function CompareWorkstation({ projectId, locale }: { projectId: string; locale: Locale }) {
  const { workspaceMode } = useWorkspaceState();
  useOverviewDock(projectId, workspaceMode); // the header AI Scientist toggle shows or hides the dock; Compare never changes it
  const selection = useCompareSelection();
  const access = useProjectWriteAccess(projectId);
  const saved = useSavedComparisons(projectId);
  const [libraryRows, setLibraryRows] = useState<readonly OverviewRow[]>([]);
  const onRows = useCallback((rows: readonly OverviewRow[]) => setLibraryRows(rows), []);
  const [tab, setTab] = useState<TabKey>("key");
  const [pane, setPane] = useState<"library" | "analysis">("library");
  // On a narrow screen (one pane at a time) a link that already names results opens on the comparison.
  const paneChosen = useRef(false);
  useEffect(() => {
    if (!selection.ready || paneChosen.current) return;
    paneChosen.current = true;
    if (selection.ids.length > 0 || selection.savedId) queueMicrotask(() => setPane("analysis"));
  }, [selection.ready, selection.ids.length, selection.savedId]);
  const [opened, setOpened] = useState<SavedComparisonOpenOutput | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>("");
  
  const selected = useSelectedItems(projectId, selection.ids, libraryRows, selection.ready);
  const ordered = useMemo(() => selection.ids.flatMap((id) => { const item = selected.items.get(id); return item ? [item] : []; }), [selection.ids, selected.items]);
  const availableIds = useMemo(() => ordered.map((item) => item.resultId), [ordered]);
  const unavailableIds = useMemo(() => selection.ids.filter((id) => selected.unavailable.has(id)), [selection.ids, selected.unavailable]);
  const settled = selection.ready && selected.pending.size === 0;
  const comparison = useComparison(projectId, availableIds, settled);
  const payloads = useStoredPayloads(projectId, ordered);
  // Thermochemical conditions arrive with each stored result row; nothing is read from a payload for them.
  const conditions = useMemo(() => new Map(ordered.flatMap((item) => (item.conditions ? [[item.resultId, item.conditions] as const] : []))), [ordered]);
  const output = comparison.output;

  // --- opening a saved comparison: the server revalidates it, then its members become the selection -------------------
  useEffect(() => {
    if (!selection.ready || !selection.savedId) return;
    let alive = true;
    void openSavedComparison(projectId, selection.savedId)
      .then((value) => { if (!alive) return; setOpened(value); setOpenError(null); selection.adopt(value.saved.result_ids); })
      .catch((cause: unknown) => { if (alive) setOpenError(cause instanceof Error ? cause.message : "The saved comparison could not be opened."); });
    return () => { alive = false; };
    // The revision identifies each navigation to a saved comparison; `adopt` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selection.ready, selection.savedId, selection.revision]);
  const modified = opened !== null && selection.savedId === null;

  // --- split pane ------------------------------------------------------------------------------------------------------
  const splitRef = useRef<HTMLDivElement | null>(null);
  const [libraryWidth, setLibraryWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    try { const stored = Number(localStorage.getItem(SPLIT_KEY)); if (Number.isFinite(stored) && stored >= MIN_LIBRARY) queueMicrotask(() => setLibraryWidth(stored)); } catch { /* optional convenience */ }
  }, []);
  useEffect(() => {
    const node = splitRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setTotal(node.clientWidth));
    observer.observe(node);
    setTotal(node.clientWidth);
    return () => observer.disconnect();
  }, []);
  const bounds = useMemo(() => ({ min: MIN_LIBRARY, max: Math.max(MIN_LIBRARY, total - MIN_ANALYSIS - 10) }), [total]);
  const defaultWidth = Math.round(Math.min(Math.max(total * 0.36, 360), 520));
  const effectiveWidth = Math.min(Math.max(libraryWidth ?? defaultWidth, bounds.min), bounds.max);
  const setWidth = useCallback((width: number) => {
    const next = Math.round(Math.min(Math.max(width, bounds.min), bounds.max));
    setLibraryWidth(next);
    try { localStorage.setItem(SPLIT_KEY, String(next)); } catch { /* optional convenience */ }
  }, [bounds]);
  const onDividerKey = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowLeft") { event.preventDefault(); setWidth(effectiveWidth - step); }
    else if (event.key === "ArrowRight") { event.preventDefault(); setWidth(effectiveWidth + step); }
    else if (event.key === "Home") { event.preventDefault(); setWidth(bounds.min); }
    else if (event.key === "End") { event.preventDefault(); setWidth(bounds.max); }
    else if (event.key === "Enter") { event.preventDefault(); setLibraryWidth(null); try { localStorage.removeItem(SPLIT_KEY); } catch { /* optional */ } }
  };

  // --- actions ---------------------------------------------------------------------------------------------------------
  const canCompare = availableIds.length >= MIN_SELECTION;
  const readOnly = access.canWrite !== true;
  const clearAll = useCallback(() => { setOpened(null); setFeedback(""); selection.clear(); }, [selection]);
  const exportAs = useCallback(async (kind: ExportKind) => {
    setFeedback("");
    try {
      const file = kind === "csv" || kind === "json"
        ? await downloadComparison({ projectId, resultIds: availableIds, format: kind })
        : await downloadReport({ projectId, format: kind.slice("report-".length) as ReportFormat, resultIds: availableIds });
      saveBlob(file.blob, file.filename);
      setFeedback(`Saved ${file.filename}.`);
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "The export failed.");
    }
  }, [projectId, availableIds]);
  const save = useCallback(async (name: string, note: string): Promise<boolean> => {
    setFeedback("");
    try {
      const created = await createSavedComparison({ projectId, name, note, resultIds: availableIds });
      saved.reload();
      setFeedback(`Saved “${created.name}”. Reopening it revalidates every source.`);
      return true;
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "The comparison could not be saved.");
      return false;
    }
  }, [projectId, availableIds, saved]);
  const archive = useCallback(async (id: string) => {
    try { await archiveSavedComparison(projectId, id); saved.reload(); }
    catch (cause) { setFeedback(cause instanceof Error ? cause.message : "The saved comparison could not be archived."); }
  }, [projectId, saved]);
  const onTabKey = (event: React.KeyboardEvent) => {
    const index = TABS.findIndex((t) => t.key === tab);
    const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index - 1 + TABS.length) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next]!.key);
    window.setTimeout(() => document.getElementById(`compare-tab-${TABS[next]!.key}`)?.focus(), 0);
  };

  const requested = selection.ids.length;
  // Tell the dock what is being compared (read-only; the AI context itself is untouched).
  const referenceName = ordered[0] ? shortLabel(ordered[0]) : null;
  const letterKey = ordered.map((_, i) => positionLetter(i)).join(",");
  const comparedIds = ordered.map((item) => item.resultId);
  useAiPageContext(projectId, selection.ready
    ? { page: "compare", label: "Calculation comparison", resultIds: comparedIds, letters: letterKey ? letterKey.split(",") : [], referenceLabel: referenceName, readOnly: true }
    : { page: "project", section: "results", label: "Calculation comparison" });
  const title = comparisonTitle(ordered);
  const overall = output?.overall ?? null;
  // Screen-reader announcement of the meaningful change: what is selected, who is the reference, and the verdict once known.
  const referenceLabel = ordered[0] ? shortLabel(ordered[0]) : null;
  const announcement = !selection.ready ? "" : `${selectionAnnouncement(requested, referenceLabel)}${output && canCompare && output.overall && STATUS[output.overall] ? ` Comparison: ${STATUS[output.overall].text}.` : ""}`;

  return (
    <div className={`compare-page ${styles.page}`} data-testid="compare-workstation" data-count={requested} data-overall={overall ?? ""}>
      <h1 className={styles.visuallyHidden}>Compare published results</h1>
      <div className={styles.paneSwitch} role="group" aria-label="Show">
        <button type="button" aria-pressed={pane === "library"} onClick={() => setPane("library")}>Results</button>
        <button type="button" aria-pressed={pane === "analysis"} onClick={() => setPane("analysis")} data-testid="compare-pane-analysis">Comparison{requested ? ` (${requested})` : ""}</button>
      </div>
      <p className={styles.visuallyHidden} role="status" aria-live="polite" data-testid="compare-announcement">{announcement}</p>

      <div
        ref={splitRef} className={styles.split} data-pane={pane} data-testid="compare-split"
        style={{ "--cmp-library-w": total ? `${effectiveWidth}px` : "38%" } as React.CSSProperties}
      >
        <CompareLibrary projectId={projectId} locale={locale} selection={selection.ids} atLimit={selection.atLimit} onToggle={selection.toggle} onClear={clearAll} onRows={onRows} headerAction={<SavedMenu list={saved.list} canWrite={!readOnly} onOpen={selection.openSaved} onArchive={(id) => void archive(id)} />} />
        <div
          className={styles.divider} role="separator" aria-orientation="vertical" tabIndex={0} aria-label="Resize the results library"
          aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={effectiveWidth} data-dragging={dragging} data-testid="compare-divider"
          onKeyDown={onDividerKey} onDoubleClick={() => { setLibraryWidth(null); try { localStorage.removeItem(SPLIT_KEY); } catch { /* optional */ } }}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
          onPointerMove={(event) => { if (!dragging || !splitRef.current) return; setWidth(event.clientX - splitRef.current.getBoundingClientRect().left - 5); }}
          onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); }}
          onPointerCancel={() => setDragging(false)}
        />

        <section className={`${styles.panel} ${styles.analysis}`} aria-label="Live comparison" data-testid="compare-analysis">
          {!selection.ready ? (
            <div className={styles.empty} role="status" aria-busy="true"><p>Reading the selection…</p></div>
          ) : requested === 0 && !openError ? (
            <EmptyState savedCount={saved.list?.availability === "NOT_ACTIVATED" ? 0 : (saved.list?.comparisons ?? []).filter((c) => !c.archived).length} list={saved.list} onOpenSaved={selection.openSaved} />
          ) : (
            <>
              <div className={styles.analysisScroll} data-testid="compare-analysis-scroll">
                <header className={styles.analysisHead} data-testid="compare-head">
                  <h2>
                    {canCompare ? <>Comparison: {title}</> : "Selected result"}
                    <small>({requested} result{requested === 1 ? "" : "s"})</small>
                  </h2>
                  {overall ? <StatusBadge label={overall} short data-testid="compare-head-status" /> : null}
                  <div className={styles.headActions}>
                    {readOnly ? null : <SavePopover disabled={!canCompare || unavailableIds.length > 0 || saved.list?.availability === "NOT_ACTIVATED"} reason={!canCompare ? "Select at least two available results" : unavailableIds.length ? "Remove the unavailable results first" : "Saving needs a database migration that has not been applied to this environment."} onSave={save} />}
                    <button type="button" className={styles.secondaryAction} onClick={clearAll} data-testid="compare-reset"><AppIcon icon="reset" /> Clear</button>
                    <ExportMenu disabled={!canCompare || unavailableIds.length > 0} onExport={(kind) => void exportAs(kind)} />
                  </div>
                  <p className={styles.feedback} role="status" aria-live="polite" data-testid="compare-feedback">{feedback}</p>
                </header>

                {openError ? <p className={styles.notice} data-intent="danger" role="alert" data-testid="compare-error"><strong>The saved comparison could not be opened</strong><span>{openError}</span></p> : null}
                {opened ? <RevalidationBanner opened={opened} modified={modified} /> : null}
                {selected.error ? <p className={styles.notice} data-intent="danger" role="alert" data-testid="compare-error"><strong>Some selected results could not be read</strong><span>{selected.error}</span></p> : null}
                {unavailableIds.length > 0 ? (
                  <div className={styles.notice} data-intent="warning" role="note" data-testid="compare-unavailable">
                    <strong>{unavailableIds.length} selected result{unavailableIds.length === 1 ? " is" : "s are"} not available</strong>
                    <span>Each may have been deleted, belongs to another project, or you may no longer have access. The other results are unaffected.</span>
                    <ul>
                      {unavailableIds.map((id) => (
                        <li key={id} className={styles.noticeActions}>
                          <span className={styles.mono}>{id.slice(0, 8)}…</span>
                          <button type="button" className={styles.link} onClick={() => selection.remove(id)} data-testid="compare-remove-unavailable" aria-label={`Remove unavailable result ${id.slice(0, 8)} from the selection`}>Remove</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className={styles.overview}>
                  {ordered.length > 0 ? <SelectionOverview items={ordered} onRemove={selection.remove} onMakeReference={selection.setReference} /> : <p className={styles.muted} role="status">Reading the selected results…</p>}
                  {canCompare ? (
                    <CompatibilityPanel output={output} items={ordered} loading={comparison.loading} error={comparison.error} onRetry={comparison.retry} onShowRules={() => setTab("rules")} />
                  ) : (
                    <section className={styles.compat} aria-label="Compatibility summary" data-testid="compare-need-more">
                      <h3>Select another result</h3>
                      <p className={styles.muted}>{ordered.length === 1 ? "This is the reference. " : ""}Select {Math.max(1, MIN_SELECTION - availableIds.length)} more published result{MIN_SELECTION - availableIds.length === 1 ? "" : "s"} to compare (up to {MAX_SELECTION}). Compatibility is checked by the scientific rules as soon as you do.</p>
                    </section>
                  )}
                </div>

                {canCompare ? (
                  <div data-testid="compare-output" data-overall={overall ?? ""} aria-busy={comparison.loading}>
                    <div className={styles.tabs} role="tablist" aria-label="Comparison views" onKeyDown={onTabKey}>
                      {TABS.map((t) => (
                        <button key={t.key} type="button" role="tab" id={`compare-tab-${t.key}`} className={styles.tab} aria-selected={tab === t.key} aria-controls={`compare-panel-${t.key}`} tabIndex={tab === t.key ? 0 : -1} onClick={() => setTab(t.key)} data-testid={`compare-tab-${t.key}`}>
                          <AppIcon icon={t.icon} />{t.label}
                        </button>
                      ))}
                    </div>
                    <div role="tabpanel" id={`compare-panel-${tab}`} aria-labelledby={`compare-tab-${tab}`} style={{ paddingTop: 10 }}>
                      {!output ? (
                        comparison.error ? <p className={styles.muted}>No comparison is shown until the request succeeds.</p> : <p className={styles.skeleton} role="status" data-testid="compare-updating">Updating the comparison…</p>
                      ) : tab === "key" ? <DifferenceView output={output} items={ordered} />
                        : tab === "plots" ? <PlotsView output={output} items={ordered} conditions={conditions} modes={payloads.modes} />
                        : tab === "data" ? <StoredDataView output={output} items={ordered} />
                        : tab === "structures" ? <StructuresView projectId={projectId} items={ordered} />
                        : tab === "provenance" ? <ProvenanceView output={output} items={ordered} projectId={projectId} locale={locale} />
                        : <RulesView output={output} items={ordered} conditions={conditions} />}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyState({ savedCount, list, onOpenSaved }: { savedCount: number; list: ReturnType<typeof useSavedComparisons>["list"]; onOpenSaved: (id: string) => void }) {
  const comparisons = (list?.comparisons ?? []).filter((c) => !c.archived);
  return (
    <div className={styles.empty} data-testid="compare-empty">
      <span className={styles.emptyIcon}><AppIcon icon="comparison" /></span>
      <h2>Select a result to begin comparing.</h2>
      <p>Choose two to {MAX_SELECTION} published results from the library. The first result you select is the reference; every difference is measured against it, and appears only where the scientific rules permit it.</p>
      {savedCount > 0 ? (
        <div className={styles.savedInEmpty} data-testid="compare-empty-saved">
          <span className={styles.kicker}>Saved comparisons</span>
          {comparisons.map((c) => (
            <div key={c.id} className={styles.savedRow}>
              <button type="button" className={styles.link} style={{ textAlign: "left" }} onClick={() => onOpenSaved(c.id)} data-testid="saved-open-empty">{c.name}</button>
              <span className={styles.caption}>{c.result_ids.length} results</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RevalidationBanner({ opened, modified }: { opened: SavedComparisonOpenOutput; modified: boolean }) {
  const intent = opened.status === "CURRENT" ? "info" : opened.status === "CHANGED" ? "warning" : "danger";
  return (
    <section className={styles.notice} data-intent={intent} aria-label="Saved comparison revalidation" data-testid="revalidation" data-status={opened.status}>
      <strong>Saved comparison: {opened.saved.name}</strong>
      <span>
        {opened.status === "CURRENT" ? "Sources unchanged since saving." : opened.status === "CHANGED" ? "A source changed since saving." : "A source is unavailable."}{" "}
        Revalidated {new Date(opened.revalidated_at).toLocaleString()}.{modified ? " The selection has been changed since opening it; saving creates a new comparison." : ""}
      </span>
      <details>
        <summary>Each source, as saved and as it stands now</summary>
        <div className={styles.scroll} style={{ marginTop: 6 }} tabIndex={0} role="region" aria-label="Each source result, as saved and as it stands now (scrollable)">
          <table className={styles.data} data-testid="revalidation-table">
            <caption className="screen-reader-only">Each source result, as saved and as it stands now</caption>
            <thead><tr><th scope="col">Result</th><th scope="col">Saved as</th><th scope="col">Now</th><th scope="col">Revalidation</th></tr></thead>
            <tbody>
              {opened.revalidation.map((r, index) => (
                <tr key={r.result_id} data-status={r.status}>
                  <th scope="row"><span className={styles.letter} data-reference={index === 0}>{positionLetter(index)}</span> <span className={styles.mono}>{r.result_id.slice(0, 8)}</span></th>
                  <td>{r.saved.evidence_use === "CURRENT" ? "Current" : "Historical"}</td>
                  <td>{r.current_evidence_use == null ? "—" : r.current_evidence_use === "CURRENT" ? "Current" : "Historical"}</td>
                  <td className={r.status === "UNCHANGED" ? styles.outcomePass : styles.outcomeLimit}>{REVALIDATION_TEXT[r.status]} — {r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {opened.comparison === null ? <span role="alert">The comparison cannot be recomputed because a source result is missing; the saved snapshot is historical context only.</span> : null}
    </section>
  );
}

export type { CompareItem };
