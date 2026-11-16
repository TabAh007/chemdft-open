"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Locale } from "@chemdft/i18n";
import type { ComputeJobView, QueueStatus } from "@chemdft/schemas";
import { ActionButton, AppIcon, StatusTag } from "@chemdft/ui";

import { anyJobActive, JOB_POLL_MS, jobPhase } from "@/lib/job-view";
import {
  defaultJobId, EMPTY_QUERY, filterJobs, PAGE_SIZE, parseJobsQuery, providersIn, serializeJobsQuery, type JobFilter, type JobsQuery,
} from "@/lib/job-model";
import { useOverviewDock } from "@/lib/overview-dock";
import { useAiPageContext } from "@/lib/ai-context";
import {
  appendJobs, jobsListSearch, refreshLimit, SERVER_PAGE, serverFilterKey, serverFilterOf, supportsServerPaging,
} from "@/lib/job-paging";
import { cancelCalculation, listComputeJobsPage } from "@/lib/structure-workspace-api";
import { useProjectWriteAccess } from "@/lib/use-project-role";
import { getQueueStatus } from "@/lib/workflows-api";
import { ReuseDialog } from "../reuse-dialog";
import { useWorkspaceState } from "../workspace-state-provider";
import { JobInspector } from "./job-inspector";
import { JobsLibrary } from "./jobs-library";
import { QueueStrip } from "./queue-strip";
import styles from "./jobs.module.css";

const SPLIT_KEY = "chemdft:jobs:library-width";
const MIN_LIBRARY = 320;
const MIN_INSPECTOR = 440;

