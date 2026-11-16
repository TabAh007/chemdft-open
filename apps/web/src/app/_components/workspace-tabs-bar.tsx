"use client";

import { AppIcon } from "@chemdft/ui";
import { compactTabTitle } from "@/lib/structure-workbench";
import { selectionKey } from "@/lib/workspace-selection";
import { useWorkspaceState } from "./workspace-state-provider";

export function WorkspaceTabsBar() {
  const { state, focusTab, showProject, closeTab } = useWorkspaceState();
  return <div className="workspace-tabs" role="tablist" aria-label="Open workspace items" data-testid="workspace-tabs">
    <button type="button" role="tab" className="workspace-tab" aria-selected={state.activeKey === null}
      onClick={showProject}><AppIcon icon="home" /> Project</button>
    {state.tabs.map((tab) => {
      const key = selectionKey(tab.selection);
      const shortLabel = compactTabTitle(tab);
      const sameLabel = state.tabs.filter(other => compactTabTitle(other) === shortLabel).length > 1;
      const visibleLabel = sameLabel ? `${shortLabel} · ${tab.selection.id.slice(0,8)}` : shortLabel;
      return <div className="workspace-tab-wrap" key={key}>
        <button type="button" role="tab" className="workspace-tab" aria-selected={state.activeKey === key}
          onClick={(event) => { focusTab(key); event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" }); }} data-testid="workspace-open-tab" title={tab.label}>{visibleLabel}</button>
        <button type="button" className="workspace-tab-close" aria-label={`Close ${tab.label}`}
          onClick={() => closeTab(key)}>×</button>
      </div>;
    })}
  </div>;
}
