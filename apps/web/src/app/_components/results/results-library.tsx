"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "@chemdft/i18n";
import type { CalculationDetail, OverviewRow } from "@chemdft/schemas";
import { MAX_SELECTION, MIN_SELECTION } from "@/lib/comparison-view";
import { saveBlob } from "@/lib/download";
import {
  compareHref, jobsHref, savedComparisonHref, standingOf, standingText, taskLabel, verificationText, type SortDirection, type SortKey,
} from "@/lib/overview-view";
import { inspectorModel, type PrimaryOutput } from "@/lib/result-inspector-model";
import { emptyBreakdown, jobsPointerText, jobsSummary, libraryMode, resultDetailHref, rowLevel, rowPrimaryQuantity, type LibraryMode } from "@/lib/results-model";
import { usePublishedResults } from "@/lib/use-published-results";
import { useProjectWriteAccess } from "@/lib/use-project-role";
import { projectPath } from "@/lib/routes";
import { getCalculation } from "@/lib/structure-workspace-api";
import { downloadReport, type ReportFormat } from "@/lib/workflows-api";
import { ReuseDialog } from "../reuse-dialog";
import { useOverviewDock } from "@/lib/overview-dock";
import { useAiPageContext } from "@/lib/ai-context";
import { useWorkspaceState } from "../workspace-state-provider";
import { ScientificTimestamp } from "../scientific-timestamp";
import { FormulaText } from "../projects/structure-thumbnail";
import { PrimaryReadout, Tag } from "./results-parts";
import { ResultsTable } from "./results-table";
import styles from "./results-ui.module.css";

/** Convergence (and units) for the one featured result: read from the stored result, never assumed. */
function useFeaturedDetail(projectId: string, row: OverviewRow | null): PrimaryOutput | null | "loading" {
  const key = row?.result_id ? `${projectId}:${row.calculation_id}` : null;
  const [state, setState] = useState<{ key: string; output: PrimaryOutput | null } | null>(null);
  useEffect(() => {
    if (!key || !row) return;
    let alive = true;
    void getCalculation({ projectId, calculationId: row.calculation_id })
      .then((detail: CalculationDetail) => { if (alive) setState({ key, output: inspectorModel(detail, null).primary }); })
      .catch(() => { if (alive) setState({ key, output: null }); });
    return () => { alive = false; };
  }, [key, projectId, row]);
  if (!key) return null;
  return state?.key === key ? state.output : "loading";
}

function FeaturedResult({ row, locale, projectId, onReuse, canWrite }: { row: OverviewRow; locale: Locale; projectId: string; onReuse: (id: string) => void; canWrite: boolean | null }) {
  const quantity = rowPrimaryQuantity(row);
  const detail = useFeaturedDetail(projectId, row);
  const level = rowLevel(row);
  const standing = standingOf(row);
  const inspect = resultDetailHref(locale, projectId, row.result_id!);
  const structure = [row.structure_name, row.structure_revision ? `V${row.structure_revision}` : null].filter(Boolean).join(" · ") || "structure not recorded";
  return (
    <section className={`${styles.panel} ${styles.featured}`} aria-label="Published scientific result" data-testid="featured-result" data-standing={standing} data-result-id={row.result_id}>
      <div style={{ display: "grid", gap: 12 }}>
        <div className={styles.featuredTitle}>
          <h2>{taskLabel(row.task)}</h2>
          <span className={styles.muted}>{structure}{row.formula_hill ? <> · <FormulaText formula={row.formula_hill} /></> : null}</span>
        </div>
        {quantity ? (
          <PrimaryReadout
            label={quantity.label} valueText={quantity.valueText} unit={quantity.unit} note={quantity.note}
            derived={detail && detail !== "loading" ? detail.derived : null}
            convergence={detail && detail !== "loading" ? detail.convergence : undefined}
            exact={quantity.fullValueText}
          />
        ) : (
          <p className={styles.muted} data-testid="featured-no-quantity">No scalar quantity is stored for this result type; inspect it to see its viewer.</p>
        )}
      </div>
      <div className={styles.featuredAside}>
        <dl className={styles.kv} style={{ gridTemplateColumns: "auto minmax(0, 1fr)" }} data-testid="featured-facts">
          <dt>Method</dt><dd>{level.level}</dd>
          <dt>Engine</dt><dd>{level.engine}</dd>
          <dt>Electronic</dt><dd>{level.electronic}</dd>
          <dt>Standing</dt><dd>{standing === "current" ? <Tag intent="success">Current</Tag> : <Tag intent="warning">{standingText(row)}</Tag>} <span className={styles.caption}>{verificationText(row)}</span></dd>
          <dt>Updated</dt><dd className={styles.caption}><ScientificTimestamp value={row.updated_at} /></dd>
        </dl>
        <Link className={styles.primaryAction} href={inspect} data-testid="results-open">Inspect result</Link>
        <div className={styles.quick}>
          <Link className={styles.link} href={compareHref(locale, projectId, [row.result_id!])} data-testid="featured-compare">Compare</Link>
          <Link className={styles.link} href={resultDetailHref(locale, projectId, row.result_id!, "export")}>Export</Link>
          {row.job_id ? <Link className={styles.link} href={jobsHref(locale, projectId)}>Job</Link> : null}
          {canWrite === true ? <button type="button" className={styles.link} onClick={() => onReuse(row.calculation_id)} data-testid="results-reuse">Reuse settings</button> : null}
        </div>
      </div>
    </section>
  );
}

