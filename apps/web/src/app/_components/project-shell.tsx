"use client";

import { CatalogUnavailable } from "./catalog-unavailable";
import { AppDrawer, AppIcon, AppPopover, AppPosition, StatusTag } from "@chemdft/ui";
import type { Locale } from "@chemdft/i18n";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getProject } from "@/lib/project-api";

import { activeProjectSection, PROJECT_SECTIONS, researchFocusFromSelection, type ResearchFocus } from "@/lib/project-sections";
import { projectPath } from "@/lib/routes";
import {
  getPersistedDensity,
  getPersistedDockCollapsed,
  getPersistedDockWidth,
  getPersistedExplorerCollapsed,
  getPersistedExplorerWidth,
  getPersistedFocusMode,
  setPersistedDensity,
  setPersistedDockCollapsed,
  setPersistedDockWidth,
  setPersistedExplorerCollapsed,
  setPersistedExplorerWidth,
  setPersistedFocusMode,
  type DensityPreference,
} from "@/lib/persisted-layout";
import { useWorkspaceTier } from "@/lib/workspace-tiers";
import { BrandMark } from "./brand-mark";
import { ProjectDock } from "./project-dock";
import { ProjectExplorer } from "./project-explorer";
import { WorkspaceSplitter } from "./workspace-splitter";
import { WorkspaceStateProvider, useWorkspaceState } from "./workspace-state-provider";
import { AiContextProvider } from "@/lib/ai-context";

import { WorkspaceModeToggle } from "./guided/workspace-mode-toggle";
import { useLocalDevelopment } from "./local-development-context";
import { HeaderIdentity } from "./settings/header-identity";

const PRIMARY_SECTION_SEGMENTS = ["overview", "workspace", "results", "compare", "jobs"];
const COMPACT_PRIMARY_SECTION_SEGMENTS = ["workspace", "results"];

/**
 * One section navigation for both modes, in research order (RW-3.2).
 * Collapses progressively:
 * - width < 1366 px: tab labels collapse to icons with tooltips & aria-labels
 * - width < 1100 px: Overview, Compare, and Jobs collapse into "More ▾"
 */
function ProjectSectionNav({
  locale,
  projectId,
  collapseOverflow = false,
  compactNav = false,
  iconOnly = false,
}: {
  locale: Locale;
  projectId: string;
  collapseOverflow?: boolean;
  compactNav?: boolean;
  iconOnly?: boolean;
}) {
  const pathname = usePathname();
  const { confirmDiscardUnsavedWork } = useWorkspaceState();
  const active = activeProjectSection(pathname, projectId);

  const primarySegments = compactNav
    ? COMPACT_PRIMARY_SECTION_SEGMENTS
    : collapseOverflow
      ? PRIMARY_SECTION_SEGMENTS
      : null;

  const primarySections = primarySegments
    ? PROJECT_SECTIONS.filter((s) => primarySegments.includes(s.segment.split("/")[0] ?? ""))
    : PROJECT_SECTIONS;
  const overflowSections = primarySegments
    ? PROJECT_SECTIONS.filter((s) => !primarySegments.includes(s.segment.split("/")[0] ?? ""))
    : [];

  const isOverflowActive = overflowSections.some((s) => s.segment === active);

  return (
    <nav className={`project-sections${iconOnly ? " icon-only" : ""}`} aria-label="Project sections" data-testid="project-sections">
      {primarySections.map((section, index) => {
        const previous = primarySections[index - 1];
        return (
          <span key={section.segment} className="project-section-slot">
            {previous && previous.group !== section.group ? <span className="project-section-divider" aria-hidden="true" /> : null}
            <Link
              href={projectPath(locale, projectId, section.segment)}
              className={`project-section-link group-${section.group}`}
              title={section.purpose}
              aria-label={section.label}
              aria-current={active === section.segment ? "page" : undefined}
              data-testid={`project-section-${section.segment.split("/")[0]}`}
              onClick={(event) => {
                if (active === section.segment) return;
                if (!confirmDiscardUnsavedWork(`Opening ${section.label}`)) event.preventDefault();
              }}
            >
              <AppIcon icon={section.icon} />
              <span className="project-section-label">{section.label}</span>
            </Link>
          </span>
        );
      })}

      {overflowSections.length > 0 ? (
        <span className="project-section-slot">
          <span className="project-section-divider" aria-hidden="true" />
          <AppPopover
            content={
              <div className="project-sections-more-menu" role="menu" aria-label="More project sections">
                {overflowSections.map((section) => (
                  <Link
                    key={section.segment}
                    href={projectPath(locale, projectId, section.segment)}
                    className={`project-section-more-item group-${section.group}`}
                    role="menuitem"
                    title={section.purpose}
                    aria-label={section.label}
                    aria-current={active === section.segment ? "page" : undefined}
                    data-testid={`project-section-${section.segment.split("/")[0]}`}
                    onClick={(event) => {
                      if (active === section.segment) return;
                      if (!confirmDiscardUnsavedWork(`Opening ${section.label}`)) event.preventDefault();
                    }}
                  >
                    <AppIcon icon={section.icon} />
                    <span>{section.label}</span>
                  </Link>
                ))}
              </div>
            }
          >
            <button
              type="button"
              className={`project-section-link project-sections-more-btn ${isOverflowActive ? "is-active" : ""}`}
              aria-label="More sections"
              aria-current={isOverflowActive ? "page" : undefined}
              data-testid="project-sections-more"
            >
              <span>More ▾</span>
            </button>
          </AppPopover>
        </span>
      ) : null}
    </nav>
  );
}

