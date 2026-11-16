"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { closeWorkspaceTab, emptyWorkspaceState, focusWorkspaceTab, openWorkspaceTab, pruneWorkspaceTabs, restoreWorkspaceState, type WorkspaceSection, type WorkspaceUiState } from "@/lib/workspace-tabs";
import { parseWorkspaceSelection, selectionKey, workspaceSelectionUrl, type WorkspaceSelection, type WorkspaceTab } from "@/lib/workspace-selection";
import { getProject, ProjectApiError } from "@/lib/project-api";

export type ProjectAvailability = "checking" | "available" | "missing" | "error";

export type WorkspaceCatalogItem = {
  selection: WorkspaceSelection;
  label: string;
  section: WorkspaceSection;
  detail?: string;
  authority?: "CANDIDATE" | "COMMITTED" | "AUTHORITATIVE" | "IMPORTED" | "EXPERIMENTAL";
  /** Imported result that carries spectral data (IR/Raman intensities or excitations); never a ChemDFT result. */
  importedSpectrum?: true;
  /** A measured experimental spectrum (raw, derived version or peak set). */
  experimentalSpectrum?: true;
  parentKey?: string;
  occurredAt?: string;
  linkedSelection?: WorkspaceSelection;
};

type WorkspaceContext = {
  state: WorkspaceUiState;
  activeSelection: WorkspaceSelection | null;
  activeTab: WorkspaceTab | null;
  catalog: WorkspaceCatalogItem[];
  catalogReady: boolean;
  /** Why the saved-items inventory could not be read (null once it has loaded, or while it has not failed). */
  catalogError: string | null;
  setCatalogError: (message: string | null) => void;
  projectAvailability: ProjectAvailability;
  staleNotice: string | null;
  setCatalog: (items: WorkspaceCatalogItem[]) => void;
  openSelection: (selection: WorkspaceSelection, label: string) => void;
  updateSelection: (selection: WorkspaceSelection) => void;
  focusTab: (key: string) => void;
  showProject: () => void;
  closeTab: (key: string) => void;
  toggleSection: (section: WorkspaceSection) => void;
  toggleNode: (key: string, defaultOpen: boolean) => void;
  workspaceMode: "guided" | "advanced";
  setWorkspaceMode: (mode: "guided" | "advanced") => void;
  /** Describes unsaved researcher work (for example an open molecule drawing), or null. */
  unsavedWork: string | null;
  setUnsavedWork: (description: string | null) => void;
  /** True when there is no unsaved work, or the researcher confirmed discarding it. */
  confirmDiscardUnsavedWork: (action: string) => boolean;
};

const Context = createContext<WorkspaceContext | null>(null);

export function useWorkspaceState(): WorkspaceContext {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace state must be used inside ProjectShell.");
  return value;
}

export function useOptionalWorkspaceState(): WorkspaceContext | null {
  return useContext(Context);
}