/** The one place Results points at calculations that produced no published result: a sentence and a link to Jobs. */
function JobsPointer({ text, locale, projectId }: { text: string | null; locale: Locale; projectId: string }) {
  if (!text) return null;
  return (
    <p className={styles.pointer} data-testid="jobs-pointer">
      <span>{text}</span>{" "}<Link className={styles.link} href={jobsHref(locale, projectId)} data-testid="jobs-pointer-link">View in Jobs</Link>
    </p>
  );
}

type Filters = { text: string; task: string; engine: string; standing: "all" | "current" | "historical" };
const NO_FILTERS: Filters = { text: "", task: "ALL", engine: "ALL", standing: "all" };

export function ResultsLibrary({ projectId, locale }: { projectId: string; locale: Locale }) {
  const { workspaceMode } = useWorkspaceState();
  useOverviewDock(projectId, workspaceMode); // the header AI Scientist toggle works on this page too (show/hide only)
  useAiPageContext(projectId, { page: "project", section: "results", label: "Results" });
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [typed, setTyped] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "updated", direction: "desc" });
  const [ticked, setTicked] = useState<string[]>([]);
  const [reuse, setReuse] = useState<string | null>(null);
  const [reportFormat, setReportFormat] = useState<ReportFormat>("html");
  const [notice, setNotice] = useState<string | null>(null);

  // Search is sent to the server a moment after typing stops.
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
  const { page, rows } = results;
  const access = useProjectWriteAccess(projectId);
  const summary = useMemo(() => jobsSummary(page), [page]);
  const mode: LibraryMode = results.error && !page ? "loading" : libraryMode(page);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS) || typed !== "";

  const toggleTick = useCallback((resultId: string) => setTicked((c) => c.includes(resultId) ? c.filter((x) => x !== resultId) : c.length >= MAX_SELECTION ? c : [...c, resultId]), []);
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((c) => ({ ...c, [key]: value }));
  const sortBy = (key: SortKey) => setSort((c) => ({ key, direction: c.key === key && c.direction === "asc" ? "desc" : "asc" }));
  const clearFilters = () => { setFilters(NO_FILTERS); setTyped(""); };

  async function report() {
    setNotice(null);
    try {
      const file = await downloadReport({ projectId, format: reportFormat, resultIds: ticked });
      saveBlob(file.blob, file.filename);
      setNotice(`Saved ${file.filename}.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The report could not be generated.");
    }
  }

  const saved = page?.saved_comparisons;
  const savedCount = saved?.availability === "NOT_ACTIVATED" ? 0 : (saved?.comparisons ?? []).length;
  const first = rows[0];
  const empty = page && mode === "empty" ? emptyBreakdown(summary) : null;
  const workspace = projectPath(locale, projectId, "workspace");
  const tasks = page?.facets.tasks ?? [];
  const engines = page?.facets.engines ?? [];

  return (
    <div className={styles.page} data-testid="results-library" data-mode={mode}>
      <header className={styles.head}>
        <div style={{ display: "grid", gap: 2 }}>
          <h1>Results</h1>
          <p>Published scientific results, their standing and the evidence behind them.</p>
        </div>
        <div className={styles.headActions}>
          <span className={styles.tag} data-testid="results-total">{page ? `${summary.published} published result${summary.published === 1 ? "" : "s"}` : "Loading…"}</span>
          {page ? <span className={styles.caption} data-testid="results-calculation-count">{summary.calculations} calculation record{summary.calculations === 1 ? "" : "s"} in this project</span> : null}
          {savedCount > 0 && saved?.comparisons?.[0] ? <Link className={styles.link} href={savedComparisonHref(locale, projectId, saved.comparisons[0].id)} data-testid="saved-link">Saved comparisons ({savedCount})</Link> : null}
        </div>
      </header>

      {results.error && !page ? <div className={styles.notice} data-intent="danger" role="alert" data-testid="results-error"><strong>Results could not be loaded</strong><span>{results.error}</span><span><button type="button" className={styles.secondaryAction} onClick={results.reload}>Retry</button></span></div> : null}
      {page ? <JobsPointer text={jobsPointerText(summary)} locale={locale} projectId={projectId} /> : null}
      {mode === "loading" && !results.error ? <div className={`${styles.panel} ${styles.panelPad}`} role="status" aria-busy="true">Reading this project&apos;s published results…</div> : null}

      {mode === "single" && first ? (
        <FeaturedResult row={first} locale={locale} projectId={projectId} onReuse={setReuse} canWrite={access.canWrite} />
      ) : null}

      {empty ? (
        <section className={`${styles.panel} ${styles.empty}`} aria-label="No published results" data-testid="results-empty" data-situation={summary.calculations === 0 ? "none" : summary.pending ? "pending" : summary.failed === summary.calculations ? "failed" : "no-result"}>
          <h2>{empty.headline}</h2>
          <p className={styles.muted}>{empty.detail}</p>
          <div className={styles.emptyActions}>
            <Link className={styles.primaryAction} href={workspace} data-testid="empty-workspace">{summary.calculations === 0 ? "Open the workspace" : "Back to the workspace"}</Link>
            <Link className={styles.secondaryAction} href={jobsHref(locale, projectId)} data-testid="empty-jobs">View jobs</Link>
          </div>
        </section>
      ) : null}

      {mode === "multiple" ? (
        <section className={styles.panel} aria-label="Published results">
          <div className={styles.toolbar} role="search">
            <label>Search <input type="search" value={typed} onChange={(e) => setTyped(e.currentTarget.value)} placeholder="Structure, method, id…" data-testid="results-search" /></label>
            <label>Task <select value={filters.task} onChange={(e) => setFilter("task", e.currentTarget.value)} data-testid="results-task"><option value="ALL">All</option>{tasks.map((t) => <option key={t} value={t}>{taskLabel(t)}</option>)}</select></label>
            <label>Engine <select value={filters.engine} onChange={(e) => setFilter("engine", e.currentTarget.value)} data-testid="results-engine"><option value="ALL">All</option>{engines.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            <label>Standing <select value={filters.standing} onChange={(e) => setFilter("standing", e.currentTarget.value as Filters["standing"])} data-testid="results-standing"><option value="all">All</option><option value="current">Current</option><option value="historical">Historical</option></select></label>
            <span role="status" aria-live="polite" data-testid="results-count">{results.loading ? "Updating…" : `${rows.length} of ${summary.matching} shown`}</span>
            <span className={styles.spacer} />
            {filtered ? <button type="button" className={styles.secondaryAction} onClick={clearFilters} data-testid="results-clear">Clear filters</button> : null}
          </div>
          <div className={styles.selectionBar} data-testid="results-actions">
            {ticked.length === 0 ? (
              <span className={styles.muted}>Tick results to compare ({MIN_SELECTION}–{MAX_SELECTION}) or to build a report.</span>
            ) : (
              <>
                <strong>{ticked.length} selected</strong>
                {ticked.length >= MIN_SELECTION && ticked.length <= MAX_SELECTION
                  ? <Link className={styles.primaryAction} style={{ minHeight: 30 }} href={compareHref(locale, projectId, ticked)} data-testid="results-compare">Compare {ticked.length} results</Link>
                  : <span className={styles.muted} data-testid="results-compare-hint">Select {MIN_SELECTION}–{MAX_SELECTION} results to compare</span>}
                <span className={styles.caption}>Compare checks that the selected results are scientifically comparable.</span>
                <span className={styles.spacer} />
                <label className={styles.muted}>Report{" "}
                  <select value={reportFormat} onChange={(e) => setReportFormat(e.currentTarget.value as ReportFormat)} data-testid="results-report-format" style={{ height: 30 }}>
                    <option value="html">HTML (with charts)</option><option value="markdown">Markdown</option><option value="json">JSON</option>
                  </select>
                </label>
                <button type="button" className={styles.secondaryAction} onClick={() => void report()} data-testid="results-report">Generate report</button>
                <button type="button" className={styles.link} onClick={() => setTicked([])}>Clear selection</button>
              </>
            )}
          </div>
          <div role="status" aria-live="polite" className={`${styles.caption}`} style={{ padding: notice ? "6px 12px" : 0 }} data-testid="results-notice">{notice ?? ""}</div>
          {results.error ? <div className={styles.notice} data-intent="danger" role="alert" data-testid="results-error"><strong>Results could not be loaded</strong><span>{results.error}</span><span><button type="button" className={styles.secondaryAction} onClick={results.reload}>Retry</button></span></div> : null}
          {rows.length === 0 && !results.loading && !results.error
            ? <p className={`${styles.muted} ${styles.panelPad}`}>No published result matches these filters.</p>
            : <ResultsTable rows={rows} locale={locale} projectId={projectId} sort={sort} onSort={sortBy} ticked={ticked} onTick={toggleTick} onReuse={setReuse} canWrite={access.canWrite} />}
          {results.hasMore ? <div className={styles.panelPad}><button type="button" className={styles.secondaryAction} disabled={results.loadingMore} onClick={results.loadMore} data-testid="results-more">{results.loadingMore ? "Loading…" : `Show more (${summary.matching - rows.length} remaining)`}</button></div> : null}
        </section>
      ) : null}

      {mode === "multiple" || mode === "single" ? <p className={styles.caption}>Values are the stored ones. Energies of different levels of theory are not comparable; sorting by value only orders the column.</p> : null}
      {reuse ? <ReuseDialog projectId={projectId} locale={locale} calculationId={reuse} onClose={() => setReuse(null)} /> : null}
    </div>
  );
}