/** Single View menu popover for density & focus mode toggle when header space is compact (< 1100 px). */
function ViewMenu({
  density,
  setDensity,
  focusMode,
  setFocusMode,
}: {
  density: DensityPreference;
  setDensity: (d: DensityPreference) => void;
  focusMode: boolean;
  setFocusMode: (f: boolean) => void;
}) {
  return (
    <AppPopover
      content={
        <div className="view-menu-popover" role="menu" aria-label="View options">
          <button
            type="button"
            className={`view-menu-item ${density === "compact" ? "is-compact" : ""}`}
            role="menuitem"
            aria-label={`Switch density (currently ${density})`}
            title={`Density: ${density === "compact" ? "Compact" : "Comfortable"}`}
            data-testid="density-toggle"
            onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
          >
            <AppIcon icon={density === "compact" ? "compressed" : "expand-all"} />
            <span>Density: {density === "compact" ? "Compact" : "Comfortable"}</span>
          </button>
          <button
            type="button"
            className={`view-menu-item ${focusMode ? "active" : ""}`}
            role="menuitemcheckbox"
            aria-checked={focusMode}
            aria-label={focusMode ? "Exit focus mode (Shift+F)" : "Enter focus mode (Shift+F)"}
            title={focusMode ? "Exit focus mode (Shift+F)" : "Focus mode (Shift+F) — fills the window with the viewer"}
            data-testid="focus-mode-toggle"
            onClick={() => setFocusMode(!focusMode)}
          >
            <AppIcon icon={focusMode ? "minimize" : "maximize"} />
            <span>{focusMode ? "Exit focus mode" : "Focus mode (Shift+F)"}</span>
          </button>
        </div>
      }
    >
      <button
        type="button"
        className="view-menu-btn"
        aria-label="View options"
        title="View density and focus options"
        data-testid="view-menu-toggle"
      >
        <AppIcon icon="eye-open" />
        <span className="view-menu-label">View ▾</span>
      </button>
    </AppPopover>
  );
}

/** Single row header at every width >= 834 px; narrower widths keep a secondary row without overlap. */
const WIDE_HEADER_QUERY = "(min-width: 834px)";
function useWideHeader(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE_HEADER_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE_HEADER_QUERY).matches,
    () => false,
  );
}

