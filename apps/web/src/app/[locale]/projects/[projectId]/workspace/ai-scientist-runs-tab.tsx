"use client";

import { plural } from "@/lib/overview-model";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AIRunView, CalculationDetail } from "@chemdft/schemas";
import { AppIcon, type IconName } from "@chemdft/ui";
import { useOptionalWorkspaceState } from "@/app/_components/workspace-state-provider";
import { getCalculation, cancelCalculation } from "@/lib/structure-workspace-api";
import {
  buildRunTimeline,
  calculationNeedsPolling,
  RUN_PHASE_LABEL,
  runMatchesFilter,
  type RunFilter,
  type RunTimelineItem,
  type RunTimelinePhase,
} from "@/lib/ai-run-timeline";

export const RUN_POLL_INTERVAL_MS = 4000;
const MAX_CALCULATIONS_READ = 50;
const READ_CONCURRENCY = 4;
const FILTERS: RunFilter[] = ["All", "Active", "Completed", "Failed", "Planning"];

interface AIScientistRunsTabProps {
  projectId?: string;
  runs?: AIRunView[];
  activeRun?: AIRunView | null;
  onRefresh?: () => void;
  onOpenChat?: () => void;
  onViewResults?: (calculationId: string) => void;
  /** AI runs referenced by the current conversation (the coverage limit shown to the researcher). */
  conversationRunCount?: number;
}

const PHASE_TONE: Record<RunTimelinePhase, "running" | "completed" | "failed" | "draft"> = {
  AI_PLANNING: "running", AWAITING_APPROVAL: "draft", PAUSED: "draft", WAITING_FOR_CALCULATION: "running",
  PLANNING_COMPLETE: "completed", DRAFT: "draft", QUEUED: "running", RUNNING: "running", COMPLETED: "completed",
  VALIDATED_RESULT: "completed", FAILED: "failed", CANCELED: "failed", LOADING: "draft",
};

const PHASE_ICON: Record<RunTimelinePhase, IconName> = {
  AI_PLANNING: "predictive-analysis", AWAITING_APPROVAL: "hand", PAUSED: "pause", WAITING_FOR_CALCULATION: "time",
  PLANNING_COMPLETE: "tick", DRAFT: "document", QUEUED: "time", RUNNING: "refresh", COMPLETED: "tick",
  VALIDATED_RESULT: "tick-circle", FAILED: "cross-circle", CANCELED: "disable", LOADING: "more",
};

/** Read calculation records with bounded concurrency; failures leave the record unread. */
async function readCalculations(projectId: string, ids: string[], onRead: (id: string, detail: CalculationDetail) => void) {
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      if (!id) continue;
      try { onRead(id, await getCalculation({ projectId, calculationId: id })); } catch { /* retried on next refresh */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, ids.length) }, worker));
}

