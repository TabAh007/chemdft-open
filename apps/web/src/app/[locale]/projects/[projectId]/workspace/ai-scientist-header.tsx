"use client";

import { useEffect, useRef, useState } from "react";
import { AppIcon, AppPopover, PopupKind, type IconName } from "@chemdft/ui";

export type AIScientistTab = "chat" | "tools" | "evidence" | "runs" | "settings";

interface AIScientistHeaderProps {
  activeTab: AIScientistTab;
  onSelectTab: (tab: AIScientistTab) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onToggleExpanded?: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
  evidenceCount?: number | undefined;
  runCount?: number | undefined;
  /** A proposed action is waiting for a human decision. */
  approvalPending?: boolean;
  onSelectInspector?: (() => void) | undefined;
  isAdvanced?: boolean | undefined;
}

interface NavTabItem {
  id: AIScientistTab;
  label: string;
  icon: IconName;
  badge?: number;
}

/** Always visible. */
const MAIN_TABS: NavTabItem[] = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "evidence", label: "Evidence", icon: "book" },
  { id: "runs", label: "Runs", icon: "timeline-events" },
];
/** Behind the overflow menu. The active one joins the tab row so the tablist always has a selected tab. */
const MORE_TABS: NavTabItem[] = [
  { id: "tools", label: "Tools", icon: "wrench" },
  { id: "settings", label: "Settings", icon: "cog" },
];

