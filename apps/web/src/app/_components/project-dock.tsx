"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AppIcon } from "@chemdft/ui";
import type { AICitation } from "@chemdft/schemas";
import { useWorkspaceState } from "./workspace-state-provider";
import { StructureVersionInspector } from "./structure-version-inspector";
import type { StructureInspectorContext } from "@/lib/structure-workbench";
import { compactStructureTitle } from "@/lib/structure-workbench";
import { ElectronicFieldInspector } from "./electronic-field-inspector";
import { EvidenceWorkspacePanel } from "../[locale]/projects/[projectId]/workspace/evidence-workspace-panel";
import type { ElectronicInspectorContext } from "@/lib/electronic-workbench";
import { getProject } from "@/lib/project-api";
import { resolveAiContext, usePublishedAiContext, type AiPageContext } from "@/lib/ai-context";
import { activeProjectSection } from "@/lib/project-sections";
import { requestWorkspaceAnnouncement } from "@/lib/workspace-announce";
import { CompareDockNotice } from "./compare/compare-dock-notice";

import { mergeWorkspaceScope } from "@/lib/workspace-scope";
import {
  AIScientistPanel,
  type WorkspaceScope,
} from "../[locale]/projects/[projectId]/workspace/ai-scientist-panel";

interface ProjectDockProps {
  projectId: string;
  onClose?: (() => void) | undefined;
  initialTab?: "inspector" | "ai" | undefined;
}

export function ProjectDock({ projectId, onClose, initialTab }: ProjectDockProps) {
  return <ProjectDockInner key={projectId} projectId={projectId} onClose={onClose} initialTab={initialTab} />;
}

