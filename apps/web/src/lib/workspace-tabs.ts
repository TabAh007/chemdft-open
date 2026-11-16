import { selectionKey, validSelection, type WorkspaceTab } from "./workspace-selection";

export const workspaceSections = ["files", "structures", "experimentalData", "calculations", "results", "notes", "history"] as const;
export type WorkspaceSection = typeof workspaceSections[number];
export type WorkspaceUiState = { tabs: WorkspaceTab[]; activeKey: string | null; expanded: WorkspaceSection[]; nodeExpansion: Record<string, boolean> };

export function emptyWorkspaceState(): WorkspaceUiState {
  return { tabs: [], activeKey: null, expanded: [...workspaceSections], nodeExpansion: {} };
}

export function deduplicateWorkspaceTabs(tabs: WorkspaceTab[]): WorkspaceTab[] {
  const seen = new Set<string>();
  const result: WorkspaceTab[] = [];
  for (const tab of tabs) {
    const key = selectionKey(tab.selection);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(tab);
    }
  }
  return result;
}

export function openWorkspaceTab(state: WorkspaceUiState, tab: WorkspaceTab): WorkspaceUiState {
  const key = selectionKey(tab.selection);
  const existingIndex = state.tabs.findIndex((item) => selectionKey(item.selection) === key);
  let tabs: WorkspaceTab[];
  if (existingIndex >= 0) {
    tabs = state.tabs
      .map((item, idx) => (idx === existingIndex ? { ...item, label: tab.label || item.label } : item))
      .filter((item, idx, arr) => arr.findIndex((t) => selectionKey(t.selection) === selectionKey(item.selection)) === idx);
  } else {
    tabs = [...state.tabs.filter((item) => selectionKey(item.selection) !== key), tab].slice(-12);
  }
  return { ...state, tabs, activeKey: key };
}

export function focusWorkspaceTab(state: WorkspaceUiState, key: string): WorkspaceUiState {
  return state.tabs.some((item) => selectionKey(item.selection) === key) ? { ...state, activeKey: key } : state;
}

export function closeWorkspaceTab(state: WorkspaceUiState, key: string): WorkspaceUiState {
  const index = state.tabs.findIndex((item) => selectionKey(item.selection) === key);
  if (index < 0) return state;
  const tabs = state.tabs.filter((item) => selectionKey(item.selection) !== key);
  const next = tabs[Math.min(index, tabs.length - 1)];
  return { ...state, tabs, activeKey: state.activeKey === key ? (next ? selectionKey(next.selection) : null) : state.activeKey };
}

export function restoreWorkspaceState(raw: string | null, projectId: string): WorkspaceUiState {
  if (!raw) return emptyWorkspaceState();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return emptyWorkspaceState();
    const object = value as Record<string, unknown>;
    const rawTabs = Array.isArray(object.tabs)
      ? object.tabs.filter((item): item is WorkspaceTab => {
          if (!item || typeof item !== "object") return false;
          const tab = item as Record<string, unknown>;
          return typeof tab.label === "string" && tab.label.length <= 160 && validSelection(tab.selection, projectId);
        })
      : [];
    const tabs = deduplicateWorkspaceTabs(rawTabs).slice(-12);
    const keys = new Set(tabs.map((tab) => selectionKey(tab.selection)));
    const activeKey = object.activeKey === null ? null
      : typeof object.activeKey === "string" && keys.has(object.activeKey) ? object.activeKey
        : tabs[0] ? selectionKey(tabs[0].selection) : null;
    const expanded = Array.isArray(object.expanded)
      ? object.expanded.filter((section): section is WorkspaceSection => workspaceSections.includes(section))
      : [...workspaceSections];
    const nodeExpansion = object.nodeExpansion && typeof object.nodeExpansion === "object"
      ? Object.fromEntries(Object.entries(object.nodeExpansion).filter(([key, value]) =>
          /^[A-Za-z]+:[0-9a-f-]{36}$/i.test(key) && typeof value === "boolean").slice(0, 1000)) as Record<string, boolean>
      : {};
    return { tabs, activeKey, expanded, nodeExpansion };
  } catch { return emptyWorkspaceState(); }
}

export function pruneWorkspaceTabs(state: WorkspaceUiState, keys: ReadonlySet<string>): WorkspaceUiState {
  const tabs = state.tabs.filter((tab) => keys.has(selectionKey(tab.selection)));
  const activeKey = state.activeKey === null ? null
    : tabs.some((tab) => selectionKey(tab.selection) === state.activeKey)
      ? state.activeKey : tabs[0] ? selectionKey(tabs[0].selection) : null;
  return { ...state, tabs, activeKey };
}