export function AIScientistHeader({
  activeTab,
  onSelectTab,
  isExpanded = false,
  onToggleExpand,
  onToggleExpanded,
  isPinned = true,
  onTogglePin,
  onClose,
  evidenceCount,
  runCount,
  approvalPending = false,
  onSelectInspector,
  isAdvanced = false,
}: AIScientistHeaderProps) {
  const handleExpand = onToggleExpand ?? onToggleExpanded;
  const [moreOpen, setMoreOpen] = useState(false);
  // After choosing from the menu, focus moves to the tab it opened (it joins the row on the next render).
  const focusTabRef = useRef<AIScientistTab | null>(null);
  // Escape and outside clicks return focus to the button; choosing an item sends it to the opened tab instead.
  const [returnFocus, setReturnFocus] = useState(true);
  useEffect(() => {
    if (focusTabRef.current !== activeTab) return;
    focusTabRef.current = null;
    const frame = window.requestAnimationFrame(() => document.getElementById(`ai-tab-${activeTab}`)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab]);
  const transient = MORE_TABS.find((tab) => tab.id === activeTab);
  const TABS = transient ? [...MAIN_TABS, transient] : MAIN_TABS;

  return (
    <div className="ai-scientist-header-container">
      {/* One compact row, like the Inspector: the dock tab already names the panel. */}
      <nav className={`ai-scientist-nav ${isAdvanced ? "dock-tabs is-merged" : ""}`} aria-label="AI Scientist navigation">
        {isAdvanced && onSelectInspector ? (
          <div className="dock-merged-left" role="tablist" aria-label="Context panels">
            <button
              role="tab"
              type="button"
              aria-selected={false}
              className="dock-merged-tab dock-tab-inspector"
              data-testid="dock-inspector-tab"
              onClick={onSelectInspector}
              title="Switch to Inspector"
            >
              Inspector
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={true}
              className="dock-merged-tab dock-tab-ai active"
              data-testid="ai-scientist-tab"
              onClick={() => {}}
              title="AI Scientist"
              {...(approvalPending ? { "aria-describedby": "dock-ai-pending" } : {})}
            >
              AI Scientist
              {approvalPending ? (
                <span className="dock-tab-badge" id="dock-ai-pending">
                  <span aria-hidden="true">1</span>
                  <span className="ai-visually-hidden">Approval waiting</span>
                </span>
              ) : null}
            </button>
            <span className="dock-merged-divider" aria-hidden="true" />
          </div>
        ) : null}
        <div role="tablist" aria-label="AI Scientist views" className="ai-scientist-tablist"
          onKeyDown={(event) => {
            // WAI-ARIA tabs pattern: arrows/Home/End move focus and activate the adjacent tab.
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const index = TABS.findIndex((tab) => tab.id === activeTab);
            const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1
              : (index + (event.key === "ArrowLeft" ? -1 : 1) + TABS.length) % TABS.length;
            const target = TABS[next];
            if (!target) return;
            onSelectTab(target.id);
            (event.currentTarget.querySelector(`#ai-tab-${target.id}`) as HTMLButtonElement | null)?.focus();
          }}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const count = tab.id === "evidence" ? evidenceCount : tab.id === "runs" ? runCount : undefined;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`ai-tab-${tab.id}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              {...(isActive ? { "aria-controls": `ai-panel-${tab.id}` } : {})}
              className={`ai-nav-tab ${isActive ? "active" : ""}`}
              onClick={() => onSelectTab(tab.id)}
              data-testid={`ai-nav-${tab.id}`}
            >
              <AppIcon icon={tab.icon} />
              <span className="ai-nav-label">{tab.label}</span>
              {tab.id === "chat" && approvalPending ? (
                <span className="ai-nav-badge is-attention" title="A proposed calculation is waiting for your decision" data-testid="ai-chat-approval-badge">
                  <span aria-hidden="true">!</span><span className="ai-visually-hidden">Approval waiting</span>
                </span>
              ) : count !== undefined && count > 0 ? (
                <span className="ai-nav-badge" aria-label={`${count} items`}>{count}</span>
              ) : null}
            </button>
          );
        })}
        </div>
        <div className="ai-scientist-controls">
          <AppPopover
            popupKind={PopupKind.MENU}
            placement="bottom-end"
            isOpen={moreOpen}
            onInteraction={(next) => { if (next) setReturnFocus(true); setMoreOpen(next); }}
            autoFocus
            enforceFocus={false}
            canEscapeKeyClose
            shouldReturnFocusOnClose={returnFocus}
            arrow={false}
            transitionDuration={0}
            popoverClassName="ai-more-popover"
            portalClassName="ai-more-portal"
            onOpened={(node) => node.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })}
            content={
              <div className="ai-more-menu" role="menu" aria-label="More AI Scientist views" data-testid="ai-more-menu"
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
                  const index = items.indexOf(document.activeElement as HTMLElement);
                  items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
                }}>
                {MORE_TABS.map((tab) => (
                  <button key={tab.id} type="button" role="menuitem" className={`ai-more-item ${activeTab === tab.id ? "active" : ""}`}
                    {...(activeTab === tab.id ? { "aria-current": "true" as const } : {})}
                    data-testid={`ai-menu-${tab.id}`}
                    onClick={() => {
                      setReturnFocus(false);
                      setMoreOpen(false);
                      focusTabRef.current = tab.id;
                      onSelectTab(tab.id);
                    }}>
                    <AppIcon icon={tab.icon} /><span>{tab.label}</span>
                  </button>
                ))}
              </div>
            }
          >
            <button type="button" className={`ai-header-btn ai-nav-more ${transient ? "active" : ""}`} aria-haspopup="menu" aria-expanded={moreOpen}
              aria-label="More: Tools and Settings" title="More: Tools and Settings" data-testid="ai-nav-more">
              <AppIcon icon="more" />
            </button>
          </AppPopover>
          {onTogglePin ? (
            <button
              type="button"
              className={`ai-header-btn ${isPinned ? "active" : ""}`}
              onClick={onTogglePin}
              title={isPinned ? "Unpin panel" : "Pin panel"}
              aria-label={isPinned ? "Unpin panel" : "Pin panel"}
            >
              <AppIcon icon="pin" />
            </button>
          ) : null}
          {handleExpand ? (
            <button
              type="button"
              className={`ai-header-btn ${isExpanded ? "active" : ""}`}
              onClick={handleExpand}
              title={isExpanded ? "Collapse to dock" : "Expand panel"}
              aria-label={isExpanded ? "Collapse to dock" : "Expand panel"}
              aria-pressed={isExpanded}
              data-testid="ai-expand-toggle"
            >
              <AppIcon icon={isExpanded ? "minimize" : "maximize"} />
            </button>
          ) : null}
          {onClose ? (
            <>
              <button
                type="button"
                className="ai-header-btn ai-header-close-btn"
                onClick={onClose}
                title={isExpanded ? "Close AI Scientist" : "Collapse AI Scientist panel"}
                aria-label={isExpanded ? "Close AI Scientist" : "Collapse AI Scientist panel"}
                data-testid="ai-dock-close"
              >
                <AppIcon icon="cross" />
              </button>
              <button
                type="button"
                className="dock-sheet-close"
                aria-label="Close AI Scientist"
                data-testid="dock-sheet-close"
                onClick={onClose}
              >
                ✕
              </button>
            </>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
