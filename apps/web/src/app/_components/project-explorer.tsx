"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppIcon, type IconName } from "@chemdft/ui";
import { loadWorkspaceInventory } from "@/lib/workspace-inventory";
import { selectionKey, workspaceSelectionUrl, type WorkspaceSelection } from "@/lib/workspace-selection";
import { workspaceSections, type WorkspaceSection } from "@/lib/workspace-tabs";
import {
  evidenceVocabularyTooltip,
  structureAuthorityCounts,
  structureAuthorityLabel,
  structureAuthorityTooltip,
} from "@/lib/workspace-authority";
import { useWorkspaceState, type WorkspaceCatalogItem } from "./workspace-state-provider";
import { OPEN_IMPORT_CALCULATION_EVENT } from "./external-import/import-calculation-dialog";
import { OPEN_IMPORT_SPECTRUM_EVENT } from "./experimental-spectra/import-spectrum-dialog";

export interface ProjectExplorerProps {
  projectId: string;
  isRail?: boolean;
  onToggleCollapse?: () => void;
  onExpandSection?: (section: WorkspaceSection) => void;
}

const sectionInfo: Record<WorkspaceSection, { label: string; icon: IconName }> = {
  files: { label: "Files", icon: "document" },
  structures: { label: "Structures", icon: "cube" },
  experimentalData: { label: "Datasets", icon: "timeline-events" },
  calculations: { label: "Calculations", icon: "application" },
  results: { label: "Results", icon: "tick" },
  notes: { label: "Notes", icon: "annotation" },
  history: { label: "History", icon: "history" },
};

function itemIcon(item: WorkspaceCatalogItem): IconName {
  if (item.selection.kind === "document" || item.selection.kind === "file") return "document";
  if (item.selection.kind === "documentEvidence") return "citation";
  if (["structureCandidate", "candidateRepresentation", "structureVersion", "scientificScene"].includes(item.selection.kind)) return "cube";
  if (item.selection.kind === "calculation" || item.selection.kind === "externalImport") return "application";
  if (item.selection.kind === "calculationResult" || item.selection.kind === "importedResult") return "tick";
  if (item.selection.kind === "note") return "annotation";
  return "history";
}