/** Remembers the molecule / result the researcher last focused on, so it stays visible on every section. */
function useResearchFocus(projectId: string): ResearchFocus | null {
  const [focus, setFocus] = useState<ResearchFocus | null>(null);
  useEffect(() => {
    const key = `chemdft:research-focus:${projectId}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as ResearchFocus | null;
      if (saved && typeof saved.focus === "string") queueMicrotask(() => setFocus(saved));
    } catch { /* optional convenience */ }
    const onSelection = (event: Event) => {
      const label = researchFocusFromSelection((event as CustomEvent<{ projectId?: unknown; currentView?: unknown }>).detail, projectId);
      if (!label) return;
      const onWorkspace = window.location.pathname.endsWith("/workspace");
      const next = { focus: label, href: onWorkspace ? `${window.location.pathname}${window.location.search}` : null };
      setFocus(next);
      try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* optional convenience */ }
    };
    window.addEventListener("chemdft:workspace-selection", onSelection);
    return () => window.removeEventListener("chemdft:workspace-selection", onSelection);
  }, [projectId]);
  return focus;
}

export function ProjectShell({
  children,
  locale,
  projectId,
}: {
  children?: ReactNode;
  locale: Locale;
  projectId: string;
}) {
  return <WorkspaceStateProvider key={projectId} projectId={projectId}><AiContextProvider><ProjectShellFrame locale={locale} projectId={projectId}>{children}</ProjectShellFrame></AiContextProvider></WorkspaceStateProvider>;
}

function ProjectShellFrame({ children, locale, projectId }: { children: ReactNode; locale: Locale; projectId: string }) {
  const isLocalDev = useLocalDevelopment();
  const { projectAvailability, catalogReady, catalogError, workspaceMode, setWorkspaceMode, confirmDiscardUnsavedWork } = useWorkspaceState();
  const pathname = usePathname();
  const focus = useResearchFocus(projectId);
  const inlineNav = useWideHeader();
  const onWorkspace = activeProjectSection(pathname, projectId) === "workspace";
  const [projectName, setProjectName] = useState("Project");
  const [aiDockOpen, setAiDockOpen] = useState(true);
  const [aiApprovalPending, setAiApprovalPending] = useState(false);

  // Shell container ref for container-width tiers
  const shellRef = useRef<HTMLDivElement>(null);
  const { tier, width, isNarrow, isMedium, isWide, isCompact } = useWorkspaceTier(shellRef);

  // Persistent layout states
  const [explorerWidth, setExplorerWidthState] = useState(() => getPersistedExplorerWidth(240));
  const [dockWidth, setDockWidthState] = useState(() => getPersistedDockWidth(380));
  const [explorerCollapsed, setExplorerCollapsedState] = useState(() => getPersistedExplorerCollapsed(false));
  const [dockCollapsed, setDockCollapsedState] = useState(() => getPersistedDockCollapsed(false));
  const [density, setDensityState] = useState<DensityPreference>(() => {
    const saved = getPersistedDensity();
    if (saved) return saved;
    if (typeof window !== "undefined" && window.innerHeight < 700) return "compact";
    return "comfortable";
  });
  const [focusMode, setFocusModeState] = useState(() => getPersistedFocusMode(false));

  // Slide-over states for narrow screens (< 1100 px). Rule: Never both at once.
  const [explorerDrawerOpen, setExplorerDrawerOpen] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);

  const autoCompact = isCompact;

  // Synchronize persisted states
  const setExplorerWidth = useCallback((w: number) => {
    setExplorerWidthState(w);
    setPersistedExplorerWidth(w);
  }, []);

  const setDockWidth = useCallback((w: number) => {
    setDockWidthState(w);
    setPersistedDockWidth(w);
  }, []);

  const setExplorerCollapsed = useCallback((c: boolean) => {
    setExplorerCollapsedState(c);
    setPersistedExplorerCollapsed(c);
  }, []);

  const setDockCollapsed = useCallback((c: boolean) => {
    setDockCollapsedState(c);
    setPersistedDockCollapsed(c);
  }, []);

  const setDensity = useCallback((d: DensityPreference) => {
    setDensityState(d);
    setPersistedDensity(d);
  }, []);

  const setFocusMode = useCallback((f: boolean) => {
    setFocusModeState(f);
    setPersistedFocusMode(f);
  }, []);

  // Keyboard shortcut: Shift+F toggles Focus Mode
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "F" &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)
      ) {
        e.preventDefault();
        setFocusMode(!focusMode);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode, setFocusMode]);

  useEffect(() => {
    const onState = (event: Event) => setAiDockOpen(Boolean((event as CustomEvent<{ visible: boolean }>).detail?.visible));
    const onApproval = (event: Event) => setAiApprovalPending(Boolean((event as CustomEvent<{ pending: boolean }>).detail?.pending));
    window.addEventListener("chemdft:dock-state", onState);
    window.addEventListener("chemdft:ai-approval-state", onApproval);
    return () => {
      window.removeEventListener("chemdft:dock-state", onState);
      window.removeEventListener("chemdft:ai-approval-state", onApproval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void getProject(projectId).then((project) => { if (active) setProjectName(project.name); }).catch(() => {});
    return () => { active = false; };
  }, [projectId]);

  if (projectAvailability === "checking") return <main className="project-availability-state" role="status"><p>Checking project availability…</p></main>;
  if (projectAvailability === "missing") return <main className="project-availability-state" role="alert">
    <div><AppIcon icon="warning-sign" /><h1>This project is no longer available.</h1>
      <p>Its saved workspace tabs and selections were cleared from this browser.</p>
      <div className="project-availability-actions">
        <Link className="bp6-button" href={`/${locale}/projects`}>Return to projects</Link>
        <Link className="bp6-button bp6-intent-primary" href={`/${locale}/projects#create-project`}>Create new project</Link>
      </div>
    </div>
  </main>;
  if (projectAvailability === "error") return <main className="project-availability-state" role="alert">
    <div><AppIcon icon="warning-sign" /><h1>Project availability could not be checked.</h1>
      <p>Reconnect to the ChemDFT API and reload this page.</p>
      <div className="project-availability-actions"><Link className="bp6-button" href={`/${locale}/projects`}>Return to projects</Link></div>
    </div>
  </main>;

  // Medium tier (1100–1499) and 1024x600 compact: Explorer collapses to a 48 px icon rail by default
  const isRail = isMedium || (isNarrow && width >= 1000 && isCompact) || (isWide && explorerCollapsed);

  // Effective explorer width for CSS grid
  const effectiveExplorerWidth = focusMode
    ? 0
    : isRail
      ? 48
      : isNarrow
        ? 0
        : explorerCollapsed
          ? 0
          : explorerWidth;

  // Effective dock width for CSS grid
  const effectiveDockWidth = focusMode
    ? 0
    : isNarrow
      ? 0
      : dockCollapsed || !aiDockOpen
        ? 0
        : isMedium
          ? Math.max(Math.min(dockWidth, 380), 340)
          : dockWidth;

  const shellStyles: React.CSSProperties = {
    "--cdf-header-h": "44px",
    "--cdf-shelf-h": "22px",
    "--cdf-rail-w": "0px",
    "--cdf-explorer-w": `${effectiveExplorerWidth}px`,
    "--cdf-dock-w": `${effectiveDockWidth}px`,
  } as React.CSSProperties;

  const shellClasses = [
    "project-shell",
    workspaceMode === "guided" ? "mode-guided" : "mode-advanced",
    `tier-${tier}`,
    `density-${density}`,
    autoCompact ? "compact-viewport" : "",
    focusMode ? "in-focus-mode" : "",
    explorerCollapsed ? "explorer-collapsed" : "",
    dockCollapsed || !aiDockOpen ? "dock-collapsed" : "",
    isRail ? "explorer-rail-active" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      ref={shellRef}
      className={shellClasses}
      style={shellStyles}
      data-testid="project-shell"
      data-tier={tier}
      data-density={density}
      data-focus-mode={focusMode ? "active" : "inactive"}
    >
      <header className={`project-header${inlineNav ? " has-inline-nav" : ""}`}>
        {isNarrow ? (
          <div className="header-drawer-slot" data-testid="header-drawer-slot">
            <button
              type="button"
              className="workspace-drawer-trigger-btn"
              aria-label="Open explorer"
              title="Open project explorer"
              data-testid="explorer-drawer-trigger"
              onClick={() => {
                setAiDrawerOpen(false);
                setExplorerDrawerOpen((prev) => !prev);
              }}
            >
              <AppIcon icon="menu" />
            </button>
          </div>
        ) : null}

        <Link href={`/${locale}/projects`} className="header-brand">
          <BrandMark />
        </Link>
        <span className="header-divider" aria-hidden="true" />
        <div className="research-context" aria-label="Research context" data-testid="research-context">
          <Link className="project-identity" href={projectPath(locale, projectId, "overview")} title={`Project overview · ${projectId}`}>{projectName}</Link>
          {focus ? <>
            <AppIcon icon="chevron-right" />
            {focus.href && !onWorkspace
              ? <Link className="research-focus" href={focus.href} title={`Return to ${focus.focus}`} data-testid="research-focus">{focus.focus}</Link>
              : <span className="research-focus" title={focus.focus} data-testid="research-focus">{focus.focus}</span>}
          </> : null}
        </div>
        {inlineNav ? (
          <ProjectSectionNav
            locale={locale}
            projectId={projectId}
            collapseOverflow={!isWide}
            compactNav={width < 1100}
            iconOnly={width < 1366}
          />
        ) : null}
        <div className="header-actions">
          {width < 1100 ? (
            <ViewMenu
              density={density}
              setDensity={setDensity}
              focusMode={focusMode}
              setFocusMode={setFocusMode}
            />
          ) : (
            <>
              {/* Density toggle: Comfortable / Compact */}
              <button
                type="button"
                className={`density-toggle-btn ${density === "compact" ? "is-compact" : ""}`}
                aria-label={`Switch density (currently ${density})`}
                title={`Density: ${density === "compact" ? "Compact" : "Comfortable"}`}
                data-testid="density-toggle"
                onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
              >
                <AppIcon icon={density === "compact" ? "compressed" : "expand-all"} />
                <span className="density-toggle-label">{density === "compact" ? "Compact" : "Comfortable"}</span>
              </button>

              {/* Focus mode toggle */}
              <button
                type="button"
                className={`focus-mode-toggle-btn ${focusMode ? "active" : ""}`}
                aria-pressed={focusMode}
                aria-label={focusMode ? "Exit focus mode (Shift+F)" : "Enter focus mode (Shift+F)"}
                title={focusMode ? "Exit focus mode (Shift+F)" : "Focus mode (Shift+F) — fills the window with the viewer"}
                data-testid="focus-mode-toggle"
                onClick={() => setFocusMode(!focusMode)}
              >
                <AppIcon icon={focusMode ? "minimize" : "maximize"} />
              </button>
            </>
          )}

          <WorkspaceModeToggle mode={workspaceMode} onChange={(mode) => {
            if (mode === workspaceMode) return;
            if (!confirmDiscardUnsavedWork(`Switching to ${mode === "guided" ? "Guided" : "the Advanced Workbench"}`)) return;
            setWorkspaceMode(mode);
          }} />

          {/* AI Scientist trigger: on narrow screens opens slide-over drawer; on wider screens toggles inline dock */}
          <button
            type="button"
            className={`ai-dock-toggle ${(isNarrow ? aiDrawerOpen : aiDockOpen) ? "active" : ""}`}
            aria-pressed={isNarrow ? aiDrawerOpen : aiDockOpen}
            aria-label={(isNarrow ? aiDrawerOpen : aiDockOpen) ? "Hide AI Scientist panel" : "Show AI Scientist panel"}
            title={(isNarrow ? aiDrawerOpen : aiDockOpen) ? "Hide AI Scientist panel" : "Show AI Scientist panel"}
            data-testid="ai-dock-toggle"
            {...(aiApprovalPending ? { "aria-describedby": "ai-dock-toggle-pending" } : {})}
            onClick={() => {
              if (isNarrow) {
                setExplorerDrawerOpen(false);
                const next = !aiDrawerOpen;
                setAiDrawerOpen(next);
                if (next) {
                  window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist"));
                }
              } else {
                window.dispatchEvent(new CustomEvent(aiDockOpen ? "chemdft:toggle-dock" : "chemdft:open-ai-scientist"));
              }
            }}
          >
            <AppIcon icon="chat" /> AI Scientist
            {aiApprovalPending ? <span className="ai-dock-toggle-badge" id="ai-dock-toggle-pending">
              <span aria-hidden="true">1</span><span className="ai-visually-hidden">Approval waiting</span>
            </span> : null}
          </button>

          {isLocalDev ? <StatusTag>Local development</StatusTag> : null}
          <button className="icon-button" type="button" aria-label="Open command menu" disabled>
            <AppIcon icon="search" />
          </button>
          <HeaderIdentity locale={locale} />
        </div>
      </header>

      {/* Explorer in Grid: on wide/medium tiers, or rail on 1024x600 compact */}
      {(!isNarrow || isRail) && !focusMode ? (
        <>
          <ProjectExplorer
            projectId={projectId}
            isRail={isRail}
            onToggleCollapse={() => {
              if (isNarrow) {
                setExplorerDrawerOpen(true);
              } else {
                setExplorerCollapsed(!explorerCollapsed);
              }
            }}
            onExpandSection={() => {
              if (isNarrow) {
                setExplorerDrawerOpen(true);
              } else {
                setExplorerCollapsed(false);
              }
            }}
          />
          {!isRail ? (
            <WorkspaceSplitter
              id="cdf-explorer-splitter"
              label="Resize Explorer"
              side="left"
              width={effectiveExplorerWidth}
              minWidth={160}
              maxWidth={400}
              collapsed={explorerCollapsed}
              onWidthChange={setExplorerWidth}
              onToggleCollapse={() => setExplorerCollapsed(!explorerCollapsed)}
            />
          ) : null}
        </>
      ) : null}

      <main id="main-content" className="project-document">
        {inlineNav ? null : <ProjectSectionNav locale={locale} projectId={projectId} collapseOverflow={!isWide} />}
        {children}

        {/* Visible Exit Focus Button when in focus mode */}
        {focusMode ? (
          <div className="floating-exit-focus" data-testid="floating-exit-focus">
            <button
              type="button"
              className="floating-exit-focus-btn"
              aria-label="Exit focus mode"
              title="Exit focus mode (Shift+F)"
              data-testid="exit-focus-mode"
              onClick={() => setFocusMode(false)}
            >
              <AppIcon icon="minimize" />
              <span>Exit focus</span>
            </button>
          </div>
        ) : null}
      </main>

      {/* AI Dock in Grid: on wide/medium tiers when not in focus mode */}
      {!isNarrow && !focusMode ? (
        <>
          <WorkspaceSplitter
            id="cdf-dock-splitter"
            label="Resize AI Scientist dock"
            side="right"
            width={effectiveDockWidth}
            minWidth={260}
            maxWidth={540}
            collapsed={dockCollapsed || !aiDockOpen}
            onWidthChange={setDockWidth}
            onToggleCollapse={() => setDockCollapsed(!dockCollapsed)}
          />
          <aside className="context-dock" aria-label="Inspector and AI context">
            {catalogReady ? <ProjectDock projectId={projectId} /> : catalogError
              ? <CatalogUnavailable error={catalogError} heading="Saved project items couldn't be loaded" />
              : <p className="workspace-canvas-loading" role="status">Checking saved project items…</p>}
          </aside>
        </>
      ) : null}

      {/* Slide-over Drawers for Narrow Tier (< 1100 px). Rule: Never both at once. */}
      {isNarrow && !isRail && !explorerDrawerOpen ? (
        <div style={{ display: "none" }} aria-hidden="true">
          <ProjectExplorer projectId={projectId} isRail={false} />
        </div>
      ) : null}

      {isNarrow ? (
        <>
          <AppDrawer
            isOpen={explorerDrawerOpen}
            onClose={() => setExplorerDrawerOpen(false)}
            position={AppPosition.LEFT}
            size="400px"
            hasBackdrop={true}
            canEscapeKeyClose={true}
            canOutsideClickClose={true}
            className="workspace-slide-over-drawer"
            data-testid="explorer-drawer"
          >
            <div className="workspace-drawer-content" role="dialog" aria-label="Project Explorer drawer">
              <div className="workspace-drawer-header">
                <strong>Project Explorer</strong>
                <button
                  type="button"
                  className="workspace-drawer-close"
                  aria-label="Close Explorer"
                  onClick={() => setExplorerDrawerOpen(false)}
                >
                  <AppIcon icon="cross" />
                </button>
              </div>
              <div className="workspace-drawer-body">
                <ProjectExplorer projectId={projectId} isRail={false} />
              </div>
            </div>
          </AppDrawer>

          <AppDrawer
            isOpen={aiDrawerOpen}
            onClose={() => setAiDrawerOpen(false)}
            position={AppPosition.RIGHT}
            size="400px"
            hasBackdrop={true}
            canEscapeKeyClose={true}
            canOutsideClickClose={true}
            className="workspace-slide-over-drawer"
            data-testid="ai-scientist-drawer"
          >
            <div className="workspace-drawer-content" role="dialog" aria-label="AI Scientist drawer">
              <div className="workspace-drawer-body">
                <aside className="context-dock context-dock-drawer" aria-label="Inspector and AI context">
                  {catalogReady ? (
                    <ProjectDock
                      projectId={projectId}
                      initialTab="ai"
                      onClose={() => {
                        setAiDrawerOpen(false);
                        document.querySelector<HTMLButtonElement>('[data-testid="ai-dock-toggle"]')?.focus();
                      }}
                    />
                  ) : catalogError
                    ? <CatalogUnavailable error={catalogError} heading="Saved project items couldn't be loaded" />
                    : <p className="workspace-canvas-loading" role="status">Checking saved project items…</p>}
                </aside>
              </div>
            </div>
          </AppDrawer>
        </>
      ) : null}

      <footer className="activity-shelf">
        <span><i className="ready-dot" /> Ready</span>
        <span>Compute jobs available in Jobs</span>
        <span className="shelf-spacer" />
        <span>Provenance recording enabled</span>
      </footer>
    </div>
  );
}
