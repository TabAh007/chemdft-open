"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalculationDetail } from "@chemdft/schemas";
import { cancelCalculation, getCalculation, listComputeJobs } from "./structure-workspace-api";
import { forgetSubmission, recallSubmission, rememberSubmission } from "./guided-draft";
import { guidedJobPollMs, presentGuidedJob, type GuidedJobView } from "./guided-job-status";
import { jobPhase } from "./job-view";

export type JobConnection = "idle" | "loading" | "live" | "stale";

/**
 * The one place Guided mode reads a submitted calculation. It follows the persisted calculation +
 * compute-job records only (never form-local state), restores them after a reload, ignores responses
 * that arrive out of order, backs off while the network is failing, pauses while the tab is hidden and
 * stops once the record is terminal. Changes of state notify the Explorer/Overview so they never keep
 * showing the state recorded at submission time.
 */
export function useGuidedJob(params: { projectId: string; versionId: string | null; canWrite: boolean }) {
  const { projectId, versionId, canWrite } = params;
  const [calculationId, setCalculationId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CalculationDetail | null>(null);
  const [connection, setConnection] = useState<JobConnection>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [restoring, setRestoring] = useState(true);
  const sequence = useRef(0);
  const lastSignature = useRef<string | null>(null);
  const failures = useRef(0);
  const refetchRef = useRef<() => void>(() => {});

  // Restore after a reload: the remembered submission for this version, else the newest active job.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setDetail(null); setCalculationId(null); setError(null); setCancelError(null); setConnection("idle");
      lastSignature.current = null; failures.current = 0;
      if (!versionId) { setRestoring(false); return; }
      const remembered = recallSubmission(projectId, versionId);
      if (remembered) { setCalculationId(remembered); setRestoring(false); return; }
      setRestoring(true);
      void listComputeJobs(projectId).then((output) => {
        if (!active) return;
        const live = output.jobs
          .filter((job) => jobPhase(job).active)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
        if (live) setCalculationId(live.calculation_id);
      }).catch(() => {}).finally(() => { if (active) setRestoring(false); });
    });
    return () => { active = false; };
  }, [projectId, versionId]);

  const view: GuidedJobView | null = useMemo(
    () => (detail ? presentGuidedJob(detail, { nowMs: now, canWrite }) : null),
    [detail, now, canWrite],
  );
  const terminal = view?.terminal ?? false;

  // Follow the record.
  useEffect(() => {
    if (!calculationId) return;
    let alive = true;
    let timer: number | undefined;
    const run = async () => {
      window.clearTimeout(timer);
      const mine = ++sequence.current;
      if (!alive) return;
      setConnection((current) => (current === "idle" ? "loading" : current));
      try {
        const next = await getCalculation({ projectId, calculationId });
        if (!alive || mine !== sequence.current) return; // a newer request owns the screen
        failures.current = 0;
        setDetail(next); setConnection("live"); setError(null); setLastFetchedAt(Date.now());
        const signature = `${next.calculation.state}|${next.compute_job?.state ?? ""}|${next.compute_job?.latest_execution?.state ?? ""}`;
        if (lastSignature.current !== null && lastSignature.current !== signature) {
          window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
        }
        lastSignature.current = signature;
        const next$ = guidedJobPollMs(presentGuidedJob(next, { nowMs: Date.now(), canWrite }), document.visibilityState !== "hidden", 0);
        if (next$ !== null) timer = window.setTimeout(() => { void run(); }, next$);
      } catch (cause) {
        if (!alive || mine !== sequence.current) return;
        failures.current += 1;
        setConnection("stale");
        setError(cause instanceof Error ? cause.message : "The job record could not be read.");
        const retry = guidedJobPollMs(null, document.visibilityState !== "hidden", failures.current);
        if (retry !== null) timer = window.setTimeout(() => { void run(); }, retry);
      }
    };
    refetchRef.current = () => { void run(); };
    void run();
    const wake = () => { if (document.visibilityState !== "hidden") void run(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [projectId, calculationId, canWrite]);

  // Elapsed runtime ticks locally only between confirmed fetches, and only while a worker is executing.
  const running = view?.key === "running" && view.executionState !== null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const track = useCallback((next: CalculationDetail) => {
    if (versionId) rememberSubmission(projectId, versionId, next.calculation.id);
    sequence.current += 1;
    lastSignature.current = `${next.calculation.state}|${next.compute_job?.state ?? ""}|${next.compute_job?.latest_execution?.state ?? ""}`;
    setDetail(next); setCalculationId(next.calculation.id); setConnection("live"); setError(null); setLastFetchedAt(Date.now());
    window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
  }, [projectId, versionId]);

  const cancel = useCallback(async () => {
    if (!calculationId) return;
    setCancelError(null);
    try {
      const next = await cancelCalculation({ projectId, calculationId });
      sequence.current += 1;
      setDetail(next);
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
      refetchRef.current();
    } catch (cause) {
      setCancelError(cause instanceof Error ? cause.message : "Cancellation failed.");
    }
  }, [projectId, calculationId]);

  /** Leave a finished job behind so a new draft can be submitted. Never touches the job record. */
  const dismiss = useCallback(() => {
    if (versionId) forgetSubmission(projectId, versionId);
    sequence.current += 1;
    setDetail(null); setCalculationId(null); setConnection("idle"); setError(null); setCancelError(null);
    lastSignature.current = null;
  }, [projectId, versionId]);

  return { detail, view, terminal, connection, error, cancelError, lastFetchedAt, restoring, track, cancel, dismiss, refetch: () => refetchRef.current() };
}