export function ProjectExplorer({ projectId, isRail = false, onToggleCollapse, onExpandSection }: ProjectExplorerProps) {
  const { state, activeSelection, catalog, openSelection, setCatalog, setCatalogError, toggleSection, toggleNode, staleNotice } = useWorkspaceState();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const items = await loadWorkspaceInventory(projectId);
      setCatalog(items);
      setError(null);
      setCatalogError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Project tree could not be loaded.";
      setError(message);
      setCatalogError(message);
    } finally { setLoading(false); }
  }, [projectId, setCatalog, setCatalogError]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load(); });
    const refresh = () => { if (active) void load(); };
    window.addEventListener("chemdft:document-imported", refresh);
    window.addEventListener("chemdft:workspace-items-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("chemdft:document-imported", refresh);
      window.removeEventListener("chemdft:workspace-items-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  function selectItem(selection: WorkspaceSelection, label: string) {
    if (window.location.pathname.endsWith("/workspace")) {
      openSelection(selection, label);
      return;
    }
    const locale = window.location.pathname.split("/")[1] ?? "en";
    const base = `${window.location.origin}/${locale}/projects/${projectId}/workspace`;
    window.location.assign(workspaceSelectionUrl(base, selection));
  }

  function openImportDialog() {
    if (window.location.pathname.endsWith("/workspace")) {
      window.dispatchEvent(new Event(OPEN_IMPORT_CALCULATION_EVENT));
      return;
    }
    const locale = window.location.pathname.split("/")[1] ?? "en";
    const target = new URL(`/${locale}/projects/${projectId}/workspace`, window.location.origin);
    target.searchParams.set("import", "calculation");
    window.location.assign(target.toString());
  }

  function openSpectrumDialog() {
    if (window.location.pathname.endsWith("/workspace")) {
      window.dispatchEvent(new Event(OPEN_IMPORT_SPECTRUM_EVENT));
      return;
    }
    const locale = window.location.pathname.split("/")[1] ?? "en";
    const target = new URL(`/${locale}/projects/${projectId}/workspace`, window.location.origin);
    target.searchParams.set("import", "spectrum");
    window.location.assign(target.toString());
  }

  // Pre-calculate counts for rail and sections
  const structureItems = catalog.filter((item) => item.section === "structures");
  const structureCounts = structureAuthorityCounts(structureItems);
  const fileItems = catalog.filter((item) => item.section === "files");
  const fileCount = fileItems.filter((item) => item.selection.kind === "file" || item.selection.kind === "document").length;
  const calcItems = catalog.filter((item) => item.section === "calculations");
  const calcCount = calcItems.length;
  const resultItems = catalog.filter((item) => item.section === "results");
  const resultCount = resultItems.length;
  const moreItems = catalog.filter((item) => ["experimentalData", "notes", "history"].includes(item.section));
  const moreCount = moreItems.length;

  if (isRail) {
    return (
      <aside className="project-explorer project-explorer-rail" aria-label="Project explorer" data-testid="project-explorer-rail">
        {onToggleCollapse ? (
          <button
            type="button"
            className="workspace-rail-toggle"
            aria-label="Expand explorer"
            title="Expand explorer"
            onClick={onToggleCollapse}
            data-testid="rail-expand-toggle"
          >
            <AppIcon icon="chevron-right" />
          </button>
        ) : null}
        <button
          type="button"
          className="workspace-rail-item"
          aria-label={`Structures (${structureCounts.committed} saved)`}
          title={structureAuthorityTooltip(structureCounts)}
          onClick={() => {
            if (onExpandSection) onExpandSection("structures");
            else if (onToggleCollapse) onToggleCollapse();
          }}
          data-testid="rail-item-structures"
        >
          <AppIcon icon="cube" />
          <span className="workspace-rail-count" data-testid="rail-count-structures">
            {loading ? "…" : structureCounts.committed}
          </span>
        </button>
        <button
          type="button"
          className="workspace-rail-item"
          aria-label={`Files (${fileCount})`}
          title={`Files (${fileCount})`}
          onClick={() => {
            if (onExpandSection) onExpandSection("files");
            else if (onToggleCollapse) onToggleCollapse();
          }}
          data-testid="rail-item-files"
        >
          <AppIcon icon="document" />
          <span className="workspace-rail-count" data-testid="rail-count-files">
            {loading ? "…" : fileCount}
          </span>
        </button>
        <button
          type="button"
          className="workspace-rail-item"
          aria-label={`Calculations (${calcCount})`}
          title={`Calculations (${calcCount})`}
          onClick={() => {
            if (onExpandSection) onExpandSection("calculations");
            else if (onToggleCollapse) onToggleCollapse();
          }}
          data-testid="rail-item-calculations"
        >
          <AppIcon icon="application" />
          <span className="workspace-rail-count" data-testid="rail-count-calculations">
            {loading ? "…" : calcCount}
          </span>
        </button>
        <button
          type="button"
          className="workspace-rail-item"
          aria-label={`Results (${resultCount})`}
          title={`Results (${resultCount})`}
          onClick={() => {
            if (onExpandSection) onExpandSection("results");
            else if (onToggleCollapse) onToggleCollapse();
          }}
          data-testid="rail-item-results"
        >
          <AppIcon icon="tick" />
          <span className="workspace-rail-count" data-testid="rail-count-results">
            {loading ? "…" : resultCount}
          </span>
        </button>
        <button
          type="button"
          className="workspace-rail-item"
          aria-label={`More: Datasets, Notes, History (${moreCount})`}
          title={`More: Datasets, Notes, History (${moreCount})`}
          onClick={() => {
            if (onExpandSection) onExpandSection("experimentalData");
            else if (onToggleCollapse) onToggleCollapse();
          }}
          data-testid="rail-item-more"
        >
          <AppIcon icon="more" />
          <span className="workspace-rail-count" data-testid="rail-count-more">
            {loading ? "…" : moreCount}
          </span>
        </button>
      </aside>
    );
  }

  function renderItem(item: WorkspaceCatalogItem, depth: number): ReactNode {
    const key = selectionKey(item.selection);
    const selected = activeSelection && selectionKey(activeSelection) === key;
    const children = catalog.filter((child) => child.parentKey === key);
    const defaultOpen = item.selection.kind === "file" || item.selection.kind === "structureCandidate" || item.selection.kind === "experimentalSpectrum";
    const open = state.nodeExpansion[key] ?? defaultOpen;
    return <div key={key}>
      <div className="workspace-tree-node-row" style={{ paddingLeft: 9 + depth * 12 }}>
      {children.length ? <button type="button" className="workspace-tree-node-toggle"
        aria-label={`${open ? "Collapse" : "Expand"} ${item.label}`} aria-expanded={open}
        onClick={() => toggleNode(key, defaultOpen)}><AppIcon icon={open ? "chevron-down" : "chevron-right"} /></button>
        : <span className="workspace-tree-node-spacer" />}
      <button type="button" className="workspace-tree-item"
        aria-current={selected ? "page" : undefined} title={`${item.label}${item.detail ? ` · ${item.detail}` : ""}`}
        data-testid={`tree-item-${item.selection.kind}`}
        onClick={() => selectItem(item.selection, item.label)}>
        <AppIcon icon={itemIcon(item)} /><span className="workspace-tree-label">{item.label}</span>
        {item.authority === "CANDIDATE" ? (
          <span className="workspace-tree-authority candidate" title={evidenceVocabularyTooltip("CANDIDATE")}>U</span>
        ) : null}
        {item.authority === "COMMITTED" ? (
          <span className="workspace-tree-authority committed" title={evidenceVocabularyTooltip("COMMITTED")}>V</span>
        ) : null}
        {item.authority === "IMPORTED" ? (
          <span className="workspace-tree-authority imported" title={evidenceVocabularyTooltip("IMPORTED")}>I</span>
        ) : null}
        {item.authority === "EXPERIMENTAL" ? (
          <span className="workspace-tree-authority experimental" title={evidenceVocabularyTooltip("EXPERIMENTAL")}>E</span>
        ) : null}
      </button>
      </div>
      {open ? children.map((child) => renderItem(child, depth + 1)) : null}
    </div>;
  }

  // Release 0.0.33: Filter sections with content; fold empty sections into one "Nothing yet" line
  const sectionsWithContent: WorkspaceSection[] = [];
  const emptySections: WorkspaceSection[] = [];

  for (const section of workspaceSections) {
    const items = catalog.filter((item) => item.section === section);
    if (items.length > 0) {
      sectionsWithContent.push(section);
    } else {
      emptySections.push(section);
    }
  }

  return <aside className="project-explorer" aria-label="Project explorer" data-testid="project-explorer-panel">
    <div className="panel-heading">
      <strong>Explorer</strong>
      {onToggleCollapse ? (
        <button
          type="button"
          className="workspace-panel-collapse-btn"
          aria-label="Collapse explorer to rail"
          title="Collapse explorer to rail"
          onClick={onToggleCollapse}
          data-testid="explorer-collapse-btn"
        >
          <AppIcon icon="chevron-left" />
        </button>
      ) : <span>PROJECT</span>}
    </div>
    <div className="tree-row selected"><AppIcon icon="folder-open" /> <strong>Project root</strong></div>
    {staleNotice ? <p className="workspace-tree-notice" role="status">{staleNotice}</p> : null}
    {error ? <p className="workspace-tree-notice" role="alert">{error} Reopen the workspace to retry.</p> : null}
    {sectionsWithContent.map((section) => {
      const items = catalog.filter((item) => item.section === section);
      const count = section === "files" ? items.filter((item) => item.selection.kind === "file").length : items.length;
      const counts = structureAuthorityCounts(items);
      const structureAuthority = section === "structures" ? structureAuthorityLabel(counts) : null;
      const structureTooltip = section === "structures" ? structureAuthorityTooltip(counts) : undefined;
      const roots = items.filter((item) => !item.parentKey || !items.some((parent) => selectionKey(parent.selection) === item.parentKey));
      const expanded = state.expanded.includes(section);
      return <section className="workspace-tree-section" key={section} aria-label={sectionInfo[section].label}>
        <button type="button" className="workspace-tree-section-toggle" aria-expanded={expanded}
          title={structureTooltip}
          onClick={() => toggleSection(section)} data-testid={`tree-section-${section}`}>
          <AppIcon icon={expanded ? "chevron-down" : "chevron-right"} />
          <AppIcon icon={sectionInfo[section].icon} />
          <span>{sectionInfo[section].label}</span>
          <span>{loading ? "…" : structureAuthority ?? count}</span>
        </button>
        {section === "files" ? <span className="workspace-tree-test-count" data-testid="explorer-document-count">{items.filter((item) => item.selection.kind === "document").length}</span> : null}
        {expanded && section === "files" ? <button type="button" className="import-explorer-action" data-testid="explorer-import-calculation"
          onClick={openImportDialog}>Import calculation…</button> : null}
        {expanded && section === "experimentalData" ? <button type="button" className="import-explorer-action" data-testid="explorer-import-spectrum"
          onClick={openSpectrumDialog}>Import experimental spectrum…</button> : null}
        {expanded ? roots.length ? roots.map((item) => renderItem(item, 0)) :
          <div className="workspace-tree-empty">{loading ? "Loading…" : "No saved items"}</div> : null}
      </section>;
    })}
    {emptySections.length > 0 ? (
      <div className="workspace-tree-empty-fold" data-testid="explorer-empty-fold">
        <span className="workspace-tree-empty-fold-label">Nothing yet:</span>{" "}
        <span className="workspace-tree-empty-fold-items">
          {emptySections.map((s, idx) => (
            <span key={s} data-testid={`tree-section-${s}`} className="workspace-tree-empty-item">
              {idx > 0 ? ", " : ""}{sectionInfo[s].label} (0)
            </span>
          ))}
        </span>
      </div>
    ) : null}
  </aside>;
}
