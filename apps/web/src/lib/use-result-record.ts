"use client";

import { useEffect, useState } from "react";
import type { CalculationDetail, CalculationResult, StructureVersionDetail } from "@chemdft/schemas";
import { calculationInputStructure } from "./calculation-result-association";
import { getCalculation, getResult } from "./structure-workspace-api";

export type RecordFailure = "forbidden" | "missing" | "mismatch" | "error";

export type ResultRecord =
  | { status: "loading" }
  | { status: "failed"; kind: RecordFailure; message: string }
  | {
      status: "ready";
      result: CalculationResult;
      detail: CalculationDetail;
      /** The hash-verified immutable input; null (with a reason) when it could not be resolved. The page says so. */
      input: StructureVersionDetail | null;
      inputError: string | null;
    };

export function failureKind(message: string): RecordFailure {
  if (/access|forbidden|permission|not authori[sz]ed|sign in/i.test(message)) return "forbidden";
  if (/not found|does not exist|no longer available/i.test(message)) return "missing";
  return "error";
}

/**
 * Loads one published result exactly as the workspace does: the result (with its read-time effective state), the
 * calculation that produced it, and the immutable input resolved from the hash-bound artifact. A response that does
 * not provably belong to this project and result is refused.
 */
export function useResultRecord(projectId: string, resultId: string): ResultRecord {
  const key = `${projectId}:${resultId}`;
  const [state, setState] = useState<{ key: string; record: ResultRecord } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async (): Promise<ResultRecord> => {
      const result = await getResult(projectId, resultId);
      if (result.id !== resultId || result.project_id !== projectId) return { status: "failed", kind: "mismatch", message: "The requested result does not belong to this project." };
      const detail = await getCalculation({ projectId, calculationId: result.calculation_id });
      if (detail.result?.id !== resultId || detail.calculation.project_id !== projectId || detail.result.calculation_id !== detail.calculation.id) {
        return { status: "failed", kind: "mismatch", message: "The result and its calculation record do not match; nothing is shown." };
      }
      let input: StructureVersionDetail | null = null;
      let inputError: string | null = null;
      try { input = await calculationInputStructure(projectId, detail); }
      catch (cause) { inputError = cause instanceof Error ? cause.message : "The immutable input could not be loaded."; }
      return { status: "ready", result, detail, input, inputError };
    })().then((record) => { if (alive) setState({ key, record }); })
      .catch((cause: unknown) => {
        if (!alive) return;
        const message = cause instanceof Error ? cause.message : "The result could not be loaded.";
        setState({ key, record: { status: "failed", kind: failureKind(message), message } });
      });
    return () => { alive = false; };
  }, [key, projectId, resultId]);
  return state?.key === key ? state.record : { status: "loading" };
}