export function AIScientistRunsTab({
  projectId = "",
  runs = [],
  activeRun,
  onRefresh,
  onOpenChat,
  onViewResults,
  conversationRunCount,
}: AIScientistRunsTabProps) {
  const workspace = useOptionalWorkspaceState();
  const workspaceCatalog = workspace?.catalog;
  const [activeFilter, setActiveFilter] = useState<RunFilter>("All");
  const [details, setDetails] = useState<Record<string, CalculationDetail>>({});
  // Mirrors `details` synchronously so the poll scheduler sees the newest states.
  const detailsRef = useRef<Record<string, CalculationDetail>>({});
  const storeDetail = (id: string, detail: CalculationDetail) => {
    detailsRef.current = { ...detailsRef.current, [id]: detail };
    setDetails(detailsRef.current);
  };
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 7;

  const aiRuns = useMemo(() => {
    const all = [...runs];
    if (activeRun && !all.some((run) => run.id === activeRun.id)) all.push(activeRun);
    return all;
  }, [runs, activeRun]);

  const catalogCalculations = useMemo(
    () => (workspaceCatalog ?? [])
      .filter((entry) => entry.selection.kind === "calculation" && entry.selection.id)
      .map((entry) => ({ id: entry.selection.id, label: entry.label })),
    [workspaceCatalog],
  );

  const calculationIds = useMemo(() => {
    const ids = new Set(catalogCalculations.map((entry) => entry.id));
    for (const run of aiRuns) if (run.waiting_calculation_id) ids.add(run.waiting_calculation_id);
    return [...ids].slice(0, MAX_CALCULATIONS_READ);
  }, [catalogCalculations, aiRuns]);
  const calculationKey = calculationIds.join("|");

  // Read each record once; afterwards re-read only records whose state can still change.
  useEffect(() => {
    if (!projectId || calculationIds.length === 0) return;
    let alive = true;
    let timer: number | undefined;
    const store = (id: string, detail: CalculationDetail) => { if (alive) storeDetail(id, detail); };
    const schedule = () => {
      const active = calculationIds.filter((id) => calculationNeedsPolling(detailsRef.current[id]));
      if (!alive || active.length === 0) return;
      timer = window.setTimeout(async () => {
        await readCalculations(projectId, active, store);
        schedule();
      }, RUN_POLL_INTERVAL_MS);
    };
    const unread = calculationIds.filter((id) => !detailsRef.current[id]);
    void readCalculations(projectId, unread, store).then(schedule);
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
    // calculationKey captures the id list; detailsRef avoids restarting on every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, calculationKey]);

  const runItems = useMemo(
    () => buildRunTimeline({ projectId, catalogCalculations, calculationDetails: details, aiRuns }),
    [projectId, catalogCalculations, details, aiRuns],
  );

  const counts = useMemo(() => Object.fromEntries(
    FILTERS.map((filter) => [filter, runItems.filter((item) => runMatchesFilter(item, filter)).length]),
  ) as Record<RunFilter, number>, [runItems]);
  const filteredRuns = useMemo(() => runItems.filter((item) => runMatchesFilter(item, activeFilter)), [runItems, activeFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredRuns.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRuns = filteredRuns.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const refreshAll = () => {
    setActionError(null);
    if (projectId && calculationIds.length) void readCalculations(projectId, calculationIds, storeDetail);
    onRefresh?.();
  };

  const openCalculation = (calculationId: string, title: string) => {
    workspace?.openSelection({ kind: "calculation", projectId, id: calculationId }, title);
    onViewResults?.(calculationId);
  };

  const handleCancel = async (calculationId: string) => {
    if (!window.confirm("Cancel this queued or running calculation? This cannot be undone.")) return;
    setCancelingId(calculationId);
    setActionError(null);
    try {
      await cancelCalculation({ projectId, calculationId });
      storeDetail(calculationId, await getCalculation({ projectId, calculationId }));
      onRefresh?.();
    } catch (error) {
      setActionError(error instanceof Error ? `Cancellation failed: ${error.message}` : "Cancellation failed.");
    } finally {
      setCancelingId(null);
    }
  };

  return (
    <div className="ai-runs-view-container" data-testid="ai-runs-view">
      <div className="ai-runs-intro-header">
        <div className="ai-runs-title-row">
          <h3 className="ai-runs-heading">Run history</h3>
          <button type="button" className="ai-runs-refresh-btn" onClick={refreshAll} title="Refresh runs"
            aria-label="Refresh runs" data-testid="ai-runs-refresh-btn">
            <AppIcon icon="refresh" />
          </button>
        </div>
        <p className="ai-runs-subtitle">
          AI planning and scientific calculations are separate records. Energies appear only for results that pass the Result Firewall.
        </p>
        <p className="ai-runs-coverage" data-testid="ai-runs-coverage">
          Showing {conversationRunCount ?? aiRuns.length} AI {(conversationRunCount ?? aiRuns.length) === 1 ? "run" : "runs"} from the current conversation and
          {" "}{calculationIds.length} calculation {calculationIds.length === 1 ? "record" : "records"} saved in this project.
          AI runs from earlier conversations are not listed; their calculations still appear as calculation records.
        </p>
      </div>

      <div className="ai-runs-filter-chips" role="group" aria-label="Filter runs">
        {FILTERS.map((filter) => (
          <button key={filter} type="button" className={`ai-filter-chip ${activeFilter === filter ? "active" : ""}`}
            onClick={() => { setActiveFilter(filter); setPage(1); }} aria-pressed={activeFilter === filter}
            data-testid={`ai-runs-filter-${filter.toLowerCase()}`}>
            <span>{filter}</span>
            <span className="ai-chip-count">({counts[filter]})</span>
          </button>
        ))}
      </div>

      {actionError ? <p className="ai-runs-action-error" role="alert">{actionError}</p> : null}

      <div className="ai-runs-timeline-list">
        {pagedRuns.length === 0 ? (
          <div className="ai-runs-empty-state">
            <AppIcon icon="history" />
            <p className="ai-runs-empty-title">{runItems.length === 0 ? "No runs yet" : "No runs match this filter"}</p>
            <p className="ai-runs-empty-desc">
              AI planning runs from this conversation and calculation records saved in this project appear here.
            </p>
          </div>
        ) : pagedRuns.map((item) => (
          <RunCard key={item.key} item={item} canceling={cancelingId === item.calculationId}
            onOpenCalculation={openCalculation} onCancel={handleCancel} {...(onOpenChat ? { onOpenChat } : {})} />
        ))}
      </div>

      {totalPages > 1 ? (
        <div className="ai-runs-pagination">
          <button type="button" className="ai-page-btn" disabled={currentPage <= 1}
            onClick={() => setPage(Math.max(1, currentPage - 1))} aria-label="Previous page">
            <AppIcon icon="chevron-left" />
          </button>
          {Array.from({ length: totalPages }).map((_, index) => (
            <button key={index} type="button" className={`ai-page-num ${currentPage === index + 1 ? "active" : ""}`}
              aria-current={currentPage === index + 1 ? "page" : undefined} onClick={() => setPage(index + 1)}>
              {index + 1}
            </button>
          ))}
          <button type="button" className="ai-page-btn" disabled={currentPage >= totalPages}
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))} aria-label="Next page">
            <AppIcon icon="chevron-right" />
          </button>
          <span className="ai-runs-total-count">{plural(filteredRuns.length, "run")}</span>
        </div>
      ) : null}
    </div>
  );
}

function RunCard({ item, canceling, onOpenCalculation, onCancel, onOpenChat }: {
  item: RunTimelineItem;
  canceling: boolean;
  onOpenCalculation: (calculationId: string, title: string) => void;
  onCancel: (calculationId: string) => void;
  onOpenChat?: () => void;
}) {
  const tone = PHASE_TONE[item.phase];
  const calculationId = item.calculationId;
  const cancellable = calculationId && (item.phase === "QUEUED" || item.phase === "RUNNING");
  const details = [item.engine, item.method].filter(Boolean).join(" • ");
  return (
    <div className="ai-run-timeline-item" data-testid={`ai-run-item-${item.id}`} data-phase={item.phase}>
      <div className="ai-timeline-node">
        <div className={`ai-timeline-circle status-${tone}`} />
        <div className="ai-timeline-line" />
      </div>
      <div className="ai-run-card">
        <div className="ai-run-thumb" aria-hidden="true">
          <AppIcon icon={item.kind === "AI_RUN" ? "predictive-analysis" : "application"} />
        </div>
        <div className="ai-run-main-col">
          <div className="ai-run-header-line">
            <span className={`ai-run-status-pill status-${tone}`} data-testid="ai-run-phase">
              <AppIcon icon={PHASE_ICON[item.phase]} />
              <span>{RUN_PHASE_LABEL[item.phase]}</span>
            </span>
            <span className="ai-run-kind-label">{item.kind === "AI_RUN" ? "AI planning record" : "Calculation record"}</span>
          </div>
          <strong className="ai-run-title">{item.title}</strong>
          {details ? <p className="ai-run-engine-method">{details}</p> : null}
          {item.model ? <p className="ai-run-engine-method">Model: {item.model}</p> : null}
          {item.timestampLabel ? <p className="ai-run-timestamp">{item.timestampLabel}</p> : null}

          {item.energyText ? <p className="ai-run-energy-value" data-testid="ai-run-energy">Total energy {item.energyText}</p> : null}
          {item.resultSummary ? <p className="ai-run-result-note">{item.resultSummary}</p> : null}
          {item.phase === "FAILED" || item.phase === "CANCELED" ? (
            <p className="ai-run-error-msg">
              {item.errorMessage ?? (item.phase === "CANCELED" ? "Canceled" : "Failure reason unavailable")}
            </p>
          ) : null}
          {item.linkedCalculationId ? (
            <p className="ai-run-result-note">Linked calculation {item.linkedCalculationId.slice(0, 8)}</p>
          ) : null}

          <div className="ai-run-actions">
            {calculationId && item.phase !== "LOADING" ? (
              <button type="button" className="ai-run-view-results-btn" onClick={() => onOpenCalculation(calculationId, item.title)}>
                {item.phase === "FAILED" ? "View log" : item.phase === "VALIDATED_RESULT" || item.phase === "COMPLETED" ? "View results" : "Open calculation"}
              </button>
            ) : null}
            {cancellable ? (
              <button type="button" className="ai-run-cancel-btn" disabled={canceling} onClick={() => onCancel(calculationId)}>
                {canceling ? "Canceling…" : "Cancel"}
              </button>
            ) : null}
            {item.linkedCalculationId ? (
              <button type="button" className="ai-run-view-results-btn" onClick={() => onOpenCalculation(item.linkedCalculationId!, `Calculation ${item.linkedCalculationId!.slice(0, 8)}`)}>
                Open linked calculation
              </button>
            ) : null}
            {item.kind === "AI_RUN" && onOpenChat ? (
              <button type="button" className="ai-run-view-log-btn" onClick={onOpenChat}>Open in Chat</button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
