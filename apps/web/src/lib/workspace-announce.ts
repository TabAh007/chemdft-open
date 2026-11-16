"use client";

import { useEffect, useState } from "react";

/**
 * The Workspace announces what it shows with one `chemdft:workspace-selection` event. The dock mounts after the project
 * catalog loads, so it can miss that first announcement; once it is listening it asks again, and the Workspace repeats it.
 */
export const WORKSPACE_SELECTION_REQUEST = "chemdft:workspace-selection-request";

/** Dock side: ask the Workspace to announce its current selection again. */
export function requestWorkspaceAnnouncement(projectId: string): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_SELECTION_REQUEST, { detail: { projectId } }));
}

/** Workspace side: a counter that changes on every request. Put it in the dependencies of the announcing effect. */
export function useWorkspaceAnnounceRequests(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onRequest = () => setTick((value) => value + 1);
    window.addEventListener(WORKSPACE_SELECTION_REQUEST, onRequest);
    return () => window.removeEventListener(WORKSPACE_SELECTION_REQUEST, onRequest);
  }, []);
  return tick;
}
