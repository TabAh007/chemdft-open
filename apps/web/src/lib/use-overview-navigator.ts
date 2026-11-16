"use client";

import { useEffect, useState } from "react";
import type { NavigatorState } from "@chemdft/schemas";
import { getNavigator, isAbortError, type NavigatorGoalId } from "./navigator-api";
import { isGoal } from "./onboarding-flow";

/**
 * Reads the server Navigator for the Overview with the same inputs, refresh triggers and polling as the Project Navigator
 * panel (goal, structure scope, workspace-change events, window focus, a 10 s poll while jobs run). It never submits
 * anything: it only reads the server's evaluation of what the recorded project allows.
 */
export type OverviewNavigator = {
  goal: NavigatorGoalId | "";
  setGoal: (goal: NavigatorGoalId | "") => void;
  state: NavigatorState | null;
  busy: boolean;
  error: boolean;
  refresh: () => void;
};

export function useOverviewNavigator(projectId: string, structureVersionId?: string): OverviewNavigator {
  const [goal, setGoal] = useState<NavigatorGoalId | "">("");
  const [state, setState] = useState<NavigatorState | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("navigator_goal");
    if (isGoal(requested)) queueMicrotask(() => setGoal(requested));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => { if (active) { setBusy(true); setError(false); } });
    void getNavigator(projectId, { goal: goal || undefined, structureVersionId, signal: controller.signal })
      .then((data) => { if (active) { setState(data); setBusy(false); } })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        if (active) { setError(true); setBusy(false); }
      });
    return () => { active = false; controller.abort(); };
  }, [projectId, goal, structureVersionId, revision]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("chemdft:workspace-items-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("chemdft:workspace-items-changed", refresh); window.removeEventListener("focus", refresh); };
  }, []);

  useEffect(() => {
    if (!state?.facts_summary?.running_jobs) return;
    const timer = window.setInterval(() => setRevision((value) => value + 1), 10000);
    return () => window.clearInterval(timer);
  }, [state?.facts_summary?.running_jobs]);

  return { goal, setGoal, state, busy, error, refresh: () => setRevision((value) => value + 1) };
}