export function JobsWorkstation({ projectId, locale }: { projectId: string; locale: Locale }) {
  const { workspaceMode } = useWorkspaceState();
  useOverviewDock(projectId, workspaceMode); // the header AI Scientist toggle shows or hides the dock; Jobs never changes it
  const access = useProjectWriteAccess(projectId);

  const [jobs, setJobs] = useState<ComputeJobView[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reload, setReload] = useState(0);
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  // Server paging (0.0.18). "unknown" until the first answer; "legacy" = older server, filter client-side as before.
  const [mode, setMode] = useState<"unknown" | "server" | "legacy">("unknown");
  const [serverTotal, setServerTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [applied, setApplied] = useState("all||");
  const [pinned, setPinned] = useState<{ id: string; job: ComputeJobView | null } | null>(null);
  const [knownProviders, setKnownProviders] = useState<string[]>([]);
  const loadedRef = useRef(0);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reuse, setReuse] = useState<string | null>(null);
  const refresh = useCallback(() => setReload((value) => value + 1), []);

  // --- URL state: ?job= ?state= ?provider= ?q= ----------------------------------------------------------------------
  const [query, setQuery] = useState<JobsQuery>(EMPTY_QUERY);
  const [ready, setReady] = useState(false);
  const latest = useRef<JobsQuery>(EMPTY_QUERY);
  const [pane, setPane] = useState<"library" | "inspector">("library");
  useEffect(() => {
    const read = () => { latest.current = parseJobsQuery(window.location.search); setQuery(latest.current); setReady(true); };
    read();
    if (latest.current.job) queueMicrotask(() => setPane("inspector"));
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const navigate = useCallback((patch: Partial<JobsQuery>, mode: "push" | "replace") => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", `${window.location.pathname}${serializeJobsQuery(next)}`);
    setQuery(next);
  }, []);
  const select = useCallback((jobId: string) => { navigate({ job: jobId }, "push"); setPane("inspector"); }, [navigate]);

  // --- data: one cadence for the list and the queue strip --------------------------------------------------------------
  const filterKey = serverFilterKey(serverFilterOf(query));
  useEffect(() => { // typing in the search box asks the server once the researcher pauses
    if (!ready || mode === "legacy") return;
    const timer = window.setTimeout(() => setApplied(filterKey), mode === "unknown" ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [filterKey, ready, mode]);
  const appliedFilter = mode === "legacy" ? "all||" : mode === "unknown" ? filterKey : applied;
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const [phase, provider, ...rest] = appliedFilter.split("|");
    const filter = { phase: phase as JobFilter, provider: provider || null, q: rest.join("|") };
    void getQueueStatus(projectId).then((value) => { if (alive) setQueue(value); }).catch(() => { if (alive) setQueue(null); });
    void listComputeJobsPage(projectId, jobsListSearch({ limit: refreshLimit(loadedRef.current), offset: 0, ...filter })).then((response) => {
      if (!alive) return;
      if (supportsServerPaging(response)) {
        setMode("server");
        setServerTotal(response.total);
        setJobs([...response.jobs]); // the server's order (newest update first)
        loadedRef.current = response.jobs.length;
        setKnownProviders((held) => [...new Set([...held, ...response.jobs.map((job) => job.provider)])].sort());
      } else {
        setMode("legacy");
        setJobs([...response.jobs].sort((a, b) => b.created_at.localeCompare(a.created_at)));
      }
      setMessage(null);
      setRefreshedAt(new Date());
      setNow(Date.now());
    }).catch((error: unknown) => {
      if (alive) setMessage(error instanceof Error ? error.message : "Unable to load compute jobs.");
    });
    return () => { alive = false; };
  }, [projectId, reload, ready, appliedFilter]);
  async function loadMore() {
    setLoadingMore(true);
    try {
      const [phase, provider, ...rest] = appliedFilter.split("|");
      const response = await listComputeJobsPage(projectId, jobsListSearch({ limit: SERVER_PAGE, offset: loadedRef.current, phase: phase as JobFilter, provider: provider || null, q: rest.join("|") }));
      if (supportsServerPaging(response)) {
        setServerTotal(response.total);
        setJobs((held) => { const next = appendJobs(held ?? [], response.jobs); loadedRef.current = next.length; return next; });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load more jobs.");
    } finally {
      setLoadingMore(false);
    }
  }
  // A job named in the URL that is not on a loaded page is fetched by id, so the selection survives paging and filters.
  const urlJob = query.job;
  useEffect(() => {
    if (mode !== "server" || !urlJob || jobs === null || jobs.some((job) => job.id === urlJob) || pinned?.id === urlJob) return;
    let alive = true;
    void listComputeJobsPage(projectId, jobsListSearch({ limit: 1, offset: 0, phase: "all", provider: null, q: urlJob }))
      .then((response) => { if (alive) setPinned({ id: urlJob, job: response.jobs.find((job) => job.id === urlJob) ?? null }); })
      .catch(() => { if (alive) setPinned({ id: urlJob, job: null }); });
    return () => { alive = false; };
  }, [mode, urlJob, jobs, pinned, projectId]);
  const active = jobs !== null && anyJobActive(jobs);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, JOB_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  async function cancel(job: ComputeJobView) {
    setCancelling(job.id);
    try {
      await cancelCalculation({ projectId, calculationId: job.calculation_id });
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cancellation failed.");
    } finally {
      setCancelling(null);
    }
  }

  // --- derived list ---------------------------------------------------------------------------------------------------
  const shown = useMemo(() => (mode === "server" ? (jobs ?? []) : filterJobs(jobs ?? [], query)), [jobs, query, mode]);
  const providers = useMemo(() => (mode === "server" ? knownProviders : providersIn(jobs ?? [])), [jobs, mode, knownProviders]);
  const signature = `${query.filter}|${query.provider ?? ""}|${query.q}`;
  const [paging, setPaging] = useState({ signature: "", limit: PAGE_SIZE });
  const limit = paging.signature === signature ? paging.limit : PAGE_SIZE;
  const selectedId = query.job ?? defaultJobId(shown);
  const pinnedJob = pinned && pinned.id === selectedId ? pinned.job : null;
  const selected = jobs?.find((job) => job.id === selectedId) ?? pinnedJob;
  const lookupPending = mode === "server" && query.job !== null && pinned?.id !== query.job;
  const missing = jobs !== null && query.job !== null && selected === null && !lookupPending;
  // The selected job id is published; the server reads the stored job record (never logs).
  useAiPageContext(projectId, selected
    ? { page: "job", label: `Compute Jobs · job ${selected.id.slice(0, 8)}`, jobId: selected.id }
    : { page: "project", section: "jobs", label: "Compute Jobs" });
  const counts = useMemo(() => ({ total: mode === "server" && query.filter === "all" && !query.provider && !query.q.trim() ? serverTotal : (jobs?.length ?? 0), running: (jobs ?? []).filter((job) => jobPhase(job).active).length }), [jobs, mode, serverTotal, query]);

  // --- split pane (same keyboard-operable divider as Compare) ----------------------------------------------------------
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
  const bounds = useMemo(() => ({ min: MIN_LIBRARY, max: Math.max(MIN_LIBRARY, total - MIN_INSPECTOR - 10) }), [total]);
  const defaultWidth = Math.round(Math.min(Math.max(total * 0.34, 340), 460));
  const effectiveWidth = Math.min(Math.max(libraryWidth ?? defaultWidth, bounds.min), bounds.max);
  const setWidth = useCallback((width: number) => {
    const next = Math.round(Math.min(Math.max(width, bounds.min), bounds.max));
    setLibraryWidth(next);
    try { localStorage.setItem(SPLIT_KEY, String(next)); } catch { /* optional convenience */ }
  }, [bounds]);
  const reset = () => { setLibraryWidth(null); try { localStorage.removeItem(SPLIT_KEY); } catch { /* optional */ } };
  const onDividerKey = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowLeft") { event.preventDefault(); setWidth(effectiveWidth - step); }
    else if (event.key === "ArrowRight") { event.preventDefault(); setWidth(effectiveWidth + step); }
    else if (event.key === "Home") { event.preventDefault(); setWidth(bounds.min); }
    else if (event.key === "End") { event.preventDefault(); setWidth(bounds.max); }
    else if (event.key === "Enter") { event.preventDefault(); reset(); }
  };

  return (
    <div className={`jobs-page ${styles.page}`} data-testid="jobs-workstation">
      <header className={styles.pageHead}>
        <h1>Jobs</h1>
        <StatusTag>{counts.total} job{counts.total === 1 ? "" : "s"}{counts.running > 0 ? ` · ${counts.running} active` : ""}</StatusTag>
        <span className={styles.spacer} />
        <span className={styles.updated} role="status" aria-live="polite">
          {refreshedAt ? `Updated ${refreshedAt.toLocaleTimeString()}` : "Loading…"}{active ? " · refreshing every 3 s while jobs are active" : ""}
        </span>
        <ActionButton small minimal icon="refresh" text="Refresh" onClick={refresh} data-testid="jobs-refresh" />
        <Link className={styles.link} href={`/${locale}/projects/${projectId}/workspace`}>Back to workspace</Link>
      </header>

      {queue ? <QueueStrip queue={queue} onSelectJob={select} /> : null}

      {message ? (
        <div className={styles.notice} data-intent="danger" role="alert" data-testid="jobs-error">
          <AppIcon icon="warning-sign" /> <span>{message}</span> <button type="button" className={styles.link} onClick={refresh}>Retry</button>
        </div>
      ) : null}

      <div className={styles.paneSwitch} role="group" aria-label="Show">
        <button type="button" aria-pressed={pane === "library"} onClick={() => setPane("library")}>Jobs</button>
        <button type="button" aria-pressed={pane === "inspector"} onClick={() => setPane("inspector")} data-testid="jobs-pane-inspector">Details</button>
      </div>

      <div ref={splitRef} className={styles.split} data-pane={pane} data-testid="jobs-split" style={{ "--jobs-library-w": total ? `${effectiveWidth}px` : "36%" } as React.CSSProperties}>
        <JobsLibrary
          jobs={jobs} shown={shown} limit={limit} selectedId={selectedId} now={now} filter={query.filter} provider={query.provider}
          providers={providers} q={query.q} loadError={message !== null}
          onFilter={(filter: JobFilter) => navigate({ filter }, "replace")} onProvider={(provider) => navigate({ provider }, "replace")}
          onSearch={(q) => navigate({ q }, "replace")} onSelect={select}
          onMore={() => setPaging({ signature, limit: limit + PAGE_SIZE })}
          server={mode === "server" ? { total: serverTotal, loadingMore, onLoadMore: () => void loadMore() } : null}
        />
        <div
          className={styles.divider} role="separator" aria-orientation="vertical" tabIndex={0} aria-label="Resize the job library"
          aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={effectiveWidth} data-dragging={dragging} data-testid="jobs-divider"
          onKeyDown={onDividerKey} onDoubleClick={reset}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
          onPointerMove={(event) => { if (!dragging || !splitRef.current) return; setWidth(event.clientX - splitRef.current.getBoundingClientRect().left - 5); }}
          onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); }}
          onPointerCancel={() => setDragging(false)}
        />
        <section className={`${styles.panel} ${styles.inspectorPane}`} aria-label="Job details" data-testid="jobs-inspector-pane">
          {!ready || jobs === null ? <p className={styles.empty} role="status">{message ? "Jobs could not be loaded." : "Reading jobs…"}</p>
            : missing ? <div className={styles.empty} role="alert" data-testid="job-missing"><p><strong>This job is not in this project.</strong></p><p className={styles.muted}>It may have been removed, or you may not have access. Choose a job from the list.</p></div>
            : selected ? (
              <JobInspector
                key={selected.id} projectId={projectId} locale={locale} job={selected} now={now} canWrite={access.canWrite}
                cancelling={cancelling === selected.id} onCancel={() => void cancel(selected)} onReuse={() => setReuse(selected.calculation_id)}
              />
            ) : jobs.length === 0 ? (
              <div className={styles.empty} data-testid="jobs-explainer">
                <p>Real compute jobs created by authorized calculation submissions. Results appear in the workspace only after the engine output is validated.</p>
                <Link className={styles.link} href={`/${locale}/projects/${projectId}/workspace`}>Prepare a calculation in the workspace</Link>
              </div>
            ) : <div className={styles.empty}><p>Select a job to see where it ran, its estimate and reservation, and its execution record.</p></div>}
        </section>
      </div>
      {reuse ? <ReuseDialog projectId={projectId} locale={locale} calculationId={reuse} onClose={() => setReuse(null)} /> : null}
    </div>
  );
}
