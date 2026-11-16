"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppIcon } from "@chemdft/ui";
import type { Locale } from "@chemdft/i18n";
import type { OverviewRow } from "@chemdft/schemas";
import { conditionsText, formatCount, itemFromRow, libraryTally, MAX_SELECTION, positionLetter, storedAtText } from "@/lib/compare-model";
import { taskLabel, type SortDirection, type SortKey } from "@/lib/overview-view";
import { resultDetailHref } from "@/lib/results-model";
import { usePublishedResults } from "@/lib/use-published-results";
import styles from "./compare.module.css";

type Filters = { text: string; task: string; engine: string; standing: "all" | "current" | "historical" };
const NO_FILTERS: Filters = { text: "", task: "ALL", engine: "ALL", standing: "all" };

const SORTS: { key: SortKey; label: string }[] = [
  { key: "updated", label: "Newest" },
  { key: "task", label: "Result type" },
  { key: "formula", label: "Molecule" },
  { key: "engine", label: "Engine" },
  { key: "energy", label: "Stored energy" },
];

/**
 * The searchable, filterable, server-paged list of the project's PUBLISHED results. Selection lives with the
 * workstation (the URL); this list never resets it: filters, search, sorting and paging only change which rows are
 * on screen. The first selected result is the reference and says so in its row.
 */