export function WorkspaceStateProvider({ projectId, children }: { projectId: string; children?: ReactNode }) {
  const modeKey = "chemdft:workspace-mode";
  const [workspaceMode, setWorkspaceModeState] = useState<"guided" | "advanced">(() => {
    if (typeof window === "undefined") return "guided";
    try {
      const saved = localStorage.getItem(modeKey);
      if (saved === "guided" || saved === "advanced") return saved;
    } catch {
      // Ignore localStorage issues
    }
    return "guided";
  });
  const [state, setState] = useState<WorkspaceUiState>(emptyWorkspaceState);
  const [catalog, setCatalogState] = useState<WorkspaceCatalogItem[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [hydratedProjectId, setHydratedProjectId] = useState<string | null>(null);
  const [projectAvailability, setProjectAvailability] = useState<ProjectAvailability>("checking");
  const [unsavedWork, setUnsavedWorkState] = useState<string | null>(null);
  const unsavedWorkRef = useRef<string | null>(null);
  const setUnsavedWork = useCallback((description: string | null) => {
    unsavedWorkRef.current = description;
    setUnsavedWorkState(description);
  }, []);
  const confirmDiscardUnsavedWork = useCallback((action: string) => {
    const pending = unsavedWorkRef.current;
    if (!pending) return true;
    return window.confirm(`${pending}\n\n${action} will discard it. Continue?`);
  }, []);
  const stateRef = useRef(state);
  const catalogRef = useRef(catalog);
  const readyRef = useRef(false);
  const storageKey = `chemdft:workspace:${projectId}:v1`;



  const setWorkspaceMode = useCallback((mode: "guided" | "advanced") => {
    setWorkspaceModeState(mode);
    try {
      localStorage.setItem(modeKey, mode);
    } catch {
      // Ignore localStorage issues
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getProject(projectId).then(() => {
      if (active) setProjectAvailability("available");
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof ProjectApiError && error.status === 404) {
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
          const key = localStorage.key(index);
          if (key?.startsWith("chemdft:") && key.includes(projectId)) localStorage.removeItem(key);
        }
        const empty = emptyWorkspaceState();
        stateRef.current = empty;
        setState(empty);
        setHydratedProjectId(null);
        window.history.replaceState(null, "", workspaceSelectionUrl(window.location.href, null));
        setProjectAvailability("missing");
        return;
      }
      setProjectAvailability("error");
    });
    return () => { active = false; };
  }, [projectId]);

  const commit = useCallback((next: WorkspaceUiState, historyMode?: "push" | "replace") => {
    stateRef.current = next;
    setState(next);
    if (historyMode) {
      const active = next.tabs.find((tab) => selectionKey(tab.selection) === next.activeKey)?.selection ?? null;
      const url = workspaceSelectionUrl(window.location.href, active);
      window.dispatchEvent(new CustomEvent("chemdft:workbench-activated", { detail: active ? selectionKey(active) : "project" }));
      if (historyMode === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    }
  }, []);

  useEffect(() => {
    if (projectAvailability !== "available") return;
    let restored = restoreWorkspaceState(localStorage.getItem(storageKey), projectId);
    const requested = parseWorkspaceSelection(window.location.search, projectId);
    if (requested) {
      const known = catalogRef.current.find((item) => selectionKey(item.selection) === selectionKey(requested));
      restored = openWorkspaceTab(restored, { selection: requested, label: known?.label ?? `${requested.kind} ${requested.id.slice(0, 8)}` });
    } else if (new URLSearchParams(window.location.search).has("selection")) {
      queueMicrotask(() => setStaleNotice("This workspace link is malformed. Select a saved project item from the tree."));
    }
    if (catalogReady) {
      restored = pruneWorkspaceTabs(restored, new Set(catalogRef.current.map((item) => selectionKey(item.selection))));
    }
    stateRef.current = restored;
    setState(restored);
    readyRef.current = true;
    queueMicrotask(() => setHydratedProjectId(projectId));
    return () => { readyRef.current = false; };
  }, [catalogReady, projectAvailability, projectId, storageKey]);

  useEffect(() => {
    if (projectAvailability === "available" && hydratedProjectId === projectId) localStorage.setItem(storageKey, JSON.stringify(state));
  }, [hydratedProjectId, projectAvailability, projectId, state, storageKey]);

  // RW-3.2: this provider lives in the project layout and survives client-side navigation, so a link
  // such as Results → "Open result" (workspace?selection=…) must be followed here, not only on first load.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const linkedSelection = searchParams?.get("selection") ?? null;
  const linkedSource = searchParams?.get("source") ?? null;
  useEffect(() => {
    if (projectAvailability !== "available" || hydratedProjectId !== projectId || !pathname?.endsWith("/workspace")) return;
    const requested = parseWorkspaceSelection(window.location.search, projectId);
    if (!requested || stateRef.current.activeKey === selectionKey(requested)) return;
    const known = catalogRef.current.find((item) => selectionKey(item.selection) === selectionKey(requested));
    // An item newer than the loaded tree (e.g. a result published while the researcher was elsewhere)
    // refreshes the tree; a genuinely missing item is then closed by the normal pruning, with a notice.
    if (!known) window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
    queueMicrotask(() => setStaleNotice(null));
    commit(openWorkspaceTab(stateRef.current, { selection: requested, label: known?.label ?? `${requested.kind} ${requested.id.slice(0, 8)}` }));
  }, [commit, hydratedProjectId, linkedSelection, linkedSource, pathname, projectAvailability, projectId]);

  useEffect(() => {
    function navigateBack() {
      const selection = parseWorkspaceSelection(window.location.search, projectId);
      if (!selection) {
        commit({ ...stateRef.current, activeKey: null });
        return;
      }
      const known = catalogRef.current.find((item) => selectionKey(item.selection) === selectionKey(selection));
      commit(openWorkspaceTab(stateRef.current, { selection, label: known?.label ?? `${selection.kind} ${selection.id.slice(0, 8)}` }));
    }
    window.addEventListener("popstate", navigateBack);
    return () => window.removeEventListener("popstate", navigateBack);
  }, [commit, projectId]);

  const setCatalog = useCallback((items: WorkspaceCatalogItem[]) => {
    catalogRef.current = items;
    setCatalogState(items);
    setCatalogReady(true);
    if (!readyRef.current) return;
    const keys = new Set(items.map((item) => selectionKey(item.selection)));
    const previous = stateRef.current;
    const pruned = pruneWorkspaceTabs(previous, keys);
    const tabs = pruned.tabs.map((tab) => ({ ...tab, label: items.find((item) => selectionKey(item.selection) === selectionKey(tab.selection))?.label ?? tab.label }));
    if (pruned.tabs.length < previous.tabs.length) setStaleNotice("A linked or saved item is not available in this project (it was removed, or the link belongs to another project). Its tab was closed; nothing was substituted.");
    const nodeExpansion = Object.fromEntries(Object.entries(pruned.nodeExpansion).filter(([key]) => keys.has(key)));
    commit({ ...pruned, tabs, nodeExpansion }, pruned.activeKey !== previous.activeKey ? "replace" : undefined);
  }, [commit]);

  const openSelection = useCallback((selection: WorkspaceSelection, label: string) => {
    if (selection.projectId !== projectId) return;
    setStaleNotice(null);
    commit(openWorkspaceTab(stateRef.current, { selection, label }), "push");
  }, [commit, projectId]);

  const updateSelection = useCallback((selection: WorkspaceSelection) => {
    if (selection.projectId !== projectId) return;
    const key = selectionKey(selection);
    const tabs = stateRef.current.tabs.map((tab) => selectionKey(tab.selection) === key ? { ...tab, selection } : tab);
    commit({ ...stateRef.current, tabs }, "replace");
  }, [commit, projectId]);

  const focusTab = useCallback((key: string) => commit(focusWorkspaceTab(stateRef.current, key), "push"), [commit]);
  const showProject = useCallback(() => commit({ ...stateRef.current, activeKey: null }, "push"), [commit]);
  const closeTab = useCallback((key: string) => commit(closeWorkspaceTab(stateRef.current, key), "replace"), [commit]);
  const toggleSection = useCallback((section: WorkspaceSection) => {
    const expanded = stateRef.current.expanded.includes(section)
      ? stateRef.current.expanded.filter((item) => item !== section)
      : [...stateRef.current.expanded, section];
    commit({ ...stateRef.current, expanded });
  }, [commit]);
  const toggleNode = useCallback((key: string, defaultOpen: boolean) => {
    const current = stateRef.current.nodeExpansion[key] ?? defaultOpen;
    commit({ ...stateRef.current, nodeExpansion: { ...stateRef.current.nodeExpansion, [key]: !current } });
  }, [commit]);

  const activeTab = state.tabs.find((tab) => selectionKey(tab.selection) === state.activeKey) ?? null;
  return <Context.Provider value={{ state, activeSelection: activeTab?.selection ?? null, activeTab, catalog, catalogReady, catalogError, setCatalogError, projectAvailability, staleNotice,
    setCatalog, openSelection, updateSelection, focusTab, showProject, closeTab, toggleSection, toggleNode, workspaceMode, setWorkspaceMode,
    unsavedWork, setUnsavedWork, confirmDiscardUnsavedWork }}>{children}</Context.Provider>;
}
