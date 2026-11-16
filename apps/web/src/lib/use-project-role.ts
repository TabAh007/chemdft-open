"use client";

import { useEffect, useState } from "react";
import { roleCanExecute } from "./guided-capability-state";
import { getProject } from "./project-api";

/**
 * The caller's role in the project, read once from the project record. This is the single client-side mirror of the
 * server's WRITE capability (owner or editor); the server stays the authority on every request. "loading" until the
 * record is read, "unavailable" if it could not be read; in both cases nothing that needs write access is offered.
 */
type RoleState = { status: "loading" } | { status: "unavailable" } | { status: "known"; role: string };

function useRoleState(projectId: string): RoleState {
  const [state, setState] = useState<{ projectId: string; value: RoleState } | null>(null);
  useEffect(() => {
    let active = true;
    void getProject(projectId)
      .then((project) => { if (active) setState({ projectId, value: { status: "known", role: project.role } }); })
      .catch(() => { if (active) setState({ projectId, value: { status: "unavailable" } }); });
    return () => { active = false; };
  }, [projectId]);
  return state?.projectId === projectId ? state.value : { status: "loading" };
}

/** Guided workspace: the role (null while unknown) and whether the caller may prepare and submit calculations. */
export function useProjectRole(projectId: string): { role: string | null; canExecute: boolean } {
  const state = useRoleState(projectId);
  const role = state.status === "known" ? state.role : null;
  return { role, canExecute: roleCanExecute(role) };
}

/**
 * Results: whether the caller may change things in this project. `canWrite` is `null` while the role is being read,
 * `false` when it cannot be read or is read-only. Read-only roles still see, inspect, compare and export published
 * results; actions that start or prepare work are simply not offered.
 */
export function useProjectWriteAccess(projectId: string): { role: string | null; canWrite: boolean | null } {
  const state = useRoleState(projectId);
  if (state.status === "loading") return { role: null, canWrite: null };
  if (state.status === "unavailable") return { role: null, canWrite: false };
  return { role: state.role || null, canWrite: roleCanExecute(state.role) };
}