export function CompareLibrary({ projectId, locale, selection, atLimit, onToggle, onClear, onRows, headerAction }: {
  projectId: string;
  locale: Locale;
  selection: readonly string[];
  atLimit: boolean;
  onToggle: (resultId: string) => void;
  onClear: () => void;
  onRows: (rows: readonly OverviewRow[]) => void;
  /** Always-visible action beside the title (the saved comparisons of the project). */
  headerAction?: ReactNode;
}) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [typed, setTyped] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "updated", direction: "desc" });

  useEffect(() => {
    const id = window.setTimeout(() => setFilters((current) => (current.text === typed ? current : { ...current, text: typed })), 250);
    return () => window.clearTimeout(id);
  }, [typed]);

  const results = usePublishedResults(projectId, {
    task: filters.task === "ALL" ? null : filters.task,
    engine: filters.engine === "ALL" ? null : filters.engine,
    standing: filters.standing === "all" ? null : filters.standing,
    text: filters.text,
    sort: sort.key,
    direction: sort.direction,
  });
  const { rows, page } = results;
  // While a new query loads the hook hands back a fresh empty list each render; the workstation keeps the last real rows.
  useEffect(() => { if (!results.loading) onRows(rows); }, [rows, results.loading, onRows]);

  const rowsWithResult = useMemo(() => rows.filter((row) => row.result_id), [rows]);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS) || typed !== "";
  const total = page?.total_published ?? 0;
  const matching = page?.total_matching ?? 0;
  const full = selection.length >= MAX_SELECTION;
  const tallyInfo = libraryTally(rowsWithResult.length, matching, total, filtered);

  return (
    <section className={`${styles.panel} ${styles.library}`} aria-label="Results library" data-testid="compare-library">
      <div className={styles.libraryHead}>
        <div className={styles.libraryTitle}><h2>Select results to compare</h2>{headerAction}</div>
        <p>Choose 2–{MAX_SELECTION} published results. Only scientifically comparable quantities are compared.</p>
        <label className={styles.search}>
          <span className={styles.visuallyHidden}>Search results by type, structure, method, engine or identifier</span>
          <AppIcon icon="search" />
          <input type="search" value={typed} onChange={(event) => setTyped(event.currentTarget.value)} placeholder="Search result, structure, method, engine…" data-testid="compare-search" />
        </label>
        <div className={styles.chips} role="group" aria-label="Result type">
          <button type="button" className={styles.chip} aria-pressed={filters.task === "ALL"} onClick={() => setFilters((c) => ({ ...c, task: "ALL" }))} data-testid="compare-type-all">All</button>
          {(page?.facets.tasks ?? []).map((task) => (
            <button key={task} type="button" className={styles.chip} aria-pressed={filters.task === task} onClick={() => setFilters((c) => ({ ...c, task: c.task === task ? "ALL" : task }))} data-testid={`compare-type-${task}`}>{taskLabel(task)}</button>
          ))}
        </div>
        <div className={styles.filters}>
          <label>Engine
            <select value={filters.engine} onChange={(event) => setFilters((c) => ({ ...c, engine: event.currentTarget.value }))} data-testid="compare-engine">
              <option value="ALL">All</option>
              {(page?.facets.engines ?? []).map((engine) => <option key={engine} value={engine}>{engine}</option>)}
            </select>
          </label>
          <label>Standing
            <select value={filters.standing} onChange={(event) => setFilters((c) => ({ ...c, standing: event.currentTarget.value as Filters["standing"] }))} data-testid="compare-standing">
              <option value="all">All</option><option value="current">Current</option><option value="historical">Historical</option>
            </select>
          </label>
          <label>Sort
            <select
              value={`${sort.key}:${sort.direction}`}
              onChange={(event) => { const [key, direction] = event.currentTarget.value.split(":") as [SortKey, SortDirection]; setSort({ key, direction }); }}
              data-testid="compare-sort"
            >
              {SORTS.map((option) => (
                <optgroup key={option.key} label={option.label}>
                  <option value={`${option.key}:${option.key === "updated" ? "desc" : "asc"}`}>{option.label}{option.key === "updated" ? " first" : " (A–Z / low–high)"}</option>
                  <option value={`${option.key}:${option.key === "updated" ? "asc" : "desc"}`}>{option.key === "updated" ? "Oldest first" : `${option.label} (Z–A / high–low)`}</option>
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.tally} data-testid="compare-tally">
          <span role="status" aria-live="polite" title={tallyInfo.title} data-testid="compare-loaded">{results.loading && !page ? "Loading…" : results.loading ? "Updating…" : tallyInfo.text}</span>
          <span className={styles.spacer} />
          <span data-testid="compare-selected-count"><strong>{selection.length}</strong> of {MAX_SELECTION} selected</span>
          {selection.length > 0 ? <button type="button" className={styles.link} onClick={onClear} data-testid="compare-clear">Clear selection</button> : null}
          {filtered ? <button type="button" className={styles.link} onClick={() => { setFilters(NO_FILTERS); setTyped(""); }} data-testid="compare-clear-filters">Clear filters</button> : null}
        </div>
      </div>
      {full || atLimit ? <p className={styles.limitNote} role="note" data-testid="compare-limit">The maximum of {MAX_SELECTION} results is selected. Deselect one to add another.</p> : null}

      <div className={styles.listScroll} data-testid="compare-list-scroll">
        {results.error && !page ? (
          <div className={styles.emptyList} role="alert" data-testid="compare-library-error">
            <strong>Results could not be loaded</strong><span className={styles.muted}>{results.error}</span>
            <span><button type="button" className={styles.secondaryAction} onClick={results.reload}>Retry</button></span>
          </div>
        ) : null}
        {page && page.total_published === 0 ? (
          <div className={styles.emptyList} data-testid="compare-no-results">
            <strong>No published results yet</strong>
            <span className={styles.muted}>A result appears here once its calculation succeeds and the platform validates its output.</span>
          </div>
        ) : null}
        {page && page.total_published > 0 ? (
          <table className={styles.table} data-testid="compare-candidates">
            <caption className={styles.visuallyHidden}>Published results. Tick a result to add it to the comparison; the first selected result is the reference.</caption>
            <thead>
              <tr>
                <th scope="col" className={styles.selectCell}><span className={styles.visuallyHidden}>Select</span></th>
                <th scope="col">Result</th>
                <th scope="col" className={`${styles.numHead} ${styles.valueTh}`}>Stored value</th>
              </tr>
            </thead>
            <tbody>
              {rowsWithResult.map((row) => {
                const item = itemFromRow(row);
                const rank = selection.indexOf(item.resultId);
                const selected = rank >= 0;
                const blocked = !selected && full;
                return (
                  <tr
                    key={item.resultId}
                    data-testid="compare-candidate" data-result-id={item.resultId} data-selected={selected} data-reference={rank === 0}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("a, button, input, label")) return;
                      if (!blocked) onToggle(item.resultId);
                    }}
                  >
                    <td className={styles.selectCell}>
                      <input
                        type="checkbox" checked={selected} disabled={blocked} onChange={() => onToggle(item.resultId)}
                        aria-label={`${selected ? (rank === 0 ? "Deselect reference" : "Deselect") : "Select"} ${item.taskText}, ${item.level}, ${item.structureText}`}
                        {...(blocked ? { title: `Maximum of ${MAX_SELECTION} results is selected` } : {})}
                        data-testid="compare-select"
                      />
                    </td>
                    <td>
                      <div className={styles.cellMain}>
                        {selected ? <span className={styles.letter} data-reference={rank === 0} aria-hidden="true">{positionLetter(rank)}</span> : null}
                        <span>{item.taskText}</span>
                        {item.structureRevision ? <span className={styles.version}>{item.structureRevision}</span> : null}
                        {rank === 0 ? <span className={styles.tag} data-intent="primary" data-testid="compare-reference-badge">Reference</span> : null}
                      </div>
                      <div className={styles.cellSub}>{item.structureName ?? "structure not recorded"}{item.formula ? ` · ${item.formula}` : ""}</div>
                      <div className={styles.cellMain} style={{ fontWeight: 500, marginTop: 2 }}>{item.level}</div>
                      <div className={styles.cellSub}><span className={styles.nowrapPiece}>{item.engine}</span> · <span className={styles.nowrapPiece}>charge {item.charge ?? "?"}</span> · <span className={styles.nowrapPiece}>2S+1 {item.multiplicity ?? "?"}</span></div>
                      {item.resultType === "chemdft.thermochemistry" ? (
                        <div className={styles.conditionsLine} data-testid="compare-row-conditions">
                          {conditionsText(item.conditions) ?? <span className={styles.muted}>conditions not recorded</span>}
                        </div>
                      ) : null}
                      <div className={`${styles.cellSub} ${styles.identity}`} data-testid="compare-row-identity">
                        <span className={styles.mono} title={`Result ${item.resultId}`}>#{item.shortId}</span>
                        {storedAtText(item.updatedAt) ? <span title="Stored (UTC)"> · {storedAtText(item.updatedAt)}</span> : null}
                      </div>
                    </td>
                    <td className={styles.valueTd}>
                      <div className={styles.num}>
                        {item.primary ? <>{item.primary.text}{item.primary.unit ? ` ${item.primary.unit}` : ""}</> : <span className={styles.muted} title="No scalar quantity is stored for this result type">Unavailable</span>}
                      </div>
                      <div className={styles.valueMeta}>
                        {item.standing === "current"
                          ? <span className={styles.tag} data-intent="success"><AppIcon icon="tick" /> Current</span>
                          : <span className={styles.tag} data-intent="warning" title={item.standingText}><AppIcon icon="history" /> Historical</span>}
                        <Link
                          className={styles.openLink} href={resultDetailHref(locale, projectId, item.resultId)} data-testid="compare-open-result"
                          aria-label={`Open the Result Inspector for ${item.taskText}, ${item.level}`} title="Open Result Inspector"
                        ><AppIcon icon="share" /></Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        {page && page.total_published > 0 && rowsWithResult.length === 0 && !results.loading && !results.error ? (
          <p className={styles.emptyList} data-testid="compare-no-match">No published result matches these filters.</p>
        ) : null}
        {results.error && page ? (
          <div className={styles.moreRow} role="alert" data-testid="compare-library-error">
            <span className={styles.muted}>{results.error}</span>{" "}<button type="button" className={styles.link} onClick={results.reload}>Retry</button>
          </div>
        ) : null}
        {results.hasMore ? (
          <div className={styles.moreRow}>
            <button type="button" className={styles.secondaryAction} disabled={results.loadingMore} onClick={results.loadMore} data-testid="compare-more">
              {results.loadingMore ? "Loading…" : `Show more (${formatCount(Math.max(0, matching - rows.length))} not loaded yet)`}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
