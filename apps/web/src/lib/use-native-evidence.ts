"use client";

import { useEffect, useState } from "react";
import type { CalculationDetail, JobLogOutput } from "@chemdft/schemas";
import { getJobDiagnostics, getJobLog } from "./analysis-api";
import { boundScfEvidence, resultLogArtifact } from "./scientific-result-presentation";

export type NativeEvidence =
  | { status: "loading" }
  | { status: "none" }                       // no native log applies to this result (engine/type)
  | { status: "unverified"; message: string } // a log exists but could not be bound to this result
  | { status: "ready"; log: JobLogOutput; evidence: ReturnType<typeof boundScfEvidence> };

/**
 * Reads the native log bound to exactly this published result and attempt (hash and artifact checked), and parses the
 * display-only quantities. Mirrors the workspace summary's read; any mismatch is "unverified", never guessed.
 * `enabled` lets the page read the log only once the Native evidence section is opened.
 */
export function useNativeEvidence(projectId: string, detail: CalculationDetail, enabled: boolean): NativeEvidence {
  const key = `${projectId}:${detail.calculation.id}:${detail.result?.id}:${detail.attempt?.id}:${detail.calculation_input_hash}`;
  const jobId = detail.compute_job?.id;
  const applicable = Boolean(jobId) && detail.calculation.project_id === projectId && detail.result?.producer_software.name === "pyscf";
  const [load, setLoad] = useState<{ key: string; value: NativeEvidence } | null>(null);
  useEffect(() => {
    if (!enabled || !applicable || !jobId) return;
    let alive = true;
    void (async (): Promise<NativeEvidence> => {
      const diagnostics = await getJobDiagnostics(projectId, jobId);
      const artifact = resultLogArtifact(detail, diagnostics);
      if (!artifact) return { status: "none" };
      const log = await getJobLog(projectId, jobId, artifact.artifact_id);
      if (log.sha256 !== artifact.sha256 || log.artifact_id !== artifact.artifact_id || log.attempt_id !== detail.attempt?.id) throw new Error("Native log binding mismatch");
      return { status: "ready", log, evidence: boundScfEvidence(detail, log) };
    })().then((value) => { if (alive) setLoad({ key, value }); })
      .catch(() => { if (alive) setLoad({ key, value: { status: "unverified", message: "Native evidence could not be verified. Reload to retry; stored artifacts remain available through authorized downloads." } }); });
    return () => { alive = false; };
    // The immutable result/attempt key controls this read; detail identity changes alone need no new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, jobId, enabled, applicable, projectId]);
  if (!applicable) return { status: "none" };
  return load?.key === key ? load.value : { status: "loading" };
}
