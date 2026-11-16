"use client";

import type { ComputeJobView } from "@chemdft/schemas";
import { AppIcon, StatusTag } from "@chemdft/ui";

import { filterCounts, JOB_FILTERS, PAGE_SIZE, type JobFilter } from "@/lib/job-model";
import { describeSpecification, describeWorkload, formatRuntime, formatShortTime, formatTimestamp, jobFailure, jobPhase, jobRuntimeSeconds, providerLabel } from "@/lib/job-view";
import styles from "./jobs.module.css";

function runtimeText(job: ComputeJobView, now: number): string {
  const seconds = jobRuntimeSeconds(job, now);
  return seconds === null ? "not started" : formatRuntime(seconds);
}

export type LibraryProps = {
  jobs: readonly ComputeJobView[] | null;
  shown: readonly ComputeJobView[];
  limit: number;
  selectedId: string | null;
  now: number;
  filter: JobFilter;
  provider: string | null;
  providers: readonly string[];
  q: string;
  loadError: boolean;
  onFilter: (filter: JobFilter) => void;
  onProvider: (provider: string | null) => void;
  onSearch: (q: string) => void;
  onSelect: (jobId: string) => void;
  onMore: () => void;
  /** Server paging (0.0.18): the matches held, the server's count of all matches, and a loader for the next page. */
  server?: { total: number; loadingMore: boolean; onLoadMore: () => void } | null;
};

/** Left pane: search, state and provider chips with counts, and one compact row per job. */
export function JobsLibrary(props: LibraryProps) {
  const { jobs, shown, limit, selectedId, now, filter, provider, providers, q } = props;
  const counts = jobs && !props.server ? filterCounts(jobs) : null; // loaded jobs are not the whole project under server paging
  const visible = props.server ? shown : shown.slice(0, limit);
  return (
    <section className={`${styles.panel} ${styles.library}`} aria-label="Job library" data-testid="jobs-library">
      <div className={styles.libraryHead}>
        <label className={styles.search}>
          <span className={styles.visuallyHidden}>Search jobs</span>
          <AppIcon icon="search" />
          <input type="search" value={q} placeholder="Structure, formula, method, job id" onChange={(event) => props.onSearch(event.currentTarget.value)} data-testid="jobs-search" />
        </label>
        <div className={styles.chips} role="group" aria-label="Filter by state">
          {JOB_FILTERS.map((entry) => (
            <button key={entry.key} type="button" className={styles.chip} aria-pressed={filter === entry.key} data-filter={entry.key} data-testid="jobs-filter-chip" onClick={() => props.onFilter(entry.key)}>
              {entry.label}{counts ? <span className={styles.chipCount}> {counts[entry.key]}</span> : null}
            </button>
          ))}
        </div>
        {providers.length > 1 ? (
          <div className={styles.chips} role="group" aria-label="Filter by provider" data-testid="jobs-provider-filter">
            <button type="button" className={styles.chip} aria-pressed={provider === null} onClick={() => props.onProvider(null)}>Any provider</button>
            {providers.map((name) => (
              <button key={name} type="button" className={styles.chip} aria-pressed={provider === name} data-provider={name} onClick={() => props.onProvider(provider === name ? null : name)}>{providerLabel(name)}</button>
            ))}
          </div>
        ) : null}
        <p className={styles.tally} role="status" aria-live="polite">
          {jobs && props.server ? <>Showing <strong>{shown.length}</strong> of <strong>{props.server.total}</strong> matching</>
            : jobs ? <>Showing <strong>{Math.min(limit, shown.length)}</strong> of <strong>{shown.length}</strong> matching · {jobs.length} job{jobs.length === 1 ? "" : "s"} in the project</> : "Loading…"}
        </p>
      </div>

      <div className={styles.listScroll}>
        {jobs === null ? <p className={styles.empty} role="status">{props.loadError ? "Jobs could not be loaded." : "Loading compute jobs…"}</p>
          : jobs.length === 0 && !(props.server && (filter !== "all" || provider || q.trim())) ? <p className={styles.empty}>No compute jobs yet. Jobs appear after a calculation passes validation, authorization and budget policy.</p>
          : shown.length === 0 ? <p className={styles.empty}>No jobs match these filters.</p>
          : (
            <ul className={styles.rows} data-testid="jobs-table">
              {visible.map((job) => {
                const workload = describeWorkload(job.workload.workload_type);
                const phase = jobPhase(job);
                const failure = jobFailure(job);
                const structure = job.structure_summary;
                return (
                  <li key={job.id} data-testid="job-row" data-job-id={job.id} data-job-state={job.state} data-selected={job.id === selectedId}>
                    <button type="button" className={styles.row} aria-current={job.id === selectedId ? "true" : undefined} onClick={() => props.onSelect(job.id)} data-testid="job-select">
                      <span className={styles.rowTop}>
                        <span className={styles.state}>
                          {phase.key === "running" || phase.key === "leased" ? <i className={styles.pulse} aria-hidden="true" /> : null}
                          <StatusTag intent={phase.intent}>{phase.label}</StatusTag>
                        </span>
                        <span className={styles.provider} data-testid="job-row-provider">{providerLabel(job.provider)}</span>
                      </span>
                      <span className={styles.rowTitle}>{workload.task}{workload.task.includes(workload.engine) ? null : <span className={styles.muted}> · {workload.engine}</span>}</span>
                      <span className={styles.rowSub}>
                        {structure?.structure_name ? <><strong className={styles.ink}>{structure.structure_name}</strong>{structure.formula_hill ? <> · <span className={styles.formula}>{structure.formula_hill}</span></> : null}</> : <span>Structure not recorded</span>}
                      </span>
                      <span className={styles.rowSub} data-testid="job-specification">{describeSpecification(job.specification_summary)}</span>
                      {failure ? <span className={styles.rowFailure} data-testid="job-row-failure">{failure}</span> : null}
                      <span className={styles.rowMeta}>
                        <span className={styles.num}>{runtimeText(job, now)}</span>
                        <time dateTime={job.created_at} title={formatTimestamp(job.created_at)}>{formatShortTime(job.created_at)}</time>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        {props.server && shown.length < props.server.total ? (
          <div className={styles.moreRow}>
            <button type="button" className={styles.secondaryAction} disabled={props.server.loadingMore} onClick={props.server.onLoadMore} data-testid="jobs-load-more">
              {props.server.loadingMore ? "Loading…" : `Load more (${props.server.total - shown.length} not loaded)`}
            </button>
          </div>
        ) : null}
        {!props.server && shown.length > limit ? (
          <div className={styles.moreRow}>
            <button type="button" className={styles.secondaryAction} onClick={props.onMore} data-testid="jobs-more">Show more ({Math.min(PAGE_SIZE, shown.length - limit)} of {shown.length - limit} not shown)</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