function ProjectDockInner({ projectId, onClose, initialTab }: ProjectDockProps) {
  const pathname = usePathname();
  const { activeSelection, activeTab: workspaceTab, catalog, openSelection, workspaceMode } = useWorkspaceState();
  const selectionRef = useRef(activeSelection);
  useLayoutEffect(() => { selectionRef.current = activeSelection; }, [activeSelection]);
  const [activeTab, setActiveTab] = useState<"inspector" | "ai">(initialTab ?? "ai");
  const keepAiForSelectionRef = useRef<string | null>(null);
  const [aiApprovalPending, setAiApprovalPending] = useState(false);
  useEffect(() => {
    const onApproval = (event: Event) => setAiApprovalPending(Boolean((event as CustomEvent<{ pending: boolean }>).detail?.pending));
    window.addEventListener("chemdft:ai-approval-state", onApproval);
    return () => window.removeEventListener("chemdft:ai-approval-state", onApproval);
  }, []);

  // ≤1200 px the dock is a drawer/sheet: opening moves focus into it, Escape closes it,
  // and closing returns focus to the header toggle so keyboard users never lose their place.
  useEffect(() => {
    const compact = window.matchMedia("(max-width: 1200px)");
    const dock = () => document.querySelector<HTMLElement>(".context-dock");
    const toggle = () => document.querySelector<HTMLButtonElement>('[data-testid="ai-dock-toggle"]');
    let open = false;
    const onState = (event: Event) => {
      const visible = Boolean((event as CustomEvent<{ visible: boolean }>).detail?.visible);
      const wasOpen = open;
      open = visible;
      if (!compact.matches) return;
      if (visible && !wasOpen) {
        window.requestAnimationFrame(() => {
          const root = dock();
          const target = root?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
            ?? root?.querySelector<HTMLElement>('[data-testid="ai-dock-close"]') ?? root?.querySelector<HTMLElement>("button");
          target?.focus();
        });
      } else if (!visible && wasOpen && dock()?.contains(document.activeElement)) {
        toggle()?.focus();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !open || !compact.matches || event.defaultPrevented) return;
      if (!dock()?.contains(document.activeElement)) return;
      // A dialog inside the sheet (e.g. tool details) handles its own Escape first.
      if (dock()?.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      window.dispatchEvent(new CustomEvent("chemdft:toggle-dock"));
      toggle()?.focus();
    };
    window.addEventListener("chemdft:dock-state", onState);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("chemdft:dock-state", onState);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  const [electronicContext, setElectronicContext] = useState<ElectronicInspectorContext | null>(null);
  const [structureContext, setStructureContext] = useState<StructureInspectorContext | null>(null);
  const [scope, setScope] = useState<WorkspaceScope>({});
  const [prevProjectId, setPrevProjectId] = useState(projectId);

  if (projectId !== prevProjectId) {
    setPrevProjectId(projectId);
    setScope({});
    setElectronicContext(null);
    setStructureContext(null);
  }

  useEffect(() => {
    let active = true;
    void getProject(projectId).then((project) => {
      if (active) setScope((prev) => ({ ...prev, projectName: project.name, currentView: prev.currentView ?? `${project.name} → Overview` }));
    }).catch(() => {
      if (active) setScope((prev) => ({ ...prev, projectName: "Project", currentView: prev.currentView ?? "Project overview" }));
    });

    function handleWorkspaceSelection(event: Event) {
      const customEvent = event as CustomEvent<WorkspaceScope & { projectId?: string }>;
      if (customEvent.detail) {
        if (customEvent.detail.projectId && customEvent.detail.projectId !== projectId) {
          return;
        }
        const selected = selectionRef.current;
        if (selected?.kind === "calculationResult" && customEvent.detail.resultId &&
          (customEvent.detail.resultId !== selected.id || customEvent.detail.calculationId !== selected.sourceId)) return;
        // The announcement describes the current page: nothing page-bound from the previous page survives.
        setScope((prev) => mergeWorkspaceScope(prev, customEvent.detail));
      }
    }

    function handleInspector() { setActiveTab("inspector"); }
    function handleElectronic(event: Event) {
      const detail = (event as CustomEvent<ElectronicInspectorContext>).detail;
      if (detail && detail.projectId === projectId) setElectronicContext(detail);
    }
    function handleStructure(event: Event) {
      const detail = (event as CustomEvent<StructureInspectorContext>).detail;
      if (detail && detail.projectId === projectId) setStructureContext(detail);
    }
    function handleOpenAiScientist(event: Event) {
      // A selection made from inside the AI Scientist (Plan prerequisite) keeps the AI tab open.
      const keep = (event as CustomEvent<{ keepForSelectionId?: string } | null>).detail?.keepForSelectionId;
      if (keep) keepAiForSelectionRef.current = keep;
      setActiveTab("ai");
    }
    function handleComparisonSummary() {
      setActiveTab("ai");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("chemdft:ai-comparison-summary")), 0);
    }

    window.addEventListener("chemdft:open-inspector", handleInspector);
    window.addEventListener("chemdft:electronic-inspector", handleElectronic);
    window.addEventListener("chemdft:structure-inspector", handleStructure);
    window.addEventListener("chemdft:workspace-selection", handleWorkspaceSelection);
    window.addEventListener("chemdft:open-ai-scientist", handleOpenAiScientist);
    window.addEventListener("chemdft:comparison-summary", handleComparisonSummary);
    // The Workspace announces its selection once; ask it to repeat now that this dock is listening.
    requestWorkspaceAnnouncement(projectId);

    return () => {
      active = false;
      window.removeEventListener("chemdft:open-inspector", handleInspector);
      window.removeEventListener("chemdft:electronic-inspector", handleElectronic);
      window.removeEventListener("chemdft:structure-inspector", handleStructure);
      window.removeEventListener("chemdft:workspace-selection", handleWorkspaceSelection);
      window.removeEventListener("chemdft:open-ai-scientist", handleOpenAiScientist);
      window.removeEventListener("chemdft:comparison-summary", handleComparisonSummary);
    };
  }, [projectId]);

  const selectionKind = activeSelection?.kind;
  const selectionId = activeSelection?.id;
  const isGuided = workspaceMode === "guided";
  const effectiveTab = isGuided ? "ai" : activeTab;

  useEffect(() => {
    if (initialTab === "ai") return;
    if (workspaceMode === "advanced" && selectionKind && ["structureVersion", "optimizedStructureVersion", "scientificScene"].includes(selectionKind)) {
      if (selectionId && keepAiForSelectionRef.current === selectionId) {
        keepAiForSelectionRef.current = null;
        return;
      }
      queueMicrotask(() => setActiveTab("inspector"));
    }
  }, [selectionKind, selectionId, workspaceMode, initialTab]);

  function handleCitationClick(citation: AICitation) {
    if (citation.source_record_type === "navigator") {
      window.dispatchEvent(new CustomEvent("chemdft:guided-navigate", { detail: { view: "home" } }));
    } else if (citation.citation_type === "DOCUMENT") {
      const document = catalog.find((item) => item.selection.kind === "document" && item.selection.id === citation.entity_id);
      openSelection({ kind: "document", id: citation.entity_id, projectId,
        ...(citation.page_number ? { locator: { page: citation.page_number,
          ...(citation.source_anchor_id ? { anchorId: citation.source_anchor_id } : {}) } } : {}) },
      document?.label ?? citation.label);
    } else {
      const record = catalog.find((item) => item.selection.id === citation.entity_id ||
        ("sourceId" in item.selection && item.selection.sourceId === citation.entity_id));
      if (record) openSelection(record.selection, record.label);
    }
    window.dispatchEvent(
      new CustomEvent("chemdft:citation-click", {
        detail: citation,
      }),
    );
  }

  const projectName = scope.projectName ?? "Project";
  const defaultProjectOverview = `${projectName} → Overview`;

  const safeSelection = activeSelection && activeSelection.projectId === projectId ? activeSelection : null;
  const isStructureSelection = Boolean(
    safeSelection &&
    ["structureVersion", "optimizedStructureVersion", "scientificScene"].includes(safeSelection.kind)
  );
  const activeStructureContext =
    isStructureSelection && structureContext && structureContext.projectId === projectId && structureContext.detail.version.id === safeSelection?.id
      ? structureContext
      : null;
  const isCalculationResult = Boolean(safeSelection && safeSelection.kind === "calculationResult");
  const selectedEnergyView = isCalculationResult && scope.resultId === safeSelection?.id && scope.calculationId === (safeSelection && "sourceId" in safeSelection ? safeSelection.sourceId : undefined) && (scope.currentView?.startsWith("Total Energy") || scope.currentView?.startsWith("Optimization trajectory") || scope.currentView?.startsWith("CREST ensemble"))
    ? scope.currentView : null;
  const validStructureContext = structureContext && structureContext.projectId === projectId ? structureContext : null;
  const validElectronicContext = electronicContext && electronicContext.projectId === projectId ? electronicContext : null;

  const activeCatalogItem = safeSelection
    ? catalog.find((item) => item.selection.kind === safeSelection.kind && item.selection.id === safeSelection.id)
    : null;

  const isThermochemistryResult = Boolean(
    isCalculationResult && (
      scope.currentView?.includes("Thermochemistry") ||
      workspaceTab?.label?.includes("Thermochemistry") ||
      activeCatalogItem?.label?.includes("Thermochemistry")
    )
  );

  const isRamanResult = Boolean(
    isCalculationResult && !isThermochemistryResult && (
      (scope.resultId === safeSelection?.id && scope.currentView?.includes("Raman")) ||
      workspaceTab?.label?.includes("Raman") ||
      activeCatalogItem?.label?.includes("Raman")
    )
  );

  const isIrResult = Boolean(
    isCalculationResult && !isRamanResult && !isThermochemistryResult && (
      (scope.resultId === safeSelection?.id && (scope.currentView?.includes("IR") || scope.currentView?.includes("Vibrational"))) ||
      workspaceTab?.label?.includes("IR") ||
      activeCatalogItem?.label?.includes("IR") ||
      activeCatalogItem?.detail?.toLowerCase().includes("vibrational")
    )
  );

  const isUvVisResult = Boolean(
    isCalculationResult && !isIrResult && !isRamanResult && !isThermochemistryResult && (
      (scope.resultId === safeSelection?.id && (scope.currentView?.includes("UV/Vis") || scope.currentView?.includes("TDDFT"))) ||
      workspaceTab?.label?.includes("UV/Vis") ||
      activeCatalogItem?.label?.includes("UV/Vis") ||
      activeCatalogItem?.detail?.toLowerCase().includes("tddft")
    )
  );

  const structPrefix = validStructureContext
    ? compactStructureTitle(validStructureContext.detail.structure.name, validStructureContext.detail.version.revision)
    : (scope.structureName
        ? compactStructureTitle(scope.structureName, scope.structureVersionRevision ?? 1)
        : (projectName && projectName !== "Project" ? `${projectName} V1` : "Water V1"));

  const irViewLabel = (scope.resultId === safeSelection?.id && scope.currentView && (scope.currentView.includes("IR") || scope.currentView.includes("Vibrational")))
    ? scope.currentView
    : (scope.selectedModeIndex !== undefined && scope.selectedModeFrequency !== undefined)
      ? `${structPrefix} → IR → Mode ${scope.selectedModeIndex + 1} · ${Number(scope.selectedModeFrequency).toFixed(1)} cm⁻¹`
      : `${structPrefix} → IR spectrum`;

  const thermochemistryViewLabel = (scope.resultId === safeSelection?.id && scope.currentView?.includes("Thermochemistry"))
    ? scope.currentView
    : `${structPrefix} → Thermochemistry`;

  const ramanViewLabel = (scope.resultId === safeSelection?.id && scope.currentView?.includes("Raman"))
    ? scope.currentView
    : (scope.selectedModeIndex !== undefined && scope.selectedModeFrequency !== undefined)
      ? `${structPrefix} → Raman → Mode ${scope.selectedModeIndex + 1} · ${Number(scope.selectedModeFrequency).toFixed(1)} cm⁻¹`
      : `${structPrefix} → Raman spectrum`;

  const uvvisViewLabel = (scope.resultId === safeSelection?.id && scope.currentView && scope.currentView.includes("UV/Vis"))
    ? scope.currentView
    : `${structPrefix} → UV/Vis spectrum`;

  let resolvedViewLabel = defaultProjectOverview;
  if (workspaceMode === "guided") {
    if (selectedEnergyView) {
      resolvedViewLabel = selectedEnergyView;
    } else if (isThermochemistryResult) {
      resolvedViewLabel = thermochemistryViewLabel;
    } else if (isRamanResult) {
      resolvedViewLabel = ramanViewLabel;
    } else if (isIrResult) {
      resolvedViewLabel = irViewLabel;
    } else if (isUvVisResult) {
      resolvedViewLabel = uvvisViewLabel;
    } else if (isCalculationResult && (scope.currentView?.startsWith("CREST ensemble") || scope.currentView?.startsWith("Selected scientific result"))) {
      resolvedViewLabel = scope.resultId === safeSelection?.id ? scope.currentView : workspaceTab?.label ?? "Selected scientific result";
    } else if (isStructureSelection) {
      resolvedViewLabel = scope.structureName
        ? compactStructureTitle(scope.structureName, scope.structureVersionRevision ?? 1)
        : structureContext && structureContext.projectId === projectId
          ? compactStructureTitle(structureContext.detail.structure.name, structureContext.detail.version.revision)
          : scope.currentView && !scope.currentView.includes(" → ")
            ? scope.currentView
            : defaultProjectOverview;
    } else if (scope.currentView && (scope.currentView.includes(" → ") || (!isCalculationResult && (scope.currentView.startsWith(projectName) || scope.currentView.includes("Water"))))) {
      resolvedViewLabel = scope.currentView;
    } else if (isCalculationResult) {
      resolvedViewLabel = workspaceTab?.label ?? "Selected scientific result";
    } else if (structureContext && structureContext.projectId === projectId) {
      resolvedViewLabel = compactStructureTitle(structureContext.detail.structure.name, structureContext.detail.version.revision);
    } else {
      resolvedViewLabel = defaultProjectOverview;
    }
  } else {
    // Advanced mode:
    if (!safeSelection) {
      resolvedViewLabel = defaultProjectOverview;
    } else if (selectedEnergyView) {
      resolvedViewLabel = selectedEnergyView;
    } else if (isThermochemistryResult) {
      resolvedViewLabel = thermochemistryViewLabel;
    } else if (isRamanResult) {
      resolvedViewLabel = ramanViewLabel;
    } else if (isIrResult) {
      resolvedViewLabel = irViewLabel;
    } else if (isUvVisResult) {
      resolvedViewLabel = uvvisViewLabel;
    } else if (activeStructureContext) {
      resolvedViewLabel = compactStructureTitle(activeStructureContext.detail.structure.name, activeStructureContext.detail.version.revision);
    } else if (isCalculationResult && scope.currentView && (scope.currentView.startsWith("Electronic structure") || scope.currentView.includes("Thermochemistry") || scope.currentView.includes("UV/Vis") || scope.currentView.includes("IR") || scope.currentView.includes("Vibrational"))) {
      resolvedViewLabel = scope.currentView;
    } else if (scope.currentView && isStructureSelection && (scope.currentView.includes("Water") || scope.currentView.startsWith(projectName))) {
      resolvedViewLabel = scope.currentView;
    } else if (workspaceTab?.label) {
      resolvedViewLabel = workspaceTab.label;
    } else if (scope.currentView) {
      resolvedViewLabel = scope.currentView;
    }
  }

  const resolvedSelection = isGuided && scope.currentView === defaultProjectOverview ? null : safeSelection ?? (
    workspaceMode === "guided" && structureContext && structureContext.projectId === projectId ? {
      kind: "structureVersion" as const,
      id: structureContext.detail.version.id,
      projectId,
      sourceId: structureContext.detail.structure.id,
    } : null
  );

  // One AI context per page. The Workspace route (and an unrecognised route) is bridged from the Workspace selection and
  // its events; every other page publishes its own context, and a page that publishes nothing gets the project default,
  // never the Workspace selection.
  const published = usePublishedAiContext(projectId);
  const section = activeProjectSection(pathname, projectId);
  const bridged = section === null || section === "workspace";
  const pageContext: AiPageContext = bridged
    ? { page: "workspace", label: resolvedViewLabel, selection: resolvedSelection }
    : published ?? { page: "project", section: "overview", label: "Overview" };
  const aiContext = resolveAiContext(projectId, projectName, pageContext);

  return (
    <div className={`project-dock-inner ${effectiveTab === "ai" ? "ai-dock-active" : ""} ${isGuided ? "guided-dock" : ""}`}>
      {/* If not guided and on inspector, render the dock-tabs row.
          If not guided and on AI, the dock tabs are merged into AIScientistHeader to save vertical space. */}
      {!isGuided && effectiveTab === "inspector" ? (
        <div className="dock-tabs" role="tablist" aria-label="Context panels">
          <button
            role="tab"
            type="button"
            aria-selected={true}
            onClick={() => setActiveTab("inspector")}
            data-testid="dock-inspector-tab"
          >
            Inspector
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={false}
            onClick={() => setActiveTab("ai")}
            data-testid="ai-scientist-tab"
            {...(aiApprovalPending ? { "aria-describedby": "dock-ai-pending" } : {})}
          >
            AI Scientist
            {aiApprovalPending ? <span className="dock-tab-badge" id="dock-ai-pending"><span aria-hidden="true">1</span><span className="ai-visually-hidden">Approval waiting</span></span> : null}
          </button>
          {/* Narrow screens / slide-over drawer close control (hidden on inline desktop dock). */}
          <button
            type="button"
            className="dock-sheet-close"
            aria-label="Close AI Scientist"
            data-testid="dock-sheet-close"
            onClick={() => {
              if (onClose) {
                onClose();
              } else {
                window.dispatchEvent(new CustomEvent("chemdft:toggle-dock"));
                document.querySelector<HTMLButtonElement>('[data-testid="ai-dock-toggle"]')?.focus();
              }
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      <div className="dock-inspector-content" hidden={effectiveTab !== "inspector"}>
        {validStructureContext && safeSelection?.id === validStructureContext.detail.version.id ? <StructureVersionInspector context={validStructureContext} /> : validElectronicContext && safeSelection?.id === validElectronicContext.resultId ? <ElectronicFieldInspector context={validElectronicContext} /> : <>
          <div className="dock-section">
            <strong>Current selection</strong>
            <p>{safeSelection && workspaceTab?.label ? workspaceTab.label : defaultProjectOverview}{safeSelection?.locator?.page ? ` · page ${safeSelection.locator.page}` : ""}</p>
          </div>
          <div className="dock-section">
            <strong>Provenance</strong>
            <p>{safeSelection ? (catalog.find((item) => item.selection.kind === safeSelection.kind && item.selection.id === safeSelection.id)?.detail ?? "Select a project item to inspect its source and authority.") : "Select a project item to inspect its source and authority."}</p>
          </div>
          <div className="dock-section">
            <div className="ai-switch-cta">
              <AppIcon icon="predictive-analysis" />
              <div>
                <strong>AI Scientist Ready</strong>
                <p>Ground questions in project structures, results, and documents.</p>
              </div>
            </div>
            <button
              type="button"
              className="dock-switch-button"
              onClick={() => setActiveTab("ai")}
            >
              Open AI Scientist
            </button>
          </div>
        </>}
      </div>
      <div className="dock-ai-content" hidden={effectiveTab !== "ai"}>
        {/* Inside the flex column so the panel takes the remaining height; above the dock it overflowed by its own height. */}
        <CompareDockNotice projectId={projectId} />
        <AIScientistPanel
          visible={effectiveTab === "ai"}
          projectId={projectId}
          scope={scope}
          aiContext={aiContext}
          onCitationClick={handleCitationClick}
          onSelectInspector={effectiveTab === "ai" ? () => setActiveTab("inspector") : undefined}
          isAdvanced={!isGuided}
          onClose={onClose}
        />
        <EvidenceWorkspacePanel projectId={projectId} />
      </div>
    </div>
  );
}
