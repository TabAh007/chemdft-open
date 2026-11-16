"use client";

import { useEffect } from "react";

/**
 * Collapse and reopen of the context dock (AI Scientist / Inspector) on the Overview. The header toggle and the dock's
 * own close button dispatch `chemdft:toggle-dock`, which the Workspace route handles itself; this hook does the same
 * for the Overview with the same shell class (`dock-collapsed`), the same event (`chemdft:dock-state`) and the same
 * stored preference keys, so the choice carries between routes. It only shows or hides the panel.
 */
/** `closedBelow`: viewport width (px) up to which the dock starts closed because it is an overlay drawer there. */
export function useOverviewDock(projectId: string, mode: "guided" | "advanced", closedBelow = 1200): void {
  useEffect(() => {
    const shell = () => document.querySelector<HTMLElement>(".project-shell");
    const compact = () => window.matchMedia(`(max-width: ${closedBelow}px)`).matches;
    const key = `chemdft:panels:${projectId}:${mode === "guided" ? "guided-ai-dock" : "dock"}`;
    const read = (): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
    const apply = (visible: boolean, persist: boolean) => {
      shell()?.classList.toggle("dock-collapsed", !visible);
      window.dispatchEvent(new CustomEvent("chemdft:dock-state", { detail: { visible } }));
      // A phone's bottom sheet is transient; wide layouts remember the choice like the Workspace does.
      if (persist && !compact()) { try { localStorage.setItem(key, String(visible)); } catch { /* optional */ } }
    };
    shell()?.classList.add("dock-drawer"); // from here the stylesheet makes the dock an overlay drawer up to 1200 px
    const stored = read();
    // Wide: open unless the researcher closed it. Phone: closed until asked for, so the Overview is not covered.
    queueMicrotask(() => apply(compact() ? false : stored !== "false", false));
    const toggle = () => apply(Boolean(shell()?.classList.contains("dock-collapsed")), true);
    const show = () => apply(true, true);
    window.addEventListener("chemdft:toggle-dock", toggle);
    window.addEventListener("chemdft:open-ai-scientist", show);
    window.addEventListener("chemdft:open-inspector", show);
    return () => {
      shell()?.classList.remove("dock-drawer");
      window.removeEventListener("chemdft:toggle-dock", toggle);
      window.removeEventListener("chemdft:open-ai-scientist", show);
      window.removeEventListener("chemdft:open-inspector", show);
    };
  }, [projectId, mode, closedBelow]);
}
