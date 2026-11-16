"use client";
import { readStored, writeStored } from "@/lib/safe-storage";
import { resultHeaderBelongsToView } from "@/lib/result-view-match";
import { useLatestRef } from "@/lib/use-latest-ref";
import { plural } from "@/lib/overview-model";
import { CatalogUnavailable } from "@/app/_components/catalog-unavailable";
import { CalculationScientificSummary } from "@/app/_components/calculation-scientific-summary";
import { formatTimestamp } from "@/lib/timestamps";
import { approvalCoordinate } from "@/lib/approval-geometry";

import { saveBlob } from "@/lib/download";
import { ExportMenu } from "@/app/_components/export/export-menu";
import { useWorkspaceTier } from "@/lib/workspace-tiers";
import { CalculationCapabilitiesProvider } from "@/lib/use-calculation-capabilities";
import { NavigatorLauncher } from "@/app/_components/navigator-launcher";
import { useParams } from "next/navigation";
import { navigatorSelection } from "@/lib/navigator-navigation";
import { vibrationalSpectrumLabel } from "@/lib/vibrational-kind";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildCandidatePreviewScene,
  buildScientificScene,
  inferVisualBonds,
  type MeasurementKind,
  type PreviewScene,
  type ScientificScene,
} from "@chemdft/scientific-scene";
import type {
  Atom,
  AICitation,
  Bond,
  CalculationDetail,
  CalculationResult,
  MolecularOrbitalAnalysis,
  CandidateRepresentationDetail,
  CandidateCellParameters,
  CandidateRepresentationReviewChecklist,
  CandidateRepresentationView,
  PeriodicCell,
  StructureCandidatePromotionOutput,
  GeometryCandidateView,
  StructureImportOutput,
  StructureSummary,
  StructureVersionDetail,
  ProjectMemoryView,
  TddftResult,
  VibrationalAnalysis,
} from "@chemdft/schemas";
import { ActionButton, AppIcon, AppPopover, Hint, StatusTag } from "@chemdft/ui";

import {
  getStructureVersion,
  exportStructureVersion,
  importStructure,
  listStructures,
  listStructureVersions,
  getCalculation,
  submitCalculation,
  getGeometryCandidate,
  getGeometryCandidateDrawing,
} from "@/lib/structure-workspace-api";
import { getProject } from "@/lib/project-api";
import {
  createDigitizedDataset,
  createXrdDigitizedDataset,
  createGraphDigitizedDataset,
  documentSourceUrl,
  getCandidateRepresentation,
  getDocument,
  importDocument,
  importExperimentalDataset,
  importCandidateCoordinates,
  listDocuments,
  listExperimentalDatasets,
  listStructureCandidates,
  listCandidateRepresentations,
  pasteCandidateCoordinates,
  promoteStructureCandidate,
  rejectCandidateRepresentation,
  reviewCandidateRepresentation,
  reviewEvidence,
  reviewStructureCandidate,
  rejectStructureCandidate,
  extractDocumentFigures,
  recognizeCandidateFigure,
  getCandidateFigureUrl,
  type CandidateRecognitionProposalView,
} from "@/lib/phase7-api";
import { latestRecognitionRepresentations, recognitionProposalFromDetail } from "@/lib/recognition-proposal";
import { CandidateFigureRecognitionPanel, type MolecularRecognitionCandidateView } from "./visualization/candidate-figure-recognition-panel";
import type { EvidenceCandidate, ExperimentalDatasetView, ScientificDocument, StructureCandidate, XrdDigitizationSession, XrdDigitizedDatasetInput, GraphDigitizationSession, GraphDigitizedDatasetInput } from "@chemdft/schemas";
import { calibratedPoint, formatDigitizedDlsPoint, normalizedAnchorToCssRect, type DigitizerPoint, type SourceRenderFrame, type XrdDigitizerCaptureMode, type XrdDigitizerDraft } from "@/lib/digitizer";

import { getProductContext } from "@/lib/ai-scientist-api";
import dynamic from "next/dynamic";
import { KetcherEditorPanel } from "./ketcher-editor";
// The whole molecule editor (Ketcher included) loads only when a drawing is opened.
const MoleculeEditorPane = dynamic(() => import("./molecule-editor-pane").then((module) => module.MoleculeEditorPane), {
  ssr: false,
  loading: () => <div className="ketcher-loading" role="status">Loading the structure editor…</div>,
});
import { MolecularCorrectionWorkbench } from "./molecular-correction-workbench";
import { ConformerSearchPanel, ConformerRunStatus } from "@/app/_components/conformers/conformer-search-panel";
import { ConformerEnsembleExplorer } from "@/app/_components/conformers/conformer-ensemble-explorer";
import { CalculationPanel } from "./calculation-panel";
import { StructureVersionWorkbench } from "./visualization/structure-version-workbench";
import { compactStructureTitle } from "@/lib/structure-workbench";
import { composition as elementComposition, newMoleculeTarget, newVersionTarget, nextRevision, type EditorTarget } from "@/lib/molecule-target";
import { ScientificVisualizationPanel } from "./visualization/scientific-visualization-panel";
import { OptimizationTrajectoryPanel } from "./visualization/optimization-trajectory-panel";
import { IrSpectroscopyPanel } from "./visualization/ir-spectroscopy-panel";
import { RamanSpectroscopyPanel } from "./visualization/raman-spectroscopy-panel";
import { MolecularOrbitalWorkspace } from "./visualization/molecular-orbital-workspace";
import { CandidatePreviewPanel } from "./visualization/candidate-preview-panel";
import { GeometryCandidateWorkspace } from "./geometry-candidate-workspace";
import { KnowledgeSearchPanel } from "./knowledge-search-panel";
import { GuidedProjectHome } from "@/app/_components/guided/guided-project-home";
import { SelectedGuidedResult } from "@/app/_components/guided/selected-guided-result";
import { calculationInputStructure } from "@/lib/calculation-result-association";
import { GuidedSpectraView } from "@/app/_components/guided/guided-spectra-view";
import { GuidedWorkspace } from "@/app/_components/guided/guided-workspace";
import { useWorkspaceAnnounceRequests } from "@/lib/workspace-announce";
import { useGuidedJob } from "@/lib/use-guided-job";
import { useProjectRole } from "@/lib/use-project-role";
import type { StageId } from "@/lib/guided-stages";
import type { GuidedTask } from "@/lib/use-guided-config";
import { GuidedNav } from "@/app/_components/guided/guided-nav";
import { ImportCalculationDialog, OPEN_IMPORT_CALCULATION_EVENT } from "@/app/_components/external-import/import-calculation-dialog";
import { ImportSpectrumDialog, OPEN_IMPORT_SPECTRUM_EVENT } from "@/app/_components/experimental-spectra/import-spectrum-dialog";
import { ExperimentalSpectrumWorkspace } from "@/app/_components/experimental-spectra/experimental-spectrum-workspace";
import { ImportedCalculationWorkspace } from "@/app/_components/external-import/imported-calculation-workspace";
import { UvVisSpectroscopyPanel } from "./visualization/uvvis-spectroscopy-panel";
import { ThermochemistryAdvancedPanel } from "./visualization/thermochemistry-advanced-panel";
import type { ThermochemistryConditionRequest } from "./visualization/thermochemistry-panel";
import { GuidedThermochemistryView } from "@/app/_components/guided/guided-thermochemistry-view";
import { Dftd4CorrectionControl, Dftd4ResultView } from "@/app/_components/dftd4-correction";
import { ScientificStateStrip } from "@/app/_components/scientific-state-strip";
import { ResultContextHeader } from "@/app/_components/result-context-header";
import { EnergyPrecisionPlate } from "./visualization/energy-precision-plate";
import { conditionsLabel, isThermochemistryPayload, type ThermoRecord } from "@/lib/thermochemistry";
import { WorkbenchPanel } from "@/app/_components/workbench-panel";
import { workbenchKind } from "@/lib/workstation-ux";
import { WorkspaceTabsBar } from "@/app/_components/workspace-tabs-bar";
import { useWorkspaceState } from "@/app/_components/workspace-state-provider";
import { listProjectMemory } from "@/lib/knowledge-api";
import { listWorkspaceFiles, type WorkspaceFile } from "@/lib/workspace-api";
import { selectionKey, type WorkspaceSelection } from "@/lib/workspace-selection";
import { deriveMolecularFormula, formatScientificNumber } from "@/lib/scientific-format";
import { canonicalEvidenceRows, figureCanBeDigitized, hasPreciseSourceRegion } from "@/lib/evidence-review";

type ProvenanceSummary = {
  origin?: string;
  detail?: string | null;
  source_artifact?: { artifact_id: string; sha256: string };
  parser?: string | null;
  parser_version?: string | null;
  adapter?: string | null;
  adapter_version?: string | null;
  operation?: string | null;
  operation_version?: string | null;
  source_class?: string | null;
  coordinate_origin?: string | null;
  coordinate_input_format?: string | null;
  coordinate_unit?: string | null;
  coordinate_file_sha256?: string | null;
  verification_state?: string | null;
  created_at?: string | null;
  actor_id?: string | null;
  calculation_id?: string | null;
  trajectory_id?: string | null;
  final_step_index?: number | null;
  geometry_candidate_id?: string | null;
  generation_method?: string | null;
  geometry_class?: string | null;
  candidate_sha256?: string | null;
};

type VersionDetail = StructureVersionDetail & {
  provenance?: ProvenanceSummary | null;
};

type EditorMode = "new" | "edit" | null;
type EvidenceGroup = { id: string; label: string; candidates: EvidenceCandidate[] };
type SourceDigitizationSession = XrdDigitizationSession | GraphDigitizationSession;
let pendingXrdSourceSession: SourceDigitizationSession | null = null;

function pendingXrdSessionFromStorage(): SourceDigitizationSession | null {
  if (pendingXrdSourceSession) return pendingXrdSourceSession;
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem("chemdft:xrd-source-session");
    pendingXrdSourceSession = stored ? JSON.parse(stored) as SourceDigitizationSession : null;
  } catch {
    pendingXrdSourceSession = null;
  }
  return pendingXrdSourceSession;
}

function pendingXrdPointFromStorage(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem("chemdft:xrd-source-selected-point");
  const index = raw === null ? NaN : Number(raw);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function evidenceTitle(candidate: EvidenceCandidate) {
  if (candidate.evidence_type === "STRUCTURE_FIGURE_CANDIDATE") return "Reported / hypothetical structure figure";
  if (candidate.evidence_type === "XRD_FIGURE" || candidate.evidence_type === "XRD_EVIDENCE") return "XRD evidence";
  if (["TG_DTG_DTA_FIGURE", "THERMAL_EVIDENCE"].includes(candidate.evidence_type)) return "Thermal analysis evidence";
  if (["DLS_FIGURE", "DLS_EVIDENCE"].includes(candidate.evidence_type)) return "Particle characterization evidence";
  if (candidate.evidence_type === "REPORTED_CELL_PARAMETER") return "Reported cell parameter";
  if (candidate.evidence_type === "DOCUMENT_TEXT") return "Document text";
  return candidate.evidence_type.replaceAll("_", " ").toLowerCase();
}

function groupEvidence(candidates: EvidenceCandidate[]): EvidenceGroup[] {
  const definitions = [
    { id: "structure", label: "Structure evidence" },
    { id: "xrd", label: "Crystallography / XRD" },
    { id: "cell", label: "Cell parameters" },
    { id: "thermal", label: "Thermal analysis" },
    { id: "particle", label: "Particle characterization" },
    { id: "text", label: "Document text" },
    { id: "visual", label: "Other visual evidence" },
    { id: "other", label: "Other reported values" },
  ];
  const grouped = new Map(definitions.map((definition) => [definition.id, [] as EvidenceCandidate[]]));
  for (const candidate of candidates) {
    const type = candidate.evidence_type.toUpperCase();
    const sourceText = `${candidate.source_anchor?.caption ?? ""} ${candidate.source_anchor?.snippet ?? ""}`.toLowerCase();
    const figure = candidate.source_anchor?.source_type === "FIGURE" || type.includes("FIGURE");
    let id = "other";
    if (type === "STRUCTURE_FIGURE_CANDIDATE" || (figure && /structure|crystal|molecular|структур|строени|кристалл|схема/u.test(sourceText))) id = "structure";
    else if (type.startsWith("XRD") || (figure && /x[-\s]?ray|рентген|diffract|дифракт|2\s*θ|2theta/u.test(sourceText))) id = "xrd";
    else if (type === "REPORTED_CELL_PARAMETER") id = "cell";
    else if (type.includes("THERMAL") || type.includes("TG_DTG_DTA") || (figure && /therm|\btg\b|\bdtg\b|\bdta\b|тг|дтг|дта|термич/u.test(sourceText))) id = "thermal";
    else if (type.startsWith("DLS") || (figure && /\bdls\b|дрс|particle|size|гистограмм|частиц|гидродинамич/u.test(sourceText))) id = "particle";
    else if (type === "DOCUMENT_TEXT") id = "text";
    else if (figure) id = "visual";
    grouped.get(id)?.push(candidate);
  }
  return definitions.flatMap((definition) => {
    const items = grouped.get(definition.id) ?? [];
    return items.length ? [{ ...definition, candidates: items }] : [];
  });
}

function isPageOnlyAnchor(candidate: EvidenceCandidate) {
  return !hasPreciseSourceRegion(candidate);
}

function candidateHasRegionBounds(candidate: EvidenceCandidate | null) {
  return Boolean(candidate && !isPageOnlyAnchor(candidate));
}

export function StructureWorkspaceClient({ projectId }: { projectId: string }) {
  return <CalculationCapabilitiesProvider key={projectId}><StructureWorkspaceContent projectId={projectId} /></CalculationCapabilitiesProvider>;
}

function StructureWorkspaceContent({ projectId }: { projectId: string }) {
  const { isCompact, isNarrow } = useWorkspaceTier();
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  // Release 0.0.40: the action row sizes to its own width (the explorer and dock vary), never wraps Export/Share.
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const [toolbarWidth, setToolbarWidth] = useState(0);
  useEffect(() => {
    if (!toolbarEl) return;
    const update = () => setToolbarWidth(toolbarEl.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(toolbarEl);
    return () => observer.disconnect();
  }, [toolbarEl]);
  const toolbarMedium = toolbarWidth > 0 && toolbarWidth < 1240;
  const toolbarTight = toolbarWidth > 0 && toolbarWidth < 640;
  const [importOpen, setImportOpen] = useState(false);
  const { state: workspaceState, activeSelection, openSelection, showProject, catalogReady, catalogError, catalog, workspaceMode, setWorkspaceMode, setUnsavedWork, staleNotice } = useWorkspaceState();
  const [guidedView, setGuidedView] = useState<"home" | "structure" | "draft" | "result" | "energy-result" | "setup" | "spectra" | "thermochemistry" | "imported" | "experimental">("home");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [spectrumDialogOpen, setSpectrumDialogOpen] = useState(false);
  const [selectedSpectrumId, setSelectedSpectrumId] = useState<string | undefined>(undefined);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [selectedImportResultId, setSelectedImportResultId] = useState<string | undefined>(undefined);
  const [guidedCalculationType, setGuidedCalculationType] = useState<"energy" | "optimization" | "tddft" | "ir" | "raman" | "conformer">("energy");
  const [guidedResultTab, setGuidedResultTab] = useState<"MO" | "Density" | "ESP">("MO");
  const [activeSpectroscopyTab, setActiveSpectroscopyTab] = useState<"uvvis" | "ir" | "raman">("uvvis");
  const [loadedResult, setLoadedResult] = useState<{
    calculationId: string;
    resultId: string;
    analysis: MolecularOrbitalAnalysis;
  } | null>(null);
  const [availableEnergyResult, setAvailableEnergyResult] = useState<{
    calculationId: string;
    resultId: string;
    createdAt: string;
  } | null>(null);
  const [availableOptimizationResult, setAvailableOptimizationResult] = useState<{ calculationId: string; resultId: string; createdAt: string } | null>(null);
  const [availableConformerResult, setAvailableConformerResult] = useState<{ calculationId: string; resultId: string; createdAt: string } | null>(null);
  const [availableConformerIds, setAvailableConformerIds] = useState<ReadonlySet<string>>(() => new Set());
  const activeConformer = activeSelection?.kind === "calculationResult" && availableConformerIds.has(activeSelection.id);
  function navigateConformerResult() {
    const target = activeConformer ? { calculationId: activeSelection.sourceId, resultId: activeSelection.id } : availableConformerResult;
    if (target) openSelection({ kind: "calculationResult", id: target.resultId, sourceId: target.calculationId, projectId }, "CREST ensemble");
    setGuidedView("result");
  }
  const [availableOptimizationIds, setAvailableOptimizationIds] = useState<ReadonlySet<string>>(() => new Set());
  const activeOptimization = activeSelection?.kind === "calculationResult" && availableOptimizationIds.has(activeSelection.id);
  function navigateOptimizationResult() {
    const target = activeOptimization ? { calculationId: activeSelection.sourceId, resultId: activeSelection.id } : availableOptimizationResult;
    if (target) openSelection({kind: "calculationResult", id: target.resultId, sourceId: target.calculationId, projectId}, "Geometry optimization result");
    setGuidedView("result");
  }
  const availableElectronicIds = useRef(new Set<string>());
  const versionLoadEpoch = useRef(0);
  const activeSelectionRef = useLatestRef(activeSelection);
  const guidedNavigationRef = useLatestRef({ key: activeSelection ? selectionKey(activeSelection) : "", view: guidedView });
  // Guided calculation flow: Structure → Configure → Review & Submit. The draft and any submitted job live inside GuidedWorkspace.
  const [guidedSetupStage, setGuidedSetupStage] = useState<"configure" | "review">("configure");
  function navigateElectronicResult(tab?: "MO" | "Density" | "ESP") {
    if (tab) setGuidedResultTab(tab);
    const current = activeSelection?.kind === "calculationResult" &&
      availableElectronicIds.current.has(activeSelection.id);
    const target = current ? activeSelection : availableEnergyResult ?? loadedResult;
    if (target && "resultId" in target) {
      openSelection({ kind: "calculationResult", id: target.resultId, sourceId: target.calculationId, projectId }, "Scientific result");
    }
    setGuidedView("result");
  }
  const [loadedTddftResult, setLoadedTddftResult] = useState<{
    calculationId: string;
    resultId: string;
    tddft: TddftResult;
  } | null>(null);
  const [loadedVibrationalResult, setLoadedVibrationalResult] = useState<{
    calculationId: string;
    resultId: string;
    vibrational: VibrationalAnalysis;
    result: CalculationResult;
  } | null>(null);
  // Creation time per loaded result so that, with several results of one kind (for example a re-run
  // frequency calculation), the most recent one is shown deterministically rather than by load order.
  const resultCreatedAtRef = useRef<Record<string, string>>({});
  const selectedResultIdRef = useLatestRef<string | undefined>(activeSelection?.id);
  const [loadedRamanResult, setLoadedRamanResult] = useState<{
    calculationId: string;
    resultId: string;
    vibrational: VibrationalAnalysis;
    result: CalculationResult;
  } | null>(null);
  const [thermoRecords, setThermoRecords] = useState<ThermoRecord[]>([]);
  const [selectedThermoResultId, setSelectedThermoResultId] = useState<string | null>(null);
  const [frequencyCandidates, setFrequencyCandidates] = useState<Array<{
    calculationId: string;
    resultId: string;
    vibrational: VibrationalAnalysis;
  }>>([]);
  const [lastSelectedExcitedState, setLastSelectedExcitedState] = useState<string | null>(null);
  const [lastSelectedVibrationalMode, setLastSelectedVibrationalMode] = useState<number | null>(null);
  const prevWorkspaceModeRef = useRef(workspaceMode);
  const [explorerVisible, setExplorerVisible] = useState(true);
  // Context dock visibility. Guided mode keeps an explicit per-project preference (set only by
  // user actions); with none, the dock defaults to collapsed when managed AI is unavailable or on Spectra.
  const [dockVisibleRaw, setDockVisibleRaw] = useState(true);
  const [guidedDockPref, setGuidedDockPref] = useState<boolean | null>(null);
  const [compactAiWorkspace, setCompactAiWorkspace] = useState(false);
  // ≤760 px: the dock is a bottom sheet over the workspace. Advanced mode keeps its desktop
  // preference untouched and starts the sheet closed so the molecular workspace stays visible.
  const [compactDockOpen, setCompactDockOpen] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    getProductContext(projectId)
      .then((ctx) => {
        if (alive) setAiAvailable(ctx.ai.available);
      })
      .catch(() => {
        if (alive) setAiAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1200px)");
    const update = () => setCompactAiWorkspace(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const dockVisible = workspaceMode === "guided"
    ? (guidedDockPref ?? (
        compactAiWorkspace ||
        guidedView === "spectra" ||
        guidedView === "thermochemistry" ||
        guidedView === "experimental" ||
        aiAvailable === false
          ? false
          : dockVisibleRaw
      ))
    : compactAiWorkspace ? compactDockOpen : dockVisibleRaw;
  const dockVisibleRef = useLatestRef(dockVisible);
  const workspaceModeRef = useLatestRef(workspaceMode);
  const compactRef = useLatestRef(compactAiWorkspace);
  const setDockVisible = useCallback((next: boolean | ((value: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(dockVisibleRef.current) : next;
    if (workspaceModeRef.current === "guided") {
      setGuidedDockPref(value);
      try { localStorage.setItem(`chemdft:panels:${projectId}:guided-ai-dock`, String(value)); } catch { /* optional */ }
    } else if (compactRef.current) {
      setCompactDockOpen(value);
    } else {
      setDockVisibleRaw(value);
    }
  }, [projectId, compactRef, dockVisibleRef, workspaceModeRef]);
  const [panelsHydrated, setPanelsHydrated] = useState(false);
  const [structures, setStructures] = useState<StructureSummary[]>([]);
  const [versions, setVersions] = useState<VersionDetail[]>([]);
  const [selected, setSelected] = useState<VersionDetail | null>(null);
  const projectRole = useProjectRole(projectId);
  const guidedJob = useGuidedJob({ projectId, versionId: selected?.version.id ?? null, canWrite: projectRole.canExecute });
  const [projectName, setProjectName] = useState<string>("Project");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void getProject(projectId).then((p) => {
      if (alive) setProjectName(p.name);
    }).catch(() => {});
    return () => { alive = false; };
  }, [projectId]);
  const [message, setMessage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileFormat, setFileFormat] = useState("SDF");
  const [experimentalModality, setExperimentalModality] = useState("XRD");
  const [xColumn, setXColumn] = useState("x");
  const [yColumns, setYColumns] = useState("y");
  const [xUnit, setXUnit] = useState("unitless");
  const [yUnit, setYUnit] = useState("unitless");
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  // RW-3.2: the save target (new molecule, or a new version of one lineage) is frozen when the editor
  // opens; selecting another structure afterwards never redirects the save.
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [showMoleculeChooser, setShowMoleculeChooser] = useState(false);
  const [editorMolfile, setEditorMolfile] = useState<string | null>(null);
  useEffect(() => {
    setUnsavedWork(editorTarget
      ? editorTarget.kind === "new-version"
        ? `A drawing for a new version of “${editorTarget.parent.name}” is open and has not been saved.`
        : "A drawing for a new molecule is open and has not been saved."
      : null);
  }, [editorTarget, setUnsavedWork]);
  useEffect(() => () => setUnsavedWork(null), [setUnsavedWork]);
  // The editor owns the whole pane: Explorer and the context panel step aside when it opens and return when it closes.
  const [panelsBeforeEditor, setPanelsBeforeEditor] = useState<{ explorer: boolean; dock: boolean } | null>(null);
  const editorOpen = Boolean(editorMode && editorTarget);
  const closeEditor = useCallback(() => {
    setEditorMode(null);
    setEditorMolfile(null);
    setEditorTarget(null);
    if (panelsBeforeEditor) {
      setExplorerVisible(panelsBeforeEditor.explorer);
      setDockVisible(panelsBeforeEditor.dock);
      setPanelsBeforeEditor(null);
    }
    // Leave the history entry the editor pushed (a browser Back arrives here with it already gone).
    try { if ((window.history.state as { chemdftEditor?: boolean } | null)?.chemdftEditor) window.history.back(); } catch { /* history is optional */ }
  }, [panelsBeforeEditor, setDockVisible]);
  // The editor lives in the Advanced Workbench; leaving it (after the shell's confirmation) discards the drawing.
  useEffect(() => {
    if (workspaceMode !== "guided" || !editorTarget) return;
    queueMicrotask(closeEditor);
  }, [workspaceMode, editorTarget, closeEditor]);
  // Browser Back leaves the editor instead of the project.
  useEffect(() => {
    if (!editorOpen) return;
    try {
      if (!(window.history.state as { chemdftEditor?: boolean } | null)?.chemdftEditor) {
        window.history.pushState({ ...(window.history.state as object | null), chemdftEditor: true }, "", window.location.href);
      }
    } catch { /* history is optional */ }
    const onPop = () => closeEditor();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [editorOpen, closeEditor]);
  const [scene, setScene] = useState<ScientificScene | null>(null);
  const [documents, setDocuments] = useState<ScientificDocument[]>([]);
  const [datasets, setDatasets] = useState<ExperimentalDatasetView[]>([]);
  const [selectedAtomIndex, setSelectedAtomIndex] = useState<number | null>(null);
  const [measurementKind, setMeasurementKind] = useState<MeasurementKind | "none">("none");
  const [measurementAtomIndices, setMeasurementAtomIndices] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    const resultItems = catalog.filter((item) => item.selection.kind === "calculationResult");
    for (const resultItem of resultItems) {
      if (!("sourceId" in resultItem.selection) || !resultItem.selection.sourceId) continue;
      const calcId = resultItem.selection.sourceId;
      const resId = resultItem.selection.id;

      void getCalculation({ projectId, calculationId: calcId }).then((calc) => {
        if (!alive || !calc.result || calc.result.id !== resId) return;
        if (["chemdft.molecular-orbitals", "chemdft.energy"].includes(calc.result.result_type)) availableElectronicIds.current.add(resId);
        if (calc.result.result_type === "chemdft.molecular-orbitals") {
          setLoadedResult({
            calculationId: calcId,
            resultId: resId,
            analysis: calc.result.payload as MolecularOrbitalAnalysis,
          });
        } else if (calc.result.result_type === "chemdft.energy") {
          const createdAt = calc.result.created_at;
          setAvailableEnergyResult((previous) => previous && previous.createdAt > createdAt ? previous : {
            calculationId: calcId, resultId: resId, createdAt,
          });
        } else if (calc.result.result_type === "chemdft.conformer-ensemble") {
          setAvailableConformerIds((previous) => (previous.has(resId) ? previous : new Set(previous).add(resId)));
          const createdAt = calc.result.created_at;
          setAvailableConformerResult((previous) => previous && previous.createdAt > createdAt ? previous : { calculationId: calcId, resultId: resId, createdAt });
        } else if (calc.result.result_type === "chemdft.optimization") {
          setAvailableOptimizationIds((previous) => (previous.has(resId) ? previous : new Set(previous).add(resId)));
          const createdAt = calc.result.created_at;
          setAvailableOptimizationResult((previous) => previous && previous.createdAt > createdAt ? previous : {calculationId: calcId, resultId: resId, createdAt});
        } else if (calc.result.result_type === "chemdft.tddft") {
          setLoadedTddftResult({
            calculationId: calcId,
            resultId: resId,
            tddft: calc.result.payload as TddftResult,
          });
        } else if (calc.result.result_type === "chemdft.thermochemistry" && isThermochemistryPayload(calc.result.payload)) {
          const record: ThermoRecord = {
            calculationId: calcId,
            resultId: resId,
            payload: calc.result.payload,
            createdAt: calc.result.created_at,
          };
          setThermoRecords((prev) => (prev.some((item) => item.resultId === resId) ? prev : [...prev, record]));
        } else if (calc.result.result_type === "chemdft.vibrational-analysis") {
          const vib = calc.result.payload as VibrationalAnalysis;
          setFrequencyCandidates((prev) =>
            prev.some((item) => item.resultId === resId) ? prev : [...prev, { calculationId: calcId, resultId: resId, vibrational: vib }],
          );
          const isRaman = Boolean(
            vib.raman_method ||
            vib.modes?.some((m) => m.raman_activity !== undefined && m.raman_activity !== null),
          );
          resultCreatedAtRef.current[resId] = calc.result.created_at;
          const loaded = {
            calculationId: calcId,
            resultId: resId,
            vibrational: vib,
            result: calc.result,
          };
          const newer = (prevId: string) =>
            (resultCreatedAtRef.current[resId] ?? "") >= (resultCreatedAtRef.current[prevId] ?? "");
          if (isRaman) {
            // Several Raman results can exist; keep the one the user selected.
            setLoadedRamanResult((prev) =>
              prev && prev.resultId === selectedResultIdRef.current && resId !== selectedResultIdRef.current
                ? prev
                : loaded,
            );
          }
          const isIr = Boolean(
            vib.dipole_derivative_method ||
            vib.modes?.some((m) => m.ir_intensity !== undefined && m.ir_intensity !== null),
          );
          if (!isRaman) {
            setLoadedVibrationalResult((prev) =>
              prev && prev.resultId === selectedResultIdRef.current && resId !== selectedResultIdRef.current
                ? prev
                : prev && !newer(prev.resultId) && prev.resultId !== resId && !prev.vibrational.raman_method
                  ? prev
                  : loaded,
            );
          } else if (isIr) {
            // A Raman result also carries IR data, but must not displace a
            // dedicated IR result or capture the IR tab's selection.
            setLoadedVibrationalResult((prev) => prev ?? loaded);
          }
        }
      }).catch(() => {});
    }

    return () => {
      alive = false;
    };
  }, [catalog, projectId, selectedResultIdRef]);

  useEffect(() => {
    function handleGuidedNavigate(event: Event) {
      const detail = (event as CustomEvent<{ view: "home" | "structure" | "result" | "setup" | "spectra" | "thermochemistry" | "imported"; tab?: "MO" | "Density" | "ESP"; calculationType?: "energy" | "optimization" | "tddft" | "ir" | "raman" | "conformer"; spectroscopy?: "uvvis" | "ir" | "raman" }>).detail;
      if (detail.view) setGuidedView(detail.view);
      if (detail.tab) setGuidedResultTab(detail.tab);
      if (detail.calculationType) setGuidedCalculationType(detail.calculationType);
      if (detail.spectroscopy) setActiveSpectroscopyTab(detail.spectroscopy);
    }
    window.addEventListener("chemdft:guided-navigate", handleGuidedNavigate);
    return () => window.removeEventListener("chemdft:guided-navigate", handleGuidedNavigate);
  }, []);

  useEffect(() => {
    const open = () => setSpectrumDialogOpen(true);
    window.addEventListener(OPEN_IMPORT_SPECTRUM_EVENT, open);
    const params = new URLSearchParams(window.location.search);
    if (params.get("import") === "spectrum") {
      params.delete("import");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      queueMicrotask(open);
    }
    return () => window.removeEventListener(OPEN_IMPORT_SPECTRUM_EVENT, open);
  }, []);

  useEffect(() => {
    const open = () => setImportDialogOpen(true);
    window.addEventListener(OPEN_IMPORT_CALCULATION_EVENT, open);
    const params = new URLSearchParams(window.location.search);
    if (params.get("import") === "calculation") {
      params.delete("import");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      queueMicrotask(open);
    }
    return () => window.removeEventListener(OPEN_IMPORT_CALCULATION_EVENT, open);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      if (activeSelection?.kind === "structureVersion" || activeSelection?.kind === "scientificScene") {
        setGuidedView("structure");
      } else if (activeSelection?.kind === "experimentalSpectrum") {
        setSelectedSpectrumId(activeSelection.id);
        setGuidedView("experimental");
      } else if (activeSelection?.kind === "externalImport" || activeSelection?.kind === "importedResult") {
        setSelectedImportId("sourceId" in activeSelection ? activeSelection.sourceId : activeSelection.id);
        setSelectedImportResultId(activeSelection.kind === "importedResult" ? activeSelection.id : undefined);
        setGuidedView("imported");
      } else if (activeSelection?.kind === "geometryCandidate") {
        setGuidedView("draft");
      } else if (activeSelection?.kind === "calculation") {
        setGuidedView("result");
      } else if (activeSelection?.kind === "calculationResult") {
        if (loadedTddftResult && activeSelection.id === loadedTddftResult.resultId) {
          setActiveSpectroscopyTab("uvvis");
          setGuidedView("spectra");
        } else if (thermoRecords.some((record) => record.resultId === activeSelection.id)) {
          setSelectedThermoResultId(activeSelection.id);
          setGuidedView("thermochemistry");
        } else if (loadedRamanResult && activeSelection.id === loadedRamanResult.resultId) {
          setActiveSpectroscopyTab("raman");
          setGuidedView("spectra");
        } else if (loadedVibrationalResult && activeSelection.id === loadedVibrationalResult.resultId) {
          setActiveSpectroscopyTab("ir");
          setGuidedView("spectra");
        } else {
          setGuidedView("result");
        }
      }
    });
  }, [activeSelection, loadedTddftResult, loadedVibrationalResult, loadedRamanResult, thermoRecords]);

  useEffect(() => {
    queueMicrotask(() => {
      setExplorerVisible(readStored(`chemdft:panels:${projectId}:explorer`) !== "false");
      setDockVisibleRaw(readStored(`chemdft:panels:${projectId}:dock`) !== "false");
      const guidedPref = readStored(`chemdft:panels:${projectId}:guided-ai-dock`);
      setGuidedDockPref(guidedPref === "true" ? true : guidedPref === "false" ? false : null);
      setPanelsHydrated(true);
    });
  }, [projectId]);

  useEffect(() => {
    const shell = document.querySelector(".project-shell");
    if (!panelsHydrated) return;
    shell?.classList.toggle("explorer-collapsed", !explorerVisible);
    writeStored(`chemdft:panels:${projectId}:explorer`, String(explorerVisible));
  }, [explorerVisible, panelsHydrated, projectId]);

  useEffect(() => {
    const shell = document.querySelector(".project-shell");
    if (!panelsHydrated) return;
    shell?.classList.toggle("dock-collapsed", !dockVisible);
  }, [dockVisible, panelsHydrated, projectId, workspaceMode]);

  useEffect(() => {
    if (!panelsHydrated) return;
    writeStored(`chemdft:panels:${projectId}:dock`, String(dockVisibleRaw));
  }, [dockVisibleRaw, panelsHydrated, projectId]);

  useEffect(() => {
    if (!panelsHydrated) return;
    window.dispatchEvent(new CustomEvent("chemdft:dock-state", { detail: { visible: dockVisible } }));
  }, [dockVisible, panelsHydrated]);

  useEffect(() => {
    const toggleDock = () => setDockVisible((value) => !value);
    window.addEventListener("chemdft:toggle-dock", toggleDock);
    return () => window.removeEventListener("chemdft:toggle-dock", toggleDock);
  }, [setDockVisible]);

  useEffect(() => {
    const showDock = () => setDockVisible(true);
    window.addEventListener("chemdft:open-inspector", showDock);
    window.addEventListener("chemdft:open-ai-scientist", showDock);
    return () => {
      window.removeEventListener("chemdft:open-inspector", showDock);
      window.removeEventListener("chemdft:open-ai-scientist", showDock);
    };
  }, [setDockVisible]);

  const selectedCoordinates = selected?.version.coordinates;
  const selectedAtoms = useMemo(() => selectedCoordinates?.atoms ?? [], [selectedCoordinates?.atoms]);
  const selectedBonds = selectedCoordinates?.bonds ?? [];
  const selectedCell = selected?.version.periodic_cell ?? null;
  const isPeriodic = selected?.structure.kind === "PERIODIC";
  const canEditMolecule = selected !== null && !isPeriodic;

  const derivedFormula = useMemo(() => {
    return deriveMolecularFormula(selectedAtoms, { useSubscripts: true });
  }, [selectedAtoms]);

  const chooseVersion = useCallback((detail: VersionDetail | null) => {
    setSelected(detail);
    setSelectedAtomIndex(null);
    setMeasurementAtomIndices([]);
    setMeasurementKind("none");
    if (typeof window !== "undefined" && !["result", "energy-result"].includes(guidedNavigationRef.current.view)) {
      window.dispatchEvent(
        new CustomEvent("chemdft:workspace-selection", {
          detail: {
            projectId,
            structureName: detail?.structure.name,
            structureVersionRevision: detail?.version.revision,
            currentView: detail ? compactStructureTitle(detail.structure.name, detail.version.revision) : undefined,
          },
        }),
      );
      if (detail) {
        let sc = null;
        try {
          if (detail.version.coordinates) sc = buildScientificScene(detail);
        } catch {
          /* Scene build error handled in UI */
        }
        window.dispatchEvent(
          new CustomEvent("chemdft:structure-inspector", {
            detail: {
              projectId,
              detail,
              scene: sc,
              visualBonds: sc ? inferVisualBonds(sc) : [],
              visualBondsEnabled: true,
              selectedAtomIndex: null,
              measurementKind: "none",
              measurementAtomIndices: [],
              measurement: null,
              sourceName: detail.structure.name,
            },
          }),
        );
      }
    }
  }, [projectId, guidedNavigationRef]);

  // The dock may mount after the first announcement; it asks again once it is listening.
  const announceTick = useWorkspaceAnnounceRequests();

  useEffect(() => {
    let viewLabel = "";
    if (guidedView === "home") {
      viewLabel = projectName ? `${projectName} → Overview` : "Project overview";
    } else if (guidedView === "draft") {
      viewLabel = "AI molecular draft (unverified)";
    } else if (selected) {
      viewLabel = compactStructureTitle(selected.structure.name, selected.version.revision);
      if (guidedView === "structure") {
        // "Water V1"
      } else if ((guidedView === "result" || guidedView === "energy-result") && activeSelection?.id !== loadedResult?.resultId) {
        viewLabel = "Selected scientific result";
      } else if (guidedView === "result") {
        const methodBasis = loadedResult?.analysis?.method ? ` · ${loadedResult.analysis.method}/${loadedResult.analysis.basis}` : "";
        viewLabel = `Electronic structure${methodBasis}`;
        if (guidedResultTab === "Density") {
          viewLabel += " → Electron density";
        } else if (guidedResultTab === "ESP") {
          viewLabel += " → ESP";
        } else {
          viewLabel += " → HOMO";
        }
      } else if (guidedView === "spectra") {
        const structName = compactStructureTitle(selected.structure.name, selected.version.revision);
        if (activeSpectroscopyTab === "raman") {
          const modeIdx = lastSelectedVibrationalMode ?? 0;
          const mode = loadedRamanResult?.vibrational.modes[modeIdx];
          viewLabel = mode
            ? `${structName} → Raman → Mode ${mode.index + 1} · ${mode.frequency_cm1.toFixed(1)} cm⁻¹`
            : `${structName} → Raman spectrum`;
        } else if (activeSpectroscopyTab === "ir") {
          const modeIdx = lastSelectedVibrationalMode ?? 0;
          const mode = loadedVibrationalResult?.vibrational.modes[modeIdx];
          viewLabel = mode
            ? `${structName} → IR → Mode ${mode.index + 1} · ${mode.frequency_cm1.toFixed(1)} cm⁻¹`
            : `${structName} → IR spectrum`;
        } else {
          viewLabel = lastSelectedExcitedState
            ? `${structName} → UV/Vis → ${lastSelectedExcitedState}`
            : `${structName} → UV/Vis spectrum`;
        }
      } else if (guidedView === "thermochemistry") {
        viewLabel = `${compactStructureTitle(selected.structure.name, selected.version.revision)} → Thermochemistry`;
      } else if (guidedView === "setup") {
        viewLabel += ` → ${guidedCalculationType === "optimization" ? "Geometry optimization" : guidedCalculationType === "tddft" ? "TDDFT" : guidedCalculationType === "raman" ? "Raman" : "Calculation"} setup`;
      }
    } else {
      viewLabel = projectName ? `${projectName} → Overview` : "Project overview";
    }
    // The selected result component owns the energy context after resolving its immutable input.
    if ((guidedView === "result" || guidedView === "energy-result") && activeSelection?.id !== loadedResult?.resultId) return;
    // The Thermochemistry panel owns its own (condition-specific) AI context broadcast.
    if (guidedView === "thermochemistry" && thermoRecords.length > 0) return;
    // The experimental spectrum workspace owns its own (version-, peak- and comparison-specific) AI context broadcast.
    if (guidedView === "experimental") return;
    const modeIdx = lastSelectedVibrationalMode ?? 0;
    const activeIrMode = loadedVibrationalResult?.vibrational.modes[modeIdx];
    const activeRamanMode = loadedRamanResult?.vibrational.modes[modeIdx];
    window.dispatchEvent(
      new CustomEvent("chemdft:workspace-selection", {
        detail: {
          projectId,
          ...(selected && guidedView !== "home" ? {
            structureName: selected.structure.name,
            structureVersionRevision: selected.version.revision,
          } : {}),
          ...(guidedView === "spectra" && activeSpectroscopyTab === "raman" && loadedRamanResult ? {
            calculationId: loadedRamanResult.calculationId,
            resultId: loadedRamanResult.resultId,
            selectedModeIndex: modeIdx,
            selectedModeFrequency: activeRamanMode?.frequency_cm1,
            selectedModeActivity: typeof activeRamanMode?.raman_activity === "object" && activeRamanMode?.raman_activity !== null && "value" in activeRamanMode.raman_activity
              ? activeRamanMode.raman_activity.value
              : activeRamanMode?.raman_activity,
            selectedModeDepolarization: activeRamanMode?.depolarization_ratio,
          } : {}),
          ...(guidedView === "spectra" && activeSpectroscopyTab === "ir" && loadedVibrationalResult ? {
            calculationId: loadedVibrationalResult.calculationId,
            resultId: loadedVibrationalResult.resultId,
            selectedModeIndex: modeIdx,
            selectedModeFrequency: activeIrMode?.frequency_cm1,
            selectedModeIntensity: typeof activeIrMode?.ir_intensity === "object" && activeIrMode?.ir_intensity !== null && "value" in activeIrMode.ir_intensity
              ? activeIrMode.ir_intensity.value
              : activeIrMode?.ir_intensity,
          } : {}),
          ...(guidedView === "spectra" && activeSpectroscopyTab === "uvvis" && loadedTddftResult ? {
            calculationId: loadedTddftResult.calculationId,
            resultId: loadedTddftResult.resultId,
          } : {}),
          currentView: viewLabel,
        },
      }),
    );
  }, [
    selected,
    activeSelection,
    guidedView,
    guidedResultTab,
    guidedCalculationType,
    activeSpectroscopyTab,
    lastSelectedVibrationalMode,
    loadedVibrationalResult,
    loadedRamanResult,
    loadedTddftResult,
    projectId,
    projectName,
    loadedResult,
    thermoRecords,
    lastSelectedExcitedState,
    announceTick,
  ]);

  useEffect(() => {
    if (!activeSelection && workspaceMode === "advanced") {
      const overviewLabel = projectName ? `${projectName} → Overview` : "Project overview";
      window.dispatchEvent(
        new CustomEvent("chemdft:workspace-selection", {
          detail: {
            projectId,
            currentView: overviewLabel,
          },
        }),
      );
    }
  }, [activeSelection, workspaceMode, projectId, projectName]);

  useEffect(() => {
    if (
      workspaceMode === "guided" &&
      guidedView === "structure" &&
      selected &&
      (activeSelection?.kind !== "structureVersion" || activeSelection?.id !== selected.version.id)
    ) {
      openSelection(
        {
          kind: "structureVersion",
          id: selected.version.id,
          projectId,
          sourceId: selected.structure.id,
        },
        `${selected.structure.name} · V${selected.version.revision}`,
      );
    }
  }, [workspaceMode, guidedView, selected, activeSelection, openSelection, projectId]);

  useEffect(() => {
    if (guidedView === "spectra") {
      if (activeSpectroscopyTab === "raman" && loadedRamanResult && activeSelection?.id !== loadedRamanResult.resultId) {
        openSelection(
          {
            kind: "calculationResult",
            id: loadedRamanResult.resultId,
            projectId,
            sourceId: loadedRamanResult.calculationId,
          },
          `Raman spectrum · ${plural(loadedRamanResult.vibrational.modes.length, "mode")}`,
        );
      } else if (activeSpectroscopyTab === "ir" && loadedVibrationalResult && activeSelection?.id !== loadedVibrationalResult.resultId) {
        openSelection(
          {
            kind: "calculationResult",
            id: loadedVibrationalResult.resultId,
            projectId,
            sourceId: loadedVibrationalResult.calculationId,
          },
          vibrationalSpectrumLabel(loadedVibrationalResult.vibrational),
        );
      } else if (activeSpectroscopyTab === "uvvis" && loadedTddftResult && activeSelection?.id !== loadedTddftResult.resultId) {
        openSelection(
          {
            kind: "calculationResult",
            id: loadedTddftResult.resultId,
            projectId,
            sourceId: loadedTddftResult.calculationId,
          },
          "UV/Vis absorption spectrum",
        );
      }
    }
  }, [guidedView, activeSpectroscopyTab, loadedTddftResult, loadedVibrationalResult, loadedRamanResult, activeSelection, openSelection, projectId]);

  // --- Thermochemistry: eligibility (server re-validates every gate) and conditions requests -----
  const thermochemistryEligibility = useMemo(() => {
    const optimizedIds = new Set(versions.filter((item) => item.version.origin === "OPTIMIZED").map((item) => item.version.id));
    const usable = frequencyCandidates.filter(
      (candidate) =>
        optimizedIds.has(candidate.vibrational.input_structure_version_id) &&
        candidate.vibrational.multiplicity === 1 &&
        candidate.vibrational.modes.every((mode) => mode.frequency_cm1 > 0 && !mode.imaginary),
    );
    const eligible = usable[usable.length - 1] ?? null;
    return {
      hasOptimizedGeometry: optimizedIds.size > 0,
      hasFrequencyResult: frequencyCandidates.length > 0,
      source: eligible
        ? { frequencyResultId: eligible.resultId, structureVersionId: eligible.vibrational.input_structure_version_id }
        : null,
    };
  }, [versions, frequencyCandidates]);

  const requestThermochemistry = useCallback(
    async (request: ThermochemistryConditionRequest): Promise<{ error?: string }> => {
      const candidate = frequencyCandidates.find((item) => item.resultId === request.frequencyResultId);
      const family = thermoRecords.find((record) => record.payload.frequency_result_id === request.frequencyResultId)?.payload;
      const method = family?.method ?? candidate?.vibrational.method;
      const basis = family?.basis ?? candidate?.vibrational.basis;
      if (!method || !basis) return { error: "The source frequency result is not loaded." };
      try {
        const submitted = await submitCalculation(projectId, {
          structure_version: { project_id: projectId, entity_type: "structure.version", entity_id: request.structureVersionId },
          specification: {
            task_type: "THERMOCHEMISTRY",
            method: { identifier: method, display_name: method.toUpperCase(), registry: "chemdft.method" },
            basis: { identifier: basis, display_name: basis, registry: "chemdft.basis" },
            charge: family?.molecule.charge ?? candidate?.vibrational.charge ?? 0,
            multiplicity: family?.molecule.multiplicity ?? candidate?.vibrational.multiplicity ?? 1,
            engine_preference: { engine: "pyscf" },
            thermochemistry: {
              source_frequency_result_id: request.frequencyResultId,
              temperature_k: request.temperatureK,
              pressure_pa: request.pressurePa,
            },
          },
          provider_preference: "AUTO",
          idempotency_key: `thermo:${request.frequencyResultId}:${request.temperatureK}:${request.pressurePa}`,
        });
        let detail = submitted;
        for (let attempt = 0; attempt < 120 && !["SUCCEEDED", "FAILED", "CANCELED"].includes(detail.calculation.state); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          detail = await getCalculation({ projectId, calculationId: submitted.calculation.id });
        }
        if (detail.calculation.state !== "SUCCEEDED" || !detail.result || !isThermochemistryPayload(detail.result.payload)) {
          return { error: detail.attempt?.diagnostic ?? `Thermochemistry calculation ${detail.calculation.state.toLowerCase()}.` };
        }
        const record: ThermoRecord = {
          calculationId: detail.calculation.id,
          resultId: detail.result.id,
          payload: detail.result.payload,
          createdAt: detail.result.created_at,
        };
        setThermoRecords((prev) => (prev.some((item) => item.resultId === record.resultId) ? prev : [...prev, record]));
        setSelectedThermoResultId(record.resultId);
        window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
        return {};
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Thermochemistry request failed." };
      }
    },
    [frequencyCandidates, thermoRecords, projectId],
  );

  // Guided Thermochemistry opens its record as the active workspace tab (Advanced shares it).
  useEffect(() => {
    if (guidedView !== "thermochemistry" || thermoRecords.length === 0) return;
    const record = thermoRecords.find((item) => item.resultId === selectedThermoResultId)
      ?? thermoRecords.find((item) => Math.abs(item.payload.conditions.temperature_k - 298.15) < 1e-9 && Math.abs(item.payload.conditions.pressure_pa - 101325) < 1e-6)
      ?? thermoRecords[0];
    if (record && activeSelection?.id !== record.resultId) {
      openSelection(
        { kind: "calculationResult", id: record.resultId, projectId, sourceId: record.calculationId },
        `Thermochemistry · ${conditionsLabel(record.payload.conditions.temperature_k, record.payload.conditions.pressure_pa)}`,
      );
    }
  }, [guidedView, thermoRecords, selectedThermoResultId, activeSelection, openSelection, projectId]);

  useEffect(() => {
    if (prevWorkspaceModeRef.current === "advanced" && workspaceMode === "guided") {
      queueMicrotask(() => {
        if (activeSelection && thermoRecords.some((record) => record.resultId === activeSelection.id)) {
          setSelectedThermoResultId(activeSelection.id);
          setGuidedView("thermochemistry");
        } else if (activeSelection?.id === loadedRamanResult?.resultId) {
          setActiveSpectroscopyTab("raman");
          setGuidedView("spectra");
        } else if (activeSelection?.id === loadedVibrationalResult?.resultId) {
          setActiveSpectroscopyTab("ir");
          setGuidedView("spectra");
        } else if (activeSelection?.id === loadedTddftResult?.resultId) {
          setActiveSpectroscopyTab("uvvis");
          setGuidedView("spectra");
        } else if (activeSelection?.id === loadedResult?.resultId) {
          setGuidedView("result");
        } else if (activeSelection?.kind === "structureVersion" || activeSelection?.kind === "optimizedStructureVersion") {
          setGuidedView("structure");
        }
      });
    }
    prevWorkspaceModeRef.current = workspaceMode;
  }, [workspaceMode, activeSelection, loadedTddftResult, loadedVibrationalResult, loadedRamanResult, loadedResult, thermoRecords]);

  const loadVersions = useCallback(async (structureId: string, versionId?: string, navigate = true) => {
    const epoch = ++versionLoadEpoch.current;
    const selectionAtStart = activeSelectionRef.current ? selectionKey(activeSelectionRef.current) : null;
    const loaded = await listStructureVersions(projectId, structureId) as VersionDetail[];
    const currentSelection = activeSelectionRef.current ? selectionKey(activeSelectionRef.current) : null;
    if (epoch !== versionLoadEpoch.current || (!navigate && selectionAtStart !== currentSelection)) return;
    setVersions(loaded);
    const nextSelected = loaded.find((item) => item.version.id === versionId) ?? loaded.at(-1) ?? null;
    chooseVersion(nextSelected);
    if (navigate && nextSelected) openSelection({ kind: "structureVersion", id: nextSelected.version.id, projectId, sourceId: nextSelected.structure.id }, `${nextSelected.structure.name} · V${nextSelected.version.revision}`);
  }, [chooseVersion, projectId, openSelection, activeSelectionRef]);

  useEffect(() => {
    if (activeSelection && ["structureVersion", "optimizedStructureVersion", "scientificScene"].includes(activeSelection.kind) && "sourceId" in activeSelection) {
      const selection = activeSelection;
      queueMicrotask(() => { void loadVersions(selection.sourceId, selection.id, false).catch(error => setMessage(error instanceof Error ? error.message : "Structure could not be opened.")); });
    }
  }, [activeSelection, loadVersions]);

  const loadProjectStructures = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [structuresResult, documentsResult, datasetsResult] = await Promise.allSettled([
        listStructures(projectId),
        listDocuments(projectId),
        listExperimentalDatasets(projectId),
      ]);
      if (structuresResult.status === "rejected") throw structuresResult.reason;
      const loaded = structuresResult.value;
      setStructures(loaded);
      setDocuments(documentsResult.status === "fulfilled" ? documentsResult.value.documents : []);
      setDatasets(datasetsResult.status === "fulfilled" ? datasetsResult.value.datasets : []);
      if (loaded.length === 0) {
        setVersions([]);
        setSelected(null);
      } else {
        const first = loaded[0];
        const selection = activeSelectionRef.current;
        if (selection && ["structureVersion", "optimizedStructureVersion", "scientificScene"].includes(selection.kind) && "sourceId" in selection) await loadVersions(selection.sourceId, selection.id, false);
        else if (first) await loadVersions(first.id, first.latest_version_id, false);
      }
    } catch (error) {
      setStructures([]);
      setVersions([]);
      setSelected(null);
      setMessage(error instanceof Error ? error.message : "Unable to load project structures.");
    } finally {
      setLoading(false);
    }
  }, [loadVersions, projectId, activeSelectionRef]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadProjectStructures();
    });
    return () => {
      cancelled = true;
    };
  }, [loadProjectStructures]);

  async function submitImport(overrideFile?: File | null, overrideFormat?: string) {
    if (!catalogReady) {
      setMessage("This project is no longer available. Open or create a valid project before importing.");
      return;
    }
    const selectedFile = overrideFile ?? file ?? fileInputRef.current?.files?.[0] ?? null;
    if (!selectedFile) {
      setMessage("Choose a structure, PDF, or experimental data file before importing.");
      return;
    }
    const selectedFormat = overrideFormat ?? (file ? fileFormat : detectFormat(selectedFile.name));
    setMessage("Uploading immutable source bytes for parser validation…");
    try {
      if (selectedFormat === "PDF") {
        const output = await importDocument(projectId, selectedFile);
        setDocuments((current) => [output.document, ...current.filter((item) => item.id !== output.document.id)]);
        window.dispatchEvent(new CustomEvent("chemdft:document-imported", { detail: output.document.id }));
        setShowMoleculeChooser(false);
        window.dispatchEvent(new Event("chemdft:documents-changed"));
        setMessage(`Scientific document imported. ${(output.candidates ?? []).length} evidence candidates detected. Review findings below; no structure was created from the paper.`);
        return;
      }
      if (selectedFormat === "CSV" || selectedFormat === "TSV" || selectedFormat === "XY") {
        const output = await importExperimentalDataset({
          projectId,
          file: selectedFile,
          modality: experimentalModality,
          xColumn,
          yColumns: yColumns.split(",").map((item) => item.trim()).filter(Boolean),
          xLabel: xColumn,
          xUnit,
          yLabel: yColumns,
          yUnit,
          experimentName: selectedFile.name.replace(/\.[^.]+$/, ""),
          delimiter: selectedFormat === "TSV" ? "\t" : ",",
        });
        setDatasets((current) => [output, ...current.filter((item) => item.id !== output.id)]);
        window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
        setMessage("Experimental dataset imported as immutable RAW data.");
        return;
      }
      const output = await importStructure({
        projectId,
        file: selectedFile,
        fileFormat: selectedFormat,
        structureName: selectedFile.name.replace(/\.[^.]+$/, ""),
      });
      await afterImport(output);
      setMessage("Structure imported and saved as an immutable version.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Structure import failed.");
    }
  }

  async function afterImport(output: StructureImportOutput) {
    const loaded = await listStructures(projectId);
    setStructures(loaded);
    await loadVersions(output.structure.id, output.version.id);
    window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
  }

  async function openEditor(mode: Exclude<EditorMode, null>, editingVersion: StructureVersionDetail | null = selected, initialDrawing: string | null = null) {
    setShowMoleculeChooser(false);
    setMessage(null);
    if (!panelsBeforeEditor) {
      setPanelsBeforeEditor({ explorer: explorerVisible, dock: dockVisible });
      setExplorerVisible(false);
      setDockVisible(false);
    }
    if (mode === "edit" && !editingVersion) return;
    if (mode === "edit" && editingVersion) {
      const lineage = editingVersion.structure.id;
      setEditorTarget(newVersionTarget({
        structureId: lineage,
        versionId: editingVersion.version.id,
        revision: editingVersion.version.revision,
        nextRevision: nextRevision([
          editingVersion.version.revision,
          structures.find((item) => item.id === lineage)?.latest_revision,
          ...versions.filter((item) => item.structure.id === lineage).map((item) => item.version.revision),
        ]),
        name: editingVersion.structure.name,
        composition: elementComposition((editingVersion.version.coordinates?.atoms ?? []).map((atom) => atom.element)),
      }));
    } else {
      setEditorTarget(newMoleculeTarget(initialDrawing));
    }
    setEditorMode(mode);
    if (mode === "edit" && editingVersion) {
      try {
        const { blob } = await exportStructureVersion({
          projectId,
          structureId: editingVersion.structure.id,
          versionId: editingVersion.version.id,
          fileFormat: "MOL",
        });
        setEditorMolfile(await blob.text());
      } catch (error) {
        closeEditor();
        setMessage(error instanceof Error ? error.message : "Unable to open selected molecule in Ketcher.");
      }
    } else {
      setEditorMolfile(initialDrawing);
    }
  }

  async function handleExportStructureFile(format: "XYZ" | "SDF" | "MOL" | "SMILES" | "CIF") {
    if (!selected) return;
    try {
      const { blob, filename } = await exportStructureVersion({
        projectId,
        structureId: selected.structure.id,
        versionId: selected.version.id,
        fileFormat: format,
      });
      saveBlob(blob, filename);
      setMessage(`Exported ${filename}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${format} export failed.`);
    }
  }

  function selectAtom(atomIndex: number) {
    setSelectedAtomIndex(atomIndex);
    if (measurementKind === "none") return;
    const required = measurementKind === "distance" ? 2 : measurementKind === "angle" ? 3 : 4;
    setMeasurementAtomIndices((current) => {
      const withoutDuplicate = current.filter((index) => index !== atomIndex);
      return [...withoutDuplicate, atomIndex].slice(-required);
    });
  }

  function changeMeasurementKind(kind: MeasurementKind | "none") {
    setMeasurementKind(kind);
    setMeasurementAtomIndices([]);
  }

  const contextKind = workbenchKind(activeSelection);
  const importedCalculations = useMemo(
    () => catalog.filter((item) => item.selection.kind === "externalImport" && item.authority === "IMPORTED"),
    [catalog],
  );
  const hasImportedSpectra = useMemo(
    () => catalog.some((item) => item.authority === "IMPORTED" && item.importedSpectrum === true),
    [catalog],
  );
  const navigateToStructure = useCallback(() => {
    setGuidedView("structure");
    if (selected) {
      openSelection(
        {
          kind: "structureVersion",
          id: selected.version.id,
          projectId,
          sourceId: selected.structure.id,
        },
        compactStructureTitle(selected.structure.name, selected.version.revision),
      );
    }
  }, [selected, openSelection, projectId]);
  function navigateSpectra() {
    if (loadedTddftResult || loadedVibrationalResult || loadedRamanResult) {
      setGuidedView("spectra");
      return;
    }
    const importedSpectrum = catalog.find((item) => item.importedSpectrum && item.selection.kind === "importedResult");
    if (importedSpectrum) openSelection(importedSpectrum.selection, importedSpectrum.label);
  }
  const experimentalSpectra = useMemo(
    () => catalog.filter((item) => item.selection.kind === "experimentalSpectrum" && item.experimentalSpectrum === true),
    [catalog],
  );
  const hasExperimentalSpectra = experimentalSpectra.length > 0;
  const structureContextReady = Boolean(selected && activeSelection && "sourceId" in activeSelection
    && selected.version.id === activeSelection.id && selected.structure.id === activeSelection.sourceId);
  const activeStructureName = selected?.structure.name ?? "No structure selected";
  const diagnostics = selected?.diagnostics ?? selected?.version.diagnostics ?? [];

  if (!catalogReady && catalogError) return <section className="structure-workspace"><CatalogUnavailable error={catalogError} heading="Project inventory couldn't be loaded" /></section>;
  if (!catalogReady) return <section className="structure-workspace" role="status"><h1>Loading project inventory…</h1><p>Saved workspace items are being checked with the server.</p></section>;

  return (
    <>
      <NavigatorLauncher projectId={projectId}
                onLaunch={async (target) => {
          const selection = navigatorSelection(projectId, target);
          if (selection?.kind === "structureVersion" && "sourceId" in selection) {
            await loadVersions(selection.sourceId, selection.id);
          }
          const advanced = ["draw", "edit", "structure_import", "document_import", "energy", "optimization", "orbitals", "cell", "supercell", "provenance"].includes(target.launch);
          if (advanced) setGuidedView("home");
          setWorkspaceMode(advanced ? "advanced" : "guided");
          if (["energy", "optimization", "orbitals", "draw", "edit", "structure_import", "document_import", "ir", "raman", "uvvis", "thermochemistry"].includes(target.launch)) showProject();
          else if (selection) openSelection(selection, "Navigator");
          if (target.launch === "draw") await openEditor("new");
          if (target.launch === "edit" && selection?.kind === "structureVersion" && "sourceId" in selection) {
            const editingVersion = await getStructureVersion({ projectId, structureId: selection.sourceId, versionId: selection.id });
            await openEditor("edit", editingVersion);
          }
          if (target.launch === "structure_import" || target.launch === "document_import") {
            window.setTimeout(() => document.getElementById("structure-upload")?.click(), 0);
          }
          if (target.launch === "ir" || target.launch === "raman" || target.launch === "uvvis") {
            setGuidedCalculationType(target.launch === "uvvis" ? "tddft" : target.launch);
            setGuidedView("setup");
          }
          if (target.launch === "thermochemistry") setGuidedView("thermochemistry");
          if (target.launch === "mo" || target.launch === "density" || target.launch === "esp") {
            setGuidedResultTab(target.launch === "density" ? "Density" : target.launch === "esp" ? "ESP" : "MO");
            setGuidedView("result");
          }
          if (target.launch === "provenance") {
            setDockVisible(true);
            window.setTimeout(() => window.dispatchEvent(new Event("chemdft:open-inspector")), 0);
          }
          if (target.launch === "energy" || target.launch === "optimization" || target.launch === "orbitals") {
            window.setTimeout(() => document.querySelector(".calculation-panel")?.scrollIntoView({ block: "start" }), 0);
          }
        }} />
      <ImportCalculationDialog
        projectId={projectId}
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImported={(detail) => {
          setImportDialogOpen(false);
          const record = detail.import_record;
          setSelectedImportId(record.id);
          setSelectedImportResultId(undefined);
          if (workspaceModeRef.current === "guided") setGuidedView("imported");
          else openSelection({ kind: "externalImport", id: record.id, projectId }, `Imported calculation · ${record.preview.program.label ?? record.source.original_name}`);
        }}
      />
      <ImportSpectrumDialog
        projectId={projectId}
        open={spectrumDialogOpen}
        onClose={() => setSpectrumDialogOpen(false)}
        onImported={(dataset) => {
          setSpectrumDialogOpen(false);
          setSelectedSpectrumId(dataset.id);
          if (workspaceModeRef.current === "guided") setGuidedView("experimental");
          else openSelection({ kind: "experimentalSpectrum", id: dataset.id, projectId }, `Experimental spectrum · ${dataset.name}`);
        }}
      />
      {workspaceMode === "guided" ? (
        <div className="guided-mode-container" data-testid="guided-mode-container">
          <GuidedNav
            currentView={guidedView}
            activeResultTab={guidedResultTab}
            hasStructure={Boolean(selected)}
            hasElectronicResult={Boolean(loadedResult || availableEnergyResult)}
            hasConformerResult={Boolean(availableConformerResult)}
            activeConformer={activeConformer}
            onNavigateConformer={navigateConformerResult}
            hasOptimizationResult={Boolean(availableOptimizationResult)}
            activeOptimization={activeOptimization}
            onNavigateOptimization={navigateOptimizationResult}
            hasSpectra={Boolean(loadedTddftResult || loadedVibrationalResult || loadedRamanResult)}
            spectraKinds={[...(loadedVibrationalResult ? ["ir" as const] : []), ...(loadedRamanResult ? ["raman" as const] : []), ...(loadedTddftResult ? ["uvvis" as const] : [])]}
            hasImportedSpectra={hasImportedSpectra}
            hasAnalysis={thermoRecords.length > 0 || thermochemistryEligibility.source !== null}
            hasThermochemistry={thermoRecords.length > 0}
            hasImported={importedCalculations.length > 0}
            hasExperimental={hasExperimentalSpectra}
            onNavigateExperimental={() => {
              setSelectedSpectrumId((current) => current ?? experimentalSpectra[0]?.selection.id);
              setGuidedView("experimental");
            }}
            onImportSpectrum={() => setSpectrumDialogOpen(true)}
            onNavigateImported={() => {
              setSelectedImportId((current) => current ?? importedCalculations[0]?.selection.id ?? null);
              setSelectedImportResultId(undefined);
              setGuidedView("imported");
            }}
            onImportCalculation={() => setImportDialogOpen(true)}
            onNavigateHome={() => setGuidedView("home")}
            onNavigateStructure={navigateToStructure}
            onNavigateCalculations={() => {
              setGuidedCalculationType((curr) => curr || "energy");
              setGuidedView("setup");
            }}
            onNavigateResult={navigateElectronicResult}
            onNavigateSpectra={navigateSpectra}
            onNavigateThermochemistry={() => setGuidedView("thermochemistry")}
            onSwitchToAdvanced={() => setWorkspaceMode("advanced")}
          />
          <div className="guided-view-pane">
            {["result", "energy-result", "spectra", "thermochemistry"].includes(guidedView) && activeSelection?.kind === "calculationResult"
              && resultHeaderBelongsToView(guidedView, activeSelection.id, {
                thermoResultIds: thermoRecords.map((record) => record.resultId),
                spectraResultIds: [loadedTddftResult?.resultId, loadedVibrationalResult?.resultId, loadedRamanResult?.resultId],
                loadedResultId: loadedResult?.resultId,
              }) ? (
              <ResultContextHeader key={activeSelection.id} projectId={projectId} calculationId={activeSelection.sourceId} resultId={activeSelection.id} />
            ) : null}
            {staleNotice ? <div className="foundation-strip" role="status" data-testid="workspace-stale-notice"><AppIcon icon="info-sign" /> {staleNotice}</div> : null}
            {guidedView === "home" ? (
              <GuidedProjectHome
                projectId={projectId}
                job={{
                  view: guidedJob.view,
                  onOpen: () => { setGuidedCalculationType((current) => current || "energy"); setGuidedSetupStage("review"); setGuidedView("setup"); },
                  onDismiss: guidedJob.dismiss,
                }}
                projectName={projectName}
                structure={selected}
                result={loadedResult?.analysis ?? null}
                hasEnergyResult={Boolean(availableEnergyResult)}
                hasPaper={documents.length > 0}
                hasSpectra={Boolean(loadedTddftResult || loadedVibrationalResult || loadedRamanResult)}
                onNavigateStructure={navigateToStructure}
                onNavigateResult={navigateElectronicResult}
                onNavigateSpectra={navigateSpectra}
                onSetupCalculation={(type) => {
                  setGuidedCalculationType(type);
                  setGuidedView("setup");
                }}
                onOpenAiScientist={() => {
                  setDockVisible(true);
                  window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist"));
                }}
                onSwitchToAdvanced={() => setWorkspaceMode("advanced")}
                onImportCalculation={() => setImportDialogOpen(true)}
                onDrawMolecule={() => {
                  setWorkspaceMode("advanced");
                  void openEditor("new");
                }}
              />
            ) : (guidedView === "structure" || (guidedView === "setup" && guidedCalculationType !== "conformer")) && selected ? (
              <GuidedWorkspace
                key={`workspace:${selected.version.id}`}
                projectId={projectId}
                detail={selected}
                task={(["energy", "optimization", "tddft", "ir", "raman"].includes(guidedCalculationType) ? guidedCalculationType : "energy") as GuidedTask}
                onTask={(next) => { setGuidedCalculationType(next); setGuidedView("setup"); }}
                stage={guidedView === "structure" ? "structure" : guidedSetupStage}
                onStage={(next: StageId) => {
                  if (next === "structure") { navigateToStructure(); return; }
                  setGuidedSetupStage(next);
                  setGuidedView("setup");
                }}
                existingResult={{
                  available:
                    (guidedCalculationType === "energy" && Boolean(loadedResult || availableEnergyResult)) ||
                    (guidedCalculationType === "tddft" && Boolean(loadedTddftResult)) ||
                    (guidedCalculationType === "ir" && Boolean(loadedVibrationalResult)) ||
                    (guidedCalculationType === "raman" && Boolean(loadedRamanResult)),
                  onView: () => {
                    if (guidedCalculationType === "raman") { setActiveSpectroscopyTab("raman"); setGuidedView("spectra"); }
                    else if (guidedCalculationType === "ir") { setActiveSpectroscopyTab("ir"); setGuidedView("spectra"); }
                    else if (guidedCalculationType === "tddft") { setActiveSpectroscopyTab("uvvis"); setGuidedView("spectra"); }
                    else navigateElectronicResult();
                  },
                }}
                job={guidedJob}
                canExecute={projectRole.canExecute}
                onHome={() => setGuidedView("home")}
                onOpenEditor={() => { setWorkspaceMode("advanced"); void openEditor("edit"); }}
                onOpenResult={(finished) => {
                  if (finished.result) openSelection({ kind: "calculationResult", id: finished.result.id, projectId, sourceId: finished.calculation.id }, `Result · ${finished.specification && "method" in finished.specification ? finished.specification.method.identifier.toUpperCase() : "calculation"}`);
                }}
              />
            ) : guidedView === "draft" && activeSelection?.kind === "geometryCandidate" ? (
              <SelectionCanvas key={`${projectId}:draft:${activeSelection.id}`} projectId={projectId}
                selection={activeSelection} label="AI molecular draft" active={true} workspaceStructures={structures.map((item) => ({id: item.id, name: item.name}))} />
            ) : guidedView === "result" && activeSelection?.kind === "calculation" ? (
              <SelectionCanvas key={`${projectId}:calculation:${activeSelection.id}`} projectId={projectId}
                selection={activeSelection} label="Calculation record" active={true} workspaceStructures={structures.map((item) => ({id: item.id, name: item.name}))} />
            ) : guidedView === "result" || guidedView === "energy-result" ? (
              <>
                <label className="guided-result-picker">Published result
                  <select data-testid="guided-result-picker" value={activeSelection?.kind === "calculationResult" ? activeSelection.id : ""}
                    onChange={(event) => {
                      const item = catalog.find((item) => item.selection.kind === "calculationResult" && item.selection.id === event.target.value);
                      if (item) openSelection(item.selection, item.label);
                    }}>
                    <option value="" disabled>Select a published result</option>
                    {(() => {
                      const results = catalog.filter((item) => item.selection.kind === "calculationResult");
                      const counts = new Map<string, number>();
                      for (const item of results) counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
                      // The short id is only shown to tell apart results that have the same name; it is always in the tooltip.
                      return results.map((item) => <option key={item.selection.id} value={item.selection.id} title={`Result ${item.selection.id}`}>{item.label}{(counts.get(item.label) ?? 0) > 1 ? ` · ${item.selection.id.slice(0, 8)}` : ""}</option>);
                    })()}
                  </select>
                </label>
                {activeSelection?.kind === "calculationResult" ? <SelectedGuidedResult
                  key={`${projectId}:${activeSelection.sourceId}:${activeSelection.id}`}
                  projectId={projectId} calculationId={activeSelection.sourceId} resultId={activeSelection.id} tab={guidedResultTab}
                  onInspect={(structure) => openSelection({ kind: "structureVersion", id: structure.version.id, sourceId: structure.structure.id, projectId }, compactStructureTitle(structure.structure.name, structure.version.revision))}
                  onHome={() => setGuidedView("home")}
                  onOptimize={() => { setGuidedCalculationType("optimization"); setGuidedView("setup"); }}
                  hasOptimizedGeometry={thermochemistryEligibility.hasOptimizedGeometry}
                  onAi={() => setDockVisible(true)} onAdvanced={() => setWorkspaceMode("advanced")}
                /> : <div role="status">Select a published scientific result.</div>}
              </>
            ) : guidedView === "spectra" && (loadedTddftResult || loadedVibrationalResult || loadedRamanResult) ? (
              <GuidedSpectraView
                projectId={projectId}
                calculationId={
                  activeSpectroscopyTab === "raman"
                    ? loadedRamanResult?.calculationId
                    : activeSpectroscopyTab === "ir"
                    ? loadedVibrationalResult?.calculationId
                    : loadedTddftResult?.calculationId
                }
                resultId={
                  activeSpectroscopyTab === "raman"
                    ? loadedRamanResult?.resultId
                    : activeSpectroscopyTab === "ir"
                    ? loadedVibrationalResult?.resultId
                    : loadedTddftResult?.resultId
                }
                result={loadedTddftResult?.tddft ?? null}
                vibrationalResult={loadedVibrationalResult}
                ramanResult={loadedRamanResult}
                activeSpectroscopy={activeSpectroscopyTab}
                onSelectSpectroscopy={(tab) => {
                  setActiveSpectroscopyTab(tab);
                  if (tab === "raman" && loadedRamanResult) {
                    openSelection(
                      { kind: "calculationResult", id: loadedRamanResult.resultId, projectId, sourceId: loadedRamanResult.calculationId },
                      `Raman spectrum · ${plural(loadedRamanResult.vibrational.modes.length, "mode")}`,
                    );
                  } else if (tab === "ir" && loadedVibrationalResult) {
                    openSelection(
                      { kind: "calculationResult", id: loadedVibrationalResult.resultId, projectId, sourceId: loadedVibrationalResult.calculationId },
                      vibrationalSpectrumLabel(loadedVibrationalResult.vibrational),
                    );
                  } else if (tab === "uvvis" && loadedTddftResult) {
                    openSelection(
                      { kind: "calculationResult", id: loadedTddftResult.resultId, projectId, sourceId: loadedTddftResult.calculationId },
                      "UV/Vis absorption spectrum",
                    );
                  }
                }}
                onCalculateIr={() => {
                  setGuidedCalculationType("ir");
                  setGuidedView("setup");
                }}
                onCalculateRaman={() => {
                  setGuidedCalculationType("raman");
                  setGuidedView("setup");
                }}
                onCalculateUvVis={() => {
                  setGuidedCalculationType("tddft");
                  setGuidedView("setup");
                }}
                structureName={selected ? compactStructureTitle(selected.structure.name, selected.version.revision) : undefined}
                initialSelectedState={lastSelectedExcitedState}
                onStateSelected={setLastSelectedExcitedState}
                initialSelectedMode={lastSelectedVibrationalMode}
                onModeSelected={setLastSelectedVibrationalMode}
                onNavigateStructure={navigateToStructure}
                onNavigateHome={() => setGuidedView("home")}
                onNavigateElectronicStructure={() => setGuidedView("result")}
                onOpenAiScientist={() => {
                  setDockVisible(true);
                  window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist"));
                }}
                onSwitchToAdvanced={() => setWorkspaceMode("advanced")}
              />
            ) : guidedView === "experimental" ? (
              <div className="guided-experimental-view" data-testid="guided-experimental-view">
                <ExperimentalSpectrumWorkspace
                  projectId={projectId}
                  datasetId={selectedSpectrumId}
                  structures={structures.map((item) => ({ id: item.id, name: item.name }))}
                  onImport={() => setSpectrumDialogOpen(true)}
                  onBack={() => setGuidedView("home")}
                />
              </div>
            ) : guidedView === "imported" ? (
              <div className="guided-imported-view" data-testid="guided-imported-view">
                <div className="guided-view-header">
                  <div className="guided-breadcrumb">
                    <button type="button" className="guided-breadcrumb-link" onClick={() => setGuidedView("home")}>
                      Project Home
                    </button>
                    <span className="breadcrumb-separator">/</span>
                    <span className="breadcrumb-current">
                      <strong>Files &amp; Data</strong>
                    </span>
                  </div>
                  <div className="guided-header-actions" style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      className="guided-action-btn secondary"
                      onClick={() => setImportDialogOpen(true)}
                      data-testid="guided-content-import"
                      title="Import external quantum chemistry output"
                    >
                      <AppIcon icon="import" />
                      <span>Import calculation…</span>
                    </button>
                    <button
                      type="button"
                      className="guided-action-btn secondary"
                      onClick={() => setSpectrumDialogOpen(true)}
                      data-testid="guided-content-import-spectrum"
                      title="Import experimental spectrum file"
                    >
                      <AppIcon icon="upload" />
                      <span>Import spectrum…</span>
                    </button>
                  </div>
                </div>
                {importedCalculations.length > 1 ? (
                  <label className="imported-picker">
                    Imported calculation
                    <select
                      value={selectedImportId ?? ""}
                      aria-label="Imported calculation"
                      onChange={(event) => { setSelectedImportId(event.currentTarget.value); setSelectedImportResultId(undefined); }}
                    >
                      {importedCalculations.map((item) => (
                        <option key={item.selection.id} value={item.selection.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {selectedImportId ? (
                  <ImportedCalculationWorkspace
                    key={`${selectedImportId}:${selectedImportResultId ?? ""}`}
                    projectId={projectId}
                    importId={selectedImportId}
                    initialResultId={selectedImportResultId}
                    onBack={() => setGuidedView("home")}
                  />
                ) : (
                  <div className="imported-empty" data-testid="guided-imported-empty">
                    <h2>Project Files &amp; External Data</h2>
                    <p>Import finished external calculations (Gaussian, ORCA, Q-Chem, NWChem, Molpro, VASP) or upload experimental spectra (JCAMP-DX, CSV) to analyze them alongside your ChemDFT results.</p>
                    <div style={{ display: "flex", gap: "12px", marginTop: "16px", justifyContent: "center" }}>
                      <button type="button" className="import-primary-btn" onClick={() => setImportDialogOpen(true)}>
                        <AppIcon icon="import" /> Import calculation
                      </button>
                      <button type="button" className="import-primary-btn" style={{ background: "#475569" }} onClick={() => setSpectrumDialogOpen(true)}>
                        <AppIcon icon="upload" /> Import experimental spectrum
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : guidedView === "thermochemistry" ? (
              <GuidedThermochemistryView
                projectId={projectId}
                records={thermoRecords}
                selectedResultId={selectedThermoResultId}
                onSelectResult={setSelectedThermoResultId}
                onRequestConditions={requestThermochemistry}
                eligibleSource={thermochemistryEligibility.source}
                hasOptimizedGeometry={thermochemistryEligibility.hasOptimizedGeometry}
                hasFrequencyResult={thermochemistryEligibility.hasFrequencyResult}
                structureName={selected ? compactStructureTitle(selected.structure.name, selected.version.revision) : undefined}
                onNavigateStructure={navigateToStructure}
                onNavigateHome={() => setGuidedView("home")}
                onOpenAiScientist={() => {
                  setDockVisible(true);
                  window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist"));
                }}
                onSwitchToAdvanced={() => setWorkspaceMode("advanced")}
              />
            ) : guidedView === "setup" && selected && guidedCalculationType === "conformer" ? (
              <ConformerSearchPanel key={`conformer:${projectId}:${selected.version.id}`} projectId={projectId} structure={selected}
                onBack={navigateToStructure}
                onOpenResult={(detail) => { if (detail.result) openSelection({ kind: "calculationResult", id: detail.result.id, projectId, sourceId: detail.calculation.id }, "CREST ensemble"); }}
                onOpenCalculation={(detail) => openSelection({kind: "calculation", id: detail.calculation.id, projectId}, "Conformer search")} />
            ) : (
              <GuidedProjectHome
                projectId={projectId}
                job={{
                  view: guidedJob.view,
                  onOpen: () => { setGuidedCalculationType((current) => current || "energy"); setGuidedSetupStage("review"); setGuidedView("setup"); },
                  onDismiss: guidedJob.dismiss,
                }}
                projectName={projectName}
                structure={selected}
                result={loadedResult?.analysis ?? null}
                hasEnergyResult={Boolean(availableEnergyResult)}
                hasPaper={documents.length > 0}
                hasSpectra={Boolean(loadedTddftResult || loadedVibrationalResult || loadedRamanResult)}
                onNavigateStructure={navigateToStructure}
                onNavigateResult={navigateElectronicResult}
                onNavigateSpectra={navigateSpectra}
                onSetupCalculation={(type) => {
                  setGuidedCalculationType(type);
                  setGuidedView("setup");
                }}
                onOpenAiScientist={() => {
                  setDockVisible(true);
                  window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist"));
                }}
                onSwitchToAdvanced={() => setWorkspaceMode("advanced")}
                onDrawMolecule={() => {
                  setWorkspaceMode("advanced");
                  void openEditor("new");
                }}
              />
            )}
          </div>
        </div>
      ) : (
        <>
          {/* The full-pane editor owns the pane: document tabs and the toolbar are hidden (kept mounted so layout rules keyed on them hold) and return on close. */}
          <div className="workspace-chrome" hidden={editorOpen}>
          <WorkspaceTabsBar />
      <div className="document-toolbar" aria-label="Workspace toolbar" ref={setToolbarEl}>
        {contextKind === "structure" ? (
          isCompact || isNarrow || toolbarTight ? (
            <>
              <ActionButton
                minimal
                small
                icon="application"
                text="Calculate"
                title="Set up calculation"
                data-testid="setup-calculation-action-btn"
                disabled={!structureContextReady}
                onClick={() => {
                  showProject();
                  window.setTimeout(() => document.querySelector(".calculation-panel")?.scrollIntoView({ block: "nearest" }), 0);
                }}
              />
              <AppPopover
                isOpen={moreActionsOpen}
                onInteraction={setMoreActionsOpen}
                placement="bottom-start"
                content={
                  <div className="workspace-toolbar-more-menu" role="menu" aria-label="More actions">
                    <ActionButton
                      minimal
                      small
                      icon="add"
                      text="New molecule"
                      title="Draw or import a separate molecule with its own version history"
                      data-testid="toolbar-new-molecule"
                      onClick={() => {
                        setMoreActionsOpen(false);
                        showProject();
                        setShowMoleculeChooser(true);
                      }}
                    />
                    <ActionButton
                      minimal
                      small
                      icon="edit"
                      text="New version"
                      title={selected ? `Draw a revised geometry saved as a new version of “${selected.structure.name}”` : "Draw a revised geometry as a new version of this structure"}
                      data-testid="toolbar-new-version"
                      disabled={!structureContextReady || !canEditMolecule}
                      onClick={() => {
                        setMoreActionsOpen(false);
                        showProject();
                        void openEditor("edit");
                      }}
                    />
                    <ActionButton
                      minimal
                      small
                      icon="upload"
                      text="Import structure…"
                      data-testid="toolbar-import-structure"
                      onClick={() => {
                        setMoreActionsOpen(false);
                        fileInputRef.current?.click();
                      }}
                    />
                    <ActionButton
                      minimal
                      small
                      icon="cube"
                      text="Fit view"
                      onClick={() => {
                        setMoreActionsOpen(false);
                        window.dispatchEvent(new Event("chemdft:fit-active-structure"));
                      }}
                    />
                    <ActionButton
                      minimal
                      small
                      icon="info-sign"
                      text="Inspect"
                      onClick={() => {
                        setMoreActionsOpen(false);
                        setDockVisible(true);
                        window.dispatchEvent(new Event("chemdft:open-inspector"));
                      }}
                    />
                    <ActionButton
                      minimal
                      small
                      icon="predictive-analysis"
                      text="Ask AI"
                      data-testid="toolbar-ask-ai-button"
                      onClick={() => {
                        setMoreActionsOpen(false);
                        if (typeof window !== "undefined") {
                          setDockVisible(true);
                          window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist"));
                        }
                      }}
                    />
                  </div>
                }
              >
                <button
                  type="button"
                  className="bp6-button bp6-minimal bp6-small workspace-more-actions-trigger"
                  aria-haspopup="true"
                  aria-expanded={moreActionsOpen}
                  aria-label="More actions"
                  data-testid="workspace-more-actions-btn"
                >
                  <span>More ▾</span>
                </button>
              </AppPopover>
              {!structureContextReady ? <span role="status">Loading selected structure…</span> : null}
            </>
          ) : (
            <>
              <ActionButton
                minimal
                small
                icon="application"
                text="Calculate"
                title="Set up calculation"
                data-testid="setup-calculation-action-btn"
                disabled={!structureContextReady}
                onClick={() => {
                  showProject();
                  window.setTimeout(() => document.querySelector(".calculation-panel")?.scrollIntoView({ block: "nearest" }), 0);
                }}
              />
              <ActionButton minimal small icon="add" text="New molecule" title="Draw or import a separate molecule with its own version history" data-testid="toolbar-new-molecule" onClick={() => { showProject(); setShowMoleculeChooser(true); }} />
              <ActionButton minimal small icon="edit" text="New version" title={selected ? `Draw a revised geometry saved as a new version of “${selected.structure.name}”` : "Draw a revised geometry as a new version of this structure"} data-testid="toolbar-new-version" disabled={!structureContextReady || !canEditMolecule} onClick={() => { showProject(); void openEditor("edit"); }} />
              <ActionButton minimal small icon="cube" text="Fit" onClick={() => window.dispatchEvent(new Event("chemdft:fit-active-structure"))} />
              {!structureContextReady ? <span role="status">Loading selected structure…</span> : null}
              <ActionButton minimal small icon="info-sign" text="Inspect" onClick={() => { setDockVisible(true); window.dispatchEvent(new Event("chemdft:open-inspector")); }} />
              <Hint content="Open AI Scientist copilot scoped to this project and structure.">
                <ActionButton
                  minimal
                  small
                  icon="predictive-analysis"
                  text="Ask AI"
                  data-testid="toolbar-ask-ai-button"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      setDockVisible(true);
                      window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist"));
                    }
                  }}
                />
              </Hint>
              <span className="toolbar-layout" role="group" aria-label="Panels">
                <button className="workspace-panel-toggle" type="button" aria-pressed={explorerVisible} aria-label={explorerVisible ? "Hide Explorer" : "Show Explorer"}
                  title={explorerVisible ? "Hide Explorer" : "Show Explorer"}
                  onClick={() => setExplorerVisible((value) => !value)}><AppIcon icon="panel-table" /><span className="workspace-panel-toggle-text">Explorer</span></button>
                <button className="workspace-panel-toggle" type="button" aria-pressed={dockVisible} aria-label={dockVisible ? "Hide context panel" : "Show context panel"}
                  title={dockVisible ? "Hide context panel" : "Show context panel"}
                  onClick={() => setDockVisible((value) => !value)}><AppIcon icon="panel-stats" /><span className="workspace-panel-toggle-text">Context</span></button>
              </span>
            </>
          )
        ) : null}
        {contextKind === "dataset" ? <>
          <ActionButton minimal small icon="document" text="View source" onClick={() => window.dispatchEvent(new Event("chemdft:active-dataset-source"))} />
        </> : null}
        {contextKind !== "structure" ? (
          toolbarTight || (toolbarWidth === 0 && (isCompact || isNarrow)) ? (
            <>
              <ActionButton
                minimal
                small
                icon="application"
                text="Calculate"
                title="Set up calculation"
                data-testid="setup-calculation-action-btn"
                disabled={structures.length === 0}
                onClick={() => {
                  showProject();
                  window.setTimeout(() => document.querySelector(".calculation-panel")?.scrollIntoView({ block: "nearest" }), 0);
                }}
              />
              <AppPopover
                isOpen={moreActionsOpen}
                onInteraction={(next) => setMoreActionsOpen(next)}
                placement="bottom-start"
                content={
                  <div className="workspace-toolbar-more-menu" role="menu">
                    <ActionButton minimal small icon="upload" text="Import" onClick={() => { setMoreActionsOpen(false); setImportOpen(true); }} />
                    <ActionButton minimal small icon="add" text="New molecule" title="Draw or import a separate molecule with its own version history" data-testid="toolbar-new-molecule" onClick={() => { setMoreActionsOpen(false); setShowMoleculeChooser(true); }} />
                    <ActionButton minimal small icon="import" text="Import calculation" data-testid="toolbar-import-calculation" onClick={() => { setMoreActionsOpen(false); setImportDialogOpen(true); }} />
                    <ActionButton minimal small icon="timeline-line-chart" text="Import experimental spectrum" data-testid="toolbar-import-spectrum" onClick={() => { setMoreActionsOpen(false); setSpectrumDialogOpen(true); }} />
                    <ActionButton minimal small icon="info-sign" text="Inspect" onClick={() => { setMoreActionsOpen(false); setDockVisible(true); window.dispatchEvent(new Event("chemdft:open-inspector")); }} />
                    <ActionButton minimal small icon="predictive-analysis" text="Ask AI" onClick={() => { setMoreActionsOpen(false); setDockVisible(true); window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist")); }} />
                  </div>
                }
              >
                <button
                  type="button"
                  className="bp6-button bp6-minimal bp6-small workspace-more-actions-trigger"
                  aria-haspopup="true"
                  aria-expanded={moreActionsOpen}
                  aria-label="More actions"
                  data-testid="workspace-more-actions-btn"
                >
                  <span>More ▾</span>
                </button>
              </AppPopover>
            </>
          ) : (
            <>
              <ActionButton
                minimal
                small
                icon="application"
                text="Calculate"
                title="Set up calculation"
                data-testid="setup-calculation-action-btn"
                disabled={structures.length === 0}
                onClick={() => {
                  showProject();
                  window.setTimeout(() => document.querySelector(".calculation-panel")?.scrollIntoView({ block: "nearest" }), 0);
                }}
              />
              <AppPopover
                isOpen={importOpen}
                onInteraction={(next) => setImportOpen(next)}
                placement="bottom-start"
                content={<div className="workspace-import-popover" role="dialog" aria-label="Import structure">
<form
              className="structure-import-form"
              aria-label="Import structure"
              data-testid="workspace-active-import-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitImport();
              }}
            >
              <label className="viz-quiet-label">
                <span className="viz-label-text">Format</span>
                <select
                  value={fileFormat}
                  aria-label="Structure format"
                  data-testid="toolbar-import-format-select"
                  onChange={(event) => setFileFormat(event.currentTarget.value)}
                >
                  <option value="AUTO">Auto-detect format</option>
                  <option value="SDF">MDL SDF / Molfile (.sdf, .mol)</option>
                  <option value="XYZ">XYZ Cartesian Coordinates (.xyz)</option>
                  <option value="CIF">Crystallographic Information (.cif)</option>
                  <option value="PDF">Scientific Publication PDF (.pdf)</option>
                  <option value="CSV">Experimental Table (.csv)</option>
                  <option value="TSV">Experimental Table (.tsv)</option>
                  <option value="XY">Experimental Spectrum (.xy)</option>
                </select>
              </label>
              <input
                ref={fileInputRef}
                id="toolbar-structure-upload"
                type="file"
                accept=".sdf,.mol,.xyz,.cif,.pdf,.csv,.tsv,.xy,chemical/*"
                onChange={(event) => {
                  const nextFile = event.currentTarget.files?.[0] ?? null;
                  setFile(nextFile);
                  if (nextFile) {
                    const detected = fileFormat === "AUTO" ? detectFormat(nextFile.name) : fileFormat;
                    setFileFormat(detected);
                    setImportOpen(false);
                    void submitImport(nextFile, detected);
                  }
                  event.currentTarget.value = "";
                }}
              />
              <ActionButton intent="primary" icon="upload" text="Import" type="submit" disabled={!catalogReady} />
            </form>
</div>}
              >
                <button type="button" className="bp6-button bp6-minimal bp6-small" aria-haspopup="dialog" aria-expanded={importOpen} data-testid="toolbar-import-btn">
                  <AppIcon icon="upload" /><span>Import</span>
                </button>
              </AppPopover>
              <ActionButton minimal small icon="add" text="New molecule" title="Draw or import a separate molecule with its own version history" data-testid="toolbar-new-molecule" onClick={() => setShowMoleculeChooser(value => !value)} />
              {toolbarMedium ? (
                <AppPopover
                  isOpen={moreActionsOpen}
                  onInteraction={(next) => setMoreActionsOpen(next)}
                  placement="bottom-start"
                  content={
                    <div className="workspace-toolbar-more-menu" role="menu" aria-label="More actions">
                      <ActionButton minimal small icon="import" text="Import calculation" data-testid="toolbar-import-calculation" onClick={() => { setMoreActionsOpen(false); setImportDialogOpen(true); }} />
                      <ActionButton minimal small icon="timeline-line-chart" text="Import experimental spectrum" data-testid="toolbar-import-spectrum" onClick={() => { setMoreActionsOpen(false); setSpectrumDialogOpen(true); }} />
                      <ActionButton minimal small icon="info-sign" text="Inspect" onClick={() => { setMoreActionsOpen(false); setDockVisible(true); window.dispatchEvent(new Event("chemdft:open-inspector")); }} />
                      <ActionButton minimal small icon="predictive-analysis" text="Ask AI" data-testid="toolbar-ask-ai-button" onClick={() => { setMoreActionsOpen(false); setDockVisible(true); window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist")); }} />
                    </div>
                  }
                >
                  <button type="button" className="bp6-button bp6-minimal bp6-small workspace-more-actions-trigger" aria-haspopup="true" aria-expanded={moreActionsOpen} aria-label="More actions" data-testid="workspace-more-actions-btn">
                    <span>More ▾</span>
                  </button>
                </AppPopover>
              ) : (
                <>
              <ActionButton minimal small icon="import" text="Import calculation" data-testid="toolbar-import-calculation" onClick={() => setImportDialogOpen(true)} />
              <ActionButton minimal small icon="timeline-line-chart" text="Import experimental spectrum" data-testid="toolbar-import-spectrum" onClick={() => setSpectrumDialogOpen(true)} />
              <ActionButton minimal small icon="info-sign" text="Inspect" onClick={() => { setDockVisible(true); window.dispatchEvent(new Event("chemdft:open-inspector")); }} />
              <Hint content="Open AI Scientist copilot scoped to this project and structure.">
                <ActionButton
                  minimal
                  small
                  icon="predictive-analysis"
                  text="Ask AI"
                  data-testid="toolbar-ask-ai-button"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      setDockVisible(true);
                      window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist"));
                    }
                  }}
                />
              </Hint>
                </>
              )}
              <span className="toolbar-layout" role="group" aria-label="Panels">
                <button className="workspace-panel-toggle" type="button" aria-pressed={explorerVisible} aria-label={explorerVisible ? "Hide Explorer" : "Show Explorer"}
                  title={explorerVisible ? "Hide Explorer" : "Show Explorer"}
                  onClick={() => setExplorerVisible((value) => !value)}><AppIcon icon="panel-table" /><span className="workspace-panel-toggle-text">Explorer</span></button>
                <button className="workspace-panel-toggle" type="button" aria-pressed={dockVisible} aria-label={dockVisible ? "Hide context panel" : "Show context panel"}
                  title={dockVisible ? "Hide context panel" : "Show context panel"}
                  onClick={() => setDockVisible((value) => !value)}><AppIcon icon="panel-stats" /><span className="workspace-panel-toggle-text">Context</span></button>
              </span>
            </>
          )
        ) : null}
        <span className="toolbar-spacer" style={{ flex: "1 1 auto" }} />
        {contextKind === "structure" ? (
          <ExportMenu
            context="structure"
            projectId={projectId}
            structureId={selected?.structure.id}
            structureVersionId={selected?.version.id}
            structureName={selected?.structure.name}
            disabled={!structureContextReady}
            disabledReason="Select a structure first"
            isPeriodic={selected?.structure.kind === "PERIODIC"}
            onExportFile={handleExportStructureFile}
          />
        ) : contextKind === "result" && activeSelection && "sourceId" in activeSelection ? (
          <ExportMenu
            context="result"
            projectId={projectId}
            calculationId={activeSelection.sourceId}
            resultId={activeSelection.id}
            structureLabel={selected?.structure.name}
          />
        ) : (
          <ExportMenu
            context="project"
            projectId={projectId}
            structureId={selected?.structure.id}
            structureVersionId={selected?.version.id}
            structureLabel={selected?.structure.name}
          />
        )}
      </div>
          </div>

      <div className="workbench-stack">
      {workspaceState.tabs.map(tab => (
        <WorkbenchPanel
          key={selectionKey(tab.selection)}
          panelKey={`${projectId}:${selectionKey(tab.selection)}`}
          active={workspaceState.activeKey === selectionKey(tab.selection)}
        >
          <SelectionCanvas
            projectId={projectId}
            selection={tab.selection}
            active={workspaceState.activeKey === selectionKey(tab.selection)}
            label={tab.label}
            structureName={selected ? compactStructureTitle(selected.structure.name, selected.version.revision) : undefined}
            initialSelectedState={lastSelectedExcitedState}
            onStateSelected={setLastSelectedExcitedState}
            initialSelectedMode={lastSelectedVibrationalMode}
            onModeSelected={setLastSelectedVibrationalMode}
            workspaceStructures={structures.map((item) => ({ id: item.id, name: item.name }))}
          />
        </WorkbenchPanel>
      ))}
      <WorkbenchPanel active={!activeSelection} panelKey={`${projectId}:project`}>{editorMode && editorTarget ? (
        <MoleculeEditorPane
          key={editorTarget.key}
          mode={editorMode}
          target={editorTarget}
          initialMolfile={editorMolfile}
          projectId={projectId}
          parentStructureVersion={
            editorTarget.kind === "new-version"
              ? { entity_id: editorTarget.parent.versionId, entity_type: "structure.version", project_id: projectId }
              : null
          }
          structureName={editorTarget.kind === "new-version" ? editorTarget.parent.name : ""}
          onSwitchToNewMolecule={(molfile) => void openEditor("new", null, molfile)}
          onCancel={closeEditor}
          onAccepted={async (result) => {
            const freshStructures = await listStructures(projectId);
            setStructures(freshStructures);
            await loadVersions(result.structure.id, result.version.id);
            closeEditor();
            const parent = editorTarget.kind === "new-version" ? editorTarget.parent : null;
            setMessage(parent
              ? `Saved ${result.structure.name} V${result.version.revision} as a new version of this structure (parent V${parent.revision}). Earlier versions and their results are unchanged.`
              : `Saved ${result.structure.name} V${result.version.revision} as a new molecule with its own version history. No existing structure was changed.`);
          }}
        />
      ) : <section className="structure-workspace" aria-labelledby="workspace-title">
        {selected ? (
          <div className="structure-workspace-header structure-workspace-header--slim">
            <h1 id="workspace-title" className="workspace-structure-title" title={activeStructureName}>{activeStructureName}</h1>
            <span className="visually-hidden structure-count">{structures.length} saved structure{structures.length === 1 ? "" : "s"} loaded from the ChemDFT API.</span>
            <div className="structure-facts" data-testid="viewer-structure-facts">
              <span className="structure-fact-item structure-chip" title="Formula"><strong className="fact-value">{derivedFormula ?? "—"}</strong></span>
              <span className="structure-fact-item structure-chip"><strong className="fact-value">{selectedAtoms.length}</strong> atoms</span>
              <span className="structure-fact-item structure-chip">charge <strong className="fact-value">{selected.version.overall_charge}</strong></span>
              <span className="structure-fact-item structure-chip">mult <strong className="fact-value">{selected.version.multiplicity}</strong></span>
              <span className="structure-fact-item structure-chip" title="Source"><strong className="fact-value">{selected.provenance?.source_class ?? selected.version.origin}</strong></span>
            </div>
            {selected.structure.kind === "PERIODIC" ? <span className="structure-periodic-badge" data-testid="structure-periodic-badge">PERIODIC</span> : null}
          </div>
        ) : (
          <div className="structure-import-strip">
            <div>
              <h1 id="workspace-title">{documents.length ? "What ChemDFT found" : "Import a structure to begin"}</h1>
              <p>Structure, PDF, and experimental imports preserve raw bytes, register a source artifact, and commit only after server-side validation.</p>
              <p className="structure-count">{structures.length} saved structure{structures.length === 1 ? "" : "s"} loaded from the ChemDFT API.</p>
              <p className="structure-truth-note">This workspace renders saved structure records and firewall-published engine results only; no scientific value is simulated.</p>
            </div>
            <form className="structure-import-form" aria-label="Import structure" onSubmit={(event) => {
              event.preventDefault();
              void submitImport();
            }}>
              {structures.length > 0 ? (
                <label>
                  Open structure
                  <select
                    value=""
                    aria-label="Open structure"
                    onChange={(event) => {
                      const structure = structures.find((item) => item.id === event.currentTarget.value);
                      if (structure) void loadVersions(structure.id, structure.latest_version_id);
                    }}
                  >
                    {structures.map((structure) => (
                      <option key={structure.id} value={structure.id}>
                        {structure.name} · V{structure.latest_revision}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                Source file
                <input
                  ref={fileInputRef}
                  id="structure-upload"
                  type="file"
                  accept=".sdf,.mol,.xyz,.cif,.pdf,.csv,.tsv,.xy,chemical/*"
                  onChange={(event) => {
                    const nextFile = event.currentTarget.files?.[0] ?? null;
                    setFile(nextFile);
                    if (nextFile) setFileFormat(detectFormat(nextFile.name));
                  }}
                />
              </label>
              <label>
                Format
                <select value={fileFormat} aria-label="Structure format" onChange={(event) => setFileFormat(event.currentTarget.value)}>
                  <option>SDF</option>
                  <option>MOL</option>
                  <option>XYZ</option>
                  <option>CIF</option>
                  <option>PDF</option>
                  <option>CSV</option>
                  <option>TSV</option>
                  <option>XY</option>
                </select>
              </label>
              {["CSV", "TSV", "XY"].includes(fileFormat) ? (
                <>
                  <label>
                    Modality
                    <select value={experimentalModality} aria-label="Experimental modality" onChange={(event) => setExperimentalModality(event.currentTarget.value)}>
                      <option value="XRD">XRD</option>
                      <option value="TG_DTA">TG / DTG / DTA</option>
                      <option value="DLS">DLS</option>
                      <option value="FTIR">FTIR</option>
                      <option value="NMR">NMR</option>
                      <option value="UV_VIS">UV-Vis</option>
                      <option value="HRMS">HRMS</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  <label>
                    X column
                    <input value={xColumn} onChange={(event) => setXColumn(event.currentTarget.value)} />
                  </label>
                  <label>
                    Y columns
                    <input value={yColumns} onChange={(event) => setYColumns(event.currentTarget.value)} />
                  </label>
                  <label>
                    X unit
                    <input value={xUnit} onChange={(event) => setXUnit(event.currentTarget.value)} />
                  </label>
                  <label>
                    Y unit
                    <input value={yUnit} onChange={(event) => setYUnit(event.currentTarget.value)} />
                  </label>
                </>
              ) : null}
              <ActionButton intent="primary" icon="upload" text="Import" type="submit" disabled={!catalogReady} />
            </form>
          </div>
        )}

        {staleNotice ? <div className="foundation-strip" role="status" data-testid="workspace-stale-notice"><AppIcon icon="info-sign" /> {staleNotice}</div> : null}
        {message ? <div className="foundation-strip" role="status" data-testid="workspace-message"><AppIcon icon="info-sign" /> {message}</div> : null}
        {selected ? (
          <>
            <div className="structure-grid visualization-grid">
              <ScientificVisualizationPanel
                active={!activeSelection}
                detail={selected}
                selectedAtomIndex={selectedAtomIndex}
                measurementKind={measurementKind}
                measurementAtomIndices={measurementAtomIndices}
                onSelectAtom={selectAtom}
                onMeasurementKindChange={changeMeasurementKind}
                onSceneReady={setScene}
              />
              <CalculationPanel
                key={selected.version.id}
                projectId={projectId}
                structureVersionId={selected.version.id}
                structure={selected}
                charge={selected.version.overall_charge}
                multiplicity={selected.version.multiplicity}
                structureOrigin={selected.version.origin}
                coordinateOrigin={selected.provenance?.coordinate_origin ?? null}
                periodic={isPeriodic}
                onOpenEditor={() => void openEditor("edit")}
              />
              <section className="structure-pane" aria-labelledby="coordinates-title">
                <div className="pane-heading">
                  <div>
                    <h2 id="coordinates-title">{isPeriodic ? "Crystal coordinates" : "Molecule coordinates"}</h2>
                    <p>{selectedCoordinates?.coordinate_system ?? "Unknown"} coordinates from immutable V{selected.version.revision}. Units: {selectedCoordinates?.unit === "angstrom" ? "Angstrom" : selectedCoordinates?.unit === "bohr" ? "Bohr" : selectedCoordinates?.unit === "fractional" ? "Fractional (dimensionless)" : "Unavailable"}.</p>
                  </div>
                  <StatusTag intent={isPeriodic ? "none" : "success"}>{selected.structure.kind}</StatusTag>
                </div>
                {isPeriodic && selectedCell ? <PeriodicCellPanel cell={selectedCell} /> : null}
                <StructureTable
                  title={isPeriodic ? "Sites" : "Atoms"}
                  headers={isPeriodic ? ["Index", "Species", "fx", "fy", "fz", "Occ."] : ["Index", "Element", "Atomic number", "X", "Y", "Z"]}
                  rows={atomRows(selectedAtoms, isPeriodic)}
                  emptyText="No atoms or sites are present in this version."
                  selectedRowKey={selectedAtomIndex == null ? null : String(selectedAtomIndex)}
                  onRowClick={(row) => selectAtom(Number(row[0]))}
                />
                {!isPeriodic ? (
                  <StructureTable
                    title="Bonds"
                  headers={["A", "B", "Order"]}
                  rows={bondRows(selectedBonds)}
                  emptyText="No bond connectivity was provided by the source format."
                  />
                ) : null}
                <Diagnostics diagnostics={diagnostics} />
              </section>

              <aside className="structure-inspector" aria-label="Structure inspector">
                <h2>Version History</h2>
                <ol className="version-list">
                  {versions.map((item) => (
                    <li key={item.version.id}>
                      <button type="button" className="version-button" onClick={() => { chooseVersion(item); openSelection({ kind: "structureVersion", id: item.version.id, projectId, sourceId: item.structure.id }, `${item.structure.name} · V${item.version.revision}`); }} aria-current={item.version.id === selected.version.id ? "true" : undefined}>
                        <strong>V{item.version.revision}</strong>
                        <span>{item.version.origin}</span>
                        <span className="version-authority">Authority: {item.version.origin === "RECONSTRUCTED" ? "User reviewed reconstruction" : item.provenance?.source_class ?? item.version.origin}</span>
                        <StatusTag>Review: {item.version.origin === "RECONSTRUCTED" && item.provenance?.verification_state === "VERIFIED" ? "USER REVIEWED" : item.provenance?.verification_state === "UNVERIFIED" ? "NOT REVIEWED" : item.provenance?.verification_state ?? "NOT REVIEWED"}</StatusTag>
                      </button>
                    </li>
                  ))}
                </ol>
                <ProvenancePanel detail={selected} />
                <VisualizationInspector scene={scene} selectedAtomIndex={selectedAtomIndex} />
              </aside>
            </div>

            <Phase7EvidencePanel
              projectId={projectId}
              documents={documents}
              datasets={datasets}
              onImport={() => fileInputRef.current?.click()}
              onPromoted={async (output) => {
                setStructures(await listStructures(projectId));
                await loadVersions(output.structure.id, output.version.id);
              }}
            />
            <KnowledgeSearchPanel projectId={projectId} />
          </>
        ) : (
          <>
            {documents.length > 0 ? (
              <Phase7EvidencePanel
                projectId={projectId}
                documents={documents}
                datasets={datasets}
                onImport={() => fileInputRef.current?.click()}
                onPromoted={async (output) => {
                  setStructures(await listStructures(projectId));
                  await loadVersions(output.structure.id, output.version.id);
                }}
              />
            ) : null}
            {loading ? <EmptyStructureState title="Loading structures…" hasDocuments={false} onImport={() => fileInputRef.current?.click()} onCreate={() => setShowMoleculeChooser(true)} /> : null}
            {!loading ? <EmptyStructureState title={documents.length ? "No validated 3D structure yet" : "No saved structures yet"} hasDocuments={documents.length > 0} onImport={() => fileInputRef.current?.click()} onCreate={() => setShowMoleculeChooser(true)} /> : null}

            {showMoleculeChooser ? (
              <section className="phase7-entry-chooser" aria-label="New molecule options" data-testid="new-molecule-chooser">
                <div><strong>New molecule</strong><span>Creates a separate structure with its own version history. A paper figure is not a structure file.</span></div>
                <ActionButton small icon="edit" text="Draw manually" onClick={() => void openEditor("new")} />
                <ActionButton small icon="upload" text="Import structure file" onClick={() => fileInputRef.current?.click()} />
                <ActionButton minimal small text="Cancel" onClick={() => setShowMoleculeChooser(false)} />
              </section>
            ) : null}

            {documents.length === 0 ? (
              <Phase7EvidencePanel
                projectId={projectId}
                documents={documents}
                datasets={datasets}
                onImport={() => fileInputRef.current?.click()}
                onPromoted={async (output) => {
                  setStructures(await listStructures(projectId));
                  await loadVersions(output.structure.id, output.version.id);
                }}
              />
            ) : null}
            <KnowledgeSearchPanel projectId={projectId} />
          </>
        )}
      </section>}</WorkbenchPanel>
      </div>
        </>
      )}
    </>
  );
}

type SelectedResource = {
  geometryCandidate?: GeometryCandidateView;
  drawingMol?: string | null;
  inputVersion?: StructureVersionDetail;
  document?: ScientificDocument;
  evidence?: EvidenceCandidate;
  candidate?: StructureCandidate;
  representation?: CandidateRepresentationDetail;
  preview?: PreviewScene;
  version?: VersionDetail;
  dataset?: ExperimentalDatasetView;
  calculation?: CalculationDetail;
  note?: ProjectMemoryView;
  file?: WorkspaceFile;
  recognitionProposal?: CandidateRecognitionProposalView | null;
  recognitionMolBlock?: string | null;
};

function SelectionCanvas({
  projectId,
  selection,
  active,
  label,
  structureName,
  initialSelectedState,
  onStateSelected,
  initialSelectedMode,
  onModeSelected,
  workspaceStructures,
}: {
  projectId: string;
  selection: WorkspaceSelection;
  workspaceStructures: Array<{ id: string; name: string }>;
  active: boolean;
  label: string;
  structureName?: string | undefined;
  initialSelectedState?: string | null | undefined;
  onStateSelected?: (stateLabel: string | null) => void;
  initialSelectedMode?: number | null | undefined;
  onModeSelected?: (modeIndex: number | null) => void;
}) {
  const { catalog, openSelection, updateSelection } = useWorkspaceState();
  const canvasParams = useParams();
  const canvasLocale = typeof canvasParams?.locale === "string" ? canvasParams.locale : "en";
  const [resource, setResource] = useState<SelectedResource | null>(null);
  const [conformerSetup, setConformerSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [xrdSourceSession, setXrdSourceSession] = useState<SourceDigitizationSession | null>(
    pendingXrdSessionFromStorage,
  );
  const [xrdSourceSelectedPoint, setXrdSourceSelectedPoint] = useState<number | null>(pendingXrdPointFromStorage);
  const sourceId = "sourceId" in selection ? selection.sourceId : null;
  const kind = selection.kind;
  const id = selection.id;
  const history = catalog.find((item) => selectionKey(item.selection) === selectionKey(selection));

  useEffect(() => {
    if (!active) return;
    if (["document", "documentEvidence", "file", "experimentalDataset", "note", "historyEvent", "calculation"].includes(kind)) {
      window.dispatchEvent(
        new CustomEvent("chemdft:workspace-selection", {
          detail: {
            projectId,
            currentView: label,
            selectionName: label,
          },
        }),
      );
    }
  }, [active, projectId, kind, label]);

  useEffect(() => {
    function openXrdSource(event: Event) {
      const detail = (event as CustomEvent<{
        documentId: string;
        evidenceId: string;
        page: number;
        session: SourceDigitizationSession;
        selectedPointIndex?: number;
      }>).detail;
      if (!active) return;
      pendingXrdSourceSession = detail.session;
      window.sessionStorage.setItem("chemdft:xrd-source-session", JSON.stringify(detail.session));
      if (detail.selectedPointIndex !== undefined) {
        window.sessionStorage.setItem("chemdft:xrd-source-selected-point", String(detail.selectedPointIndex));
        setXrdSourceSelectedPoint(detail.selectedPointIndex);
      }
      setXrdSourceSession(detail.session);
      openSelection(
        {
          kind: "documentEvidence",
          id: detail.evidenceId,
          projectId,
          sourceId: detail.documentId,
          locator: { page: detail.page },
        },
        `Figure ${detail.session.figure_number} ${"y_unit_status" in detail.session ? "XRD" : "DLS"} · source`,
      );
    }
    window.addEventListener("chemdft:xrd-view-source", openXrdSource);
    return () => window.removeEventListener("chemdft:xrd-view-source", openXrdSource);
  }, [active, openSelection, projectId]);

  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    let active = true;
    async function load(): Promise<SelectedResource> {
      if (kind === "document" || kind === "documentEvidence") {
        const output = await getDocument(projectId, kind === "document" ? id : sourceId!);
        const evidence = kind === "documentEvidence" ? output.candidates?.find((item) => item.id === id) : undefined;
        if (kind === "documentEvidence" && !evidence) throw new Error("This document evidence record is no longer available.");
        return { document: output.document, ...(evidence ? { evidence } : {}) };
      }
      if (kind === "file") {
        const [files, documents] = await Promise.all([listWorkspaceFiles(projectId), listDocuments(projectId)]);
        const file = files.find((item) => item.id === id);
        if (!file) throw new Error("This source file is no longer available.");
        const document = documents.documents.find((item) => item.sha256 === file.sha256);
        return { file, ...(document ? { document } : {}) };
      }
      if (kind === "geometryCandidate") {
        const geometryCandidate = await getGeometryCandidate({ projectId, candidateId: id });
        const drawingMol = await getGeometryCandidateDrawing({ projectId, candidateId: id }).catch(() => null);
        return { geometryCandidate, drawingMol };
      }
      if (kind === "structureCandidate" || kind === "candidateRepresentation") {
        const candidateId = kind === "structureCandidate" ? id : sourceId!;
        const candidate = (await listStructureCandidates(projectId)).candidates?.find((item) => item.id === candidateId);
        if (!candidate) throw new Error("This structure candidate is no longer available.");
        const representations = await listCandidateRepresentations(projectId, candidateId);
        const chosen = kind === "candidateRepresentation"
          ? representations.representations?.find((item) => item.id === id)
          : [...(representations.representations ?? [])].reverse().find((item) => item.coordinates_available);
        if (kind === "candidateRepresentation" && !chosen) throw new Error("This candidate representation is no longer available.");
        const representation = chosen ? await getCandidateRepresentation(projectId, candidateId, chosen.id) : undefined;
        const preview = representation?.validation_state === "PREVIEWABLE" && representation.coordinate_representation
          ? buildCandidatePreviewScene({ candidateId, representationId: representation.id,
            representationRevision: representation.revision, representation: representation.coordinate_representation }) : undefined;
        const output = await getDocument(projectId, candidate.source_document_id);
        const evidence = output.candidates?.find((item) => item.id === candidate.source_evidence_id);

        let recognitionProposal: CandidateRecognitionProposalView | null = null;
        let recognitionMolBlock: string | null = null;
        const latestRecognition = latestRecognitionRepresentations(representations.representations ?? []);
        if (latestRecognition.smiles) {
          try {
            // The persisted proposal is shown as stored; status, charge and ambiguities are never
            // re-derived or defaulted on the client.
            recognitionProposal = recognitionProposalFromDetail(
              await getCandidateRepresentation(projectId, candidateId, latestRecognition.smiles.id),
            );
          } catch {
            // The launcher stays available if the stored proposal cannot be loaded.
          }
        }
        if (latestRecognition.mol) {
          try {
            const molDetail = await getCandidateRepresentation(projectId, candidateId, latestRecognition.mol.id);
            recognitionMolBlock = molDetail.mol_block ?? null;
          } catch {
            // Optional
          }
        }

        return {
          candidate,
          document: output.document,
          ...(representation ? { representation } : {}),
          ...(preview ? { preview } : {}),
          ...(evidence ? { evidence } : {}),
          recognitionProposal,
          recognitionMolBlock,
        };
      }
      if (kind === "structureVersion" || kind === "optimizedStructureVersion" || kind === "scientificScene") {
        const version = (await listStructureVersions(projectId, sourceId!)).find((item) => item.version.id === id);
        if (!version) throw new Error("This saved structure version is no longer available.");
        return { version: version as VersionDetail };
      }
      if (kind === "experimentalDataset") {
        const dataset = (await listExperimentalDatasets(projectId)).datasets.find((item) => item.id === id);
        if (!dataset) throw new Error("This experimental dataset is no longer available.");
        return { dataset };
      }
      if (kind === "calculation" || kind === "calculationResult" || kind === "optimizationTrajectory") {
        const calculation = await getCalculation({ projectId, calculationId: kind === "calculation" ? id : sourceId! });
        if (kind === "calculationResult" && calculation.result?.id !== id) throw new Error("This published result is no longer available.");
        if (kind === "optimizationTrajectory" && calculation.optimization_trajectory?.id !== id) throw new Error("This optimization trajectory is no longer available.");
        const version = calculation.result ? await calculationInputStructure(projectId, calculation) : undefined;
        return { calculation, ...(version ? { inputVersion: version } : {}) };
      }
      if (kind === "note") {
        const note = (await listProjectMemory(projectId)).memories?.find((item) => item.id === id && item.memory_type === "PROJECT_NOTE");
        if (!note) throw new Error("This note is no longer available.");
        return { note };
      }
      return {};
    }
    queueMicrotask(() => { setResource(null); setError(null); });
    void load().then((loaded) => { if (active) setResource(loaded); }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "The selected project item could not be opened.");
    });
    return () => { active = false; };
  }, [projectId, kind, id, sourceId, reloadTick]);

  const selectedCalculationId = resource?.calculation?.calculation.id;
  const selectedCalculationState = resource?.calculation?.calculation.state;
  useEffect(() => {
    if (!selectedCalculationId || ["SUCCEEDED", "FAILED", "CANCELED"].includes(selectedCalculationState ?? "")) return;
    const timer = window.setInterval(() => {
      void getCalculation({ projectId, calculationId: selectedCalculationId }).then((next) => {
        setResource((current) => current?.calculation?.calculation.id === next.calculation.id ? { ...current, calculation: next } : current);
        if (["SUCCEEDED", "FAILED", "CANCELED"].includes(next.calculation.state)) window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
      }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Calculation progress could not be refreshed."));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [projectId, selectedCalculationId, selectedCalculationState]);

  function pageChanged(page: number) {
    if (selection.locator?.page === page) return;
    updateSelection({ ...selection, locator: { ...selection.locator, page } });
  }

  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [extractedFigures, setExtractedFigures] = useState<StructureCandidate[]>([]);
  const [extractingFigures, setExtractingFigures] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [recognizingCandidateId, setRecognizingCandidateId] = useState<string | null>(null);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  // Result of a recognition run in this tab; only used for the candidate it was produced for.
  const [localRecognition, setLocalRecognition] = useState<{
    candidateId: string;
    proposal: CandidateRecognitionProposalView;
    molBlock: string | null;
  } | null>(null);

  useEffect(() => {
    if (!resource?.document) return;
    let alive = true;
    void listStructureCandidates(projectId).then((out) => {
      if (alive) {
        const matching = (out.candidates ?? []).filter((c) => c.source_document_id === resource.document!.id);
        setExtractedFigures(matching);
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [resource?.document, projectId, reloadTick]);
  const visibleFigures = resource?.document ? extractedFigures : [];

  async function handleExtractFigures() {
    const docId = resource?.document?.id;
    if (!docId) return;
    setExtractingFigures(true);
    setExtractionError(null);
    try {
      const out = await extractDocumentFigures(projectId, docId);
      setExtractedFigures([...(out.candidates ?? [])]);
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
      setReloadTick((t) => t + 1);
    } catch (err) {
      setExtractionError(err instanceof Error ? err.message : "Failed to extract figures from PDF.");
    } finally {
      setExtractingFigures(false);
    }
  }

  async function handleRecognizeCandidate(candId: string) {
    setRecognizingCandidateId(candId);
    setRecognitionError(null);
    try {
      const out = await recognizeCandidateFigure(projectId, candId);
      const reps = await listCandidateRepresentations(projectId, candId);
      const { mol: molRep } = latestRecognitionRepresentations(reps.representations ?? []);
      const molBlock = molRep
        ? ((await getCandidateRepresentation(projectId, candId, molRep.id)).mol_block ?? null)
        : null;
      setLocalRecognition({ candidateId: candId, proposal: out.proposal, molBlock });
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
      setReloadTick((t) => t + 1);
    } catch (err) {
      setRecognitionError(err instanceof Error ? err.message : "Molecular recognition failed.");
    } finally {
      setRecognizingCandidateId(null);
    }
  }

  async function handleReviewCandidate(candId: string) {
    try {
      await reviewStructureCandidate(projectId, candId);
      setResource((prev) => (prev?.candidate?.id === candId ? { ...prev, candidate: { ...prev.candidate, candidate_state: "REVIEWED" } } : prev));
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
      setReloadTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review candidate.");
    }
  }

  async function handleRejectCandidate(candId: string) {
    try {
      await rejectStructureCandidate(projectId, candId);
      setResource((prev) => (prev?.candidate?.id === candId ? { ...prev, candidate: { ...prev.candidate, candidate_state: "REJECTED" } } : prev));
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
      setReloadTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject candidate.");
    }
  }

  const localForCandidate = localRecognition?.candidateId === resource?.candidate?.id ? localRecognition : null;
  const currentProposal = localForCandidate?.proposal ?? resource?.recognitionProposal ?? null;
  const currentMolBlock = localForCandidate ? localForCandidate.molBlock : (resource?.recognitionMolBlock ?? null);
  const activeRecognitionView: MolecularRecognitionCandidateView | null = useMemo(() => {
    if (!resource?.candidate || !currentProposal) return null;
    const cand = resource.candidate;
    return {
      candidateId: cand.id,
      projectId,
      documentTitle: resource.document?.title ?? "Imported Document",
      documentId: cand.source_document_id,
      pageNumber: cand.source_page ?? currentProposal.source_page_number ?? 1,
      figureNumber: cand.source_anchor?.figure_number
        ? `Figure ${cand.source_anchor.figure_number}`
        : currentProposal.source_figure_number ?? "Figure",
      figureUrl: getCandidateFigureUrl(projectId, cand.id),
      figureRegion: currentProposal.figure_region ?? [
        cand.source_anchor?.x ?? 0,
        cand.source_anchor?.y ?? 0,
        cand.source_anchor?.width ?? 1,
        cand.source_anchor?.height ?? 1,
      ],
      recognitionEngine: currentProposal.recognition_engine,
      engineVersion: currentProposal.engine_version,
      proposedSmiles: currentProposal.canonical_isomeric_smiles ?? currentProposal.proposed_smiles,
      rawModelOutput: currentProposal.raw_model_output,
      formula: currentProposal.formula,
      formalCharge: currentProposal.formal_charge,
      heavyAtomCount: currentProposal.heavy_atom_count,
      drawingMol: currentMolBlock,
      status: cand.candidate_state === "REVIEWED" ? "REVIEWED" : cand.candidate_state === "REJECTED" ? "REJECTED" : currentProposal.status,
      confidence: currentProposal.confidence,
      validationWarnings: currentProposal.validation_warnings ?? [],
      diagnostics: currentProposal.diagnostics ?? [],
      unresolvedAmbiguities: currentProposal.unresolved_ambiguities ?? [],
    };
  }, [resource?.candidate, resource?.document, currentProposal, currentMolBlock, projectId]);
  useEffect(() => {
    if (!active || !resource?.dataset) return;
    const dataset = resource.dataset;
    function exportRecord() {
      saveBlob(new Blob([JSON.stringify(dataset, null, 2)], { type: "application/json" }), `${dataset.name}.json`);
      setActionNotice("Saved dataset record exported.");
    }
    function viewSource() {
      const session = dataset.digitization_session;
      if (!session) { setActionNotice("This raw dataset has no linked document page. Its source artifact remains recorded in the dataset."); return; }
      window.dispatchEvent(new CustomEvent("chemdft:xrd-view-source", { detail: { documentId: session.source_document_id, evidenceId: session.source_evidence_id, page: session.page_number, session } }));
    }
    window.addEventListener("chemdft:active-dataset-source", viewSource);
    window.addEventListener("chemdft:active-dataset-export", exportRecord);
    return () => { window.removeEventListener("chemdft:active-dataset-source", viewSource); window.removeEventListener("chemdft:active-dataset-export", exportRecord); };
  }, [active, resource?.dataset]);

  const result = resource?.calculation?.result;
  const energy = result?.payload && "total_energy" in result.payload ? result.payload.total_energy : null;

  return <section className={`workspace-selected-canvas ${resource?.version && !conformerSetup ? "structure-workbench-canvas" : ""} ${result?.result_type === "chemdft.molecular-orbitals" && kind === "calculationResult" ? "electronic-workbench-canvas" : ""}`} data-testid="selected-workspace-canvas" aria-label="Scientific Canvas">
    <div className="workspace-canvas-header">
      {resource?.version?.structure.kind === "MOLECULE" ? <button type="button" aria-pressed={conformerSetup} onClick={() => setConformerSetup((value) => !value)}>{conformerSetup ? "Return to geometry" : "Conformer search"}</button> : null}
      <div><h1 title={label}>{resource?.version ? compactStructureTitle(resource.version.structure.name, resource.version.version.revision) : label}</h1></div>
      {kind === "structureCandidate" || kind === "candidateRepresentation" ? <strong className="workspace-canvas-authority candidate">UNVERIFIED · CANDIDATE</strong> : null}
      {kind === "geometryCandidate" ? <strong className="workspace-canvas-authority candidate">AI DRAFT · UNVERIFIED · NOT OPTIMIZED</strong> : null}
      {kind === "structureVersion" || kind === "optimizedStructureVersion" || kind === "scientificScene" ? (
        <span className="workspace-authority-wrap" style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <strong className="workspace-canvas-authority committed" title="Saved · validated structure version with committed Cartesian coordinates">COMMITTED STRUCTURE VERSION</strong>
          <span className="authority-plain-caption" style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #5c7080)" }}>Saved and cannot be edited; changes create a new version</span>
        </span>
      ) : null}
      {kind === "optimizationTrajectory" ? <strong className="workspace-canvas-authority result">CALCULATED TRAJECTORY</strong> : null}
      {kind === "calculationResult" ? <strong className="workspace-canvas-authority result">ENGINE RESULT</strong> : null}
      {kind === "externalImport" || kind === "importedResult" ? <strong className="workspace-canvas-authority imported">IMPORTED · NOT A CHEMDFT ENGINE RESULT</strong> : null}
      {kind === "experimentalSpectrum" ? <strong className="workspace-canvas-authority experimental">EXPERIMENTAL DATA · RAW IS NEVER EDITED</strong> : null}
    </div>
    {kind === "calculation" || kind === "calculationResult" || kind === "optimizationTrajectory" ? <ResultContextHeader
      projectId={projectId}
      calculationId={kind === "calculation" ? id : sourceId!}
      resultId={kind === "calculationResult" ? id : undefined}
      onOpenResult={(resultId) => openSelection({ kind: "calculationResult", id: resultId, projectId, sourceId: id },
        catalog.find((item) => item.selection.kind === "calculationResult" && item.selection.id === resultId)?.label ?? `Result · ${label}`)} /> : null}
    {actionNotice ? <p role="status">{actionNotice}</p> : null}
    {error ? <p className="workspace-canvas-error" role="alert" data-testid="workspace-canvas-error">{error} Select another saved item from the tree, or <a href={`/${canvasLocale}/projects/${projectId}/results`}>open the Results overview</a>.</p> : null}
    {!resource && !error ? <p className="workspace-canvas-loading" role="status">Loading selected project item…</p> : null}
    {kind === "experimentalSpectrum" ? <ExperimentalSpectrumWorkspace
      projectId={projectId}
      datasetId={id}
      active={active}
      structures={workspaceStructures}
      onImport={() => window.dispatchEvent(new Event(OPEN_IMPORT_SPECTRUM_EVENT))}
    /> : null}
    {kind === "externalImport" || kind === "importedResult" ? <ImportedCalculationWorkspace
      projectId={projectId}
      importId={kind === "externalImport" ? id : sourceId!}
      initialResultId={kind === "importedResult" ? id : undefined}
      active={active}
    /> : null}
    {resource?.file ? <div className="workspace-object-meta"><strong>Original source file</strong><span>{resource.file.media_type}</span><span>{resource.file.size_bytes} bytes</span><span>SHA-256 {resource.file.sha256}</span></div> : null}
    {resource?.candidate ? <div className="workspace-candidate-meta"><strong>Source figure candidate</strong><span>{resource.candidate.candidate_state} · {resource.candidate.provenance_class}</span>
      <span>{resource.candidate.candidate_state === "PROMOTED" ? "A researcher promoted this candidate; the promoted structure version is the saved structure." : "Human promotion is required before this becomes a saved structure version."}</span></div> : null}
    {resource?.geometryCandidate ? <GeometryCandidateWorkspace projectId={projectId}
      candidate={resource.geometryCandidate} drawingMol={resource.drawingMol ?? null}
      onAccepted={() => setReloadTick((tick) => tick + 1)} /> : null}
    {resource?.preview && !activeRecognitionView ? <CandidatePreviewPanel scene={resource.preview} /> : null}
    {resource?.candidate && !resource.preview && !activeRecognitionView ? (
      <div
        className="candidate-recognition-launcher"
        data-testid="candidate-recognition-launcher"
        style={{
          display: "grid",
          gap: 16,
          padding: 16,
          background: "var(--bp-surface-subtle, #f9fafb)",
          border: "1px solid #c5cbd3",
          borderRadius: 6,
          margin: "12px 0",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.05rem" }}>
              {resource.candidate.source_anchor?.figure_number
                ? `Figure ${resource.candidate.source_anchor.figure_number}`
                : "Figure Candidate"} · Page {resource.candidate.source_page ?? 1}
            </h3>
            <span style={{ fontSize: "0.85rem", color: "#5c7080" }}>
              Source: <em>{resource.document?.title ?? "Document"}</em> · State: {resource.candidate.candidate_state}
            </span>
          </div>
          <StatusTag intent="none">UNVERIFIED · CANDIDATE</StatusTag>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          <div
            data-testid="original-figure-container"
            style={{
              background: "#ffffff",
              border: "1px solid #d8dde6",
              borderRadius: 4,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <strong style={{ fontSize: "0.85rem", alignSelf: "flex-start", marginBottom: 8 }}>Original PDF Figure Crop</strong>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getCandidateFigureUrl(projectId, resource.candidate.id)}
              alt={`Figure from page ${resource.candidate.source_page ?? 1}`}
              data-testid="original-figure-image"
              style={{
                maxWidth: "100%",
                maxHeight: 260,
                objectFit: "contain",
                border: "1px solid #e1e8ed",
                borderRadius: 3,
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 12,
              padding: 16,
              background: "#ffffff",
              border: "1px solid #d8dde6",
              borderRadius: 4,
            }}
          >
            <div>
              <h4 style={{ margin: "0 0 6px 0", fontSize: "0.95rem" }}>Molecular Recognition (DECIMER)</h4>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "#5c7080" }}>
                Run optical chemical structure recognition (OCSR) using isolated DECIMER 2.8.0 engine. Inference generates an unverified molecular graph proposal.
              </p>
            </div>

            <button
              type="button"
              data-testid="recognize-figure-button"
              disabled={recognizingCandidateId === resource.candidate.id}
              onClick={() => void handleRecognizeCandidate(resource.candidate!.id)}
              style={{
                background: recognizingCandidateId === resource.candidate.id ? "#8a9ba8" : "#106ba3",
                color: "#ffffff",
                border: "none",
                padding: "8px 16px",
                borderRadius: 4,
                fontWeight: 600,
                cursor: recognizingCandidateId === resource.candidate.id ? "not-allowed" : "pointer",
                alignSelf: "flex-start",
              }}
            >
              {recognizingCandidateId === resource.candidate.id ? "Running DECIMER Recognition…" : "Run Molecular Recognition"}
            </button>

            {recognizingCandidateId === resource.candidate.id && (
              <div
                data-testid="recognition-progress"
                style={{
                  padding: 10,
                  background: "#e1f5fe",
                  border: "1px solid #b3e5fc",
                  borderRadius: 4,
                  color: "#0277bd",
                  fontSize: "0.85rem",
                }}
              >
                Running DECIMER recognition in isolated worker process (approx. 45s on CPU)...
              </div>
            )}

            {recognitionError && (
              <div data-testid="recognition-error" className="workspace-canvas-error" role="alert" style={{ margin: 0 }}>
                {recognitionError}
              </div>
            )}
          </div>
        </div>
      </div>
    ) : null}
    {resource?.candidate && activeRecognitionView ? (
      <>
      <CandidateFigureRecognitionPanel
        candidate={activeRecognitionView}
        onReview={() => void handleReviewCandidate(resource.candidate!.id)}
        onReject={() => void handleRejectCandidate(resource.candidate!.id)}
      />
      <MolecularCorrectionWorkbench
        key={resource.candidate.id}
        projectId={projectId}
        candidate={resource.candidate}
        expectedRepresentationId={kind === "candidateRepresentation" ? id : undefined}
        onChanged={() => window.dispatchEvent(new Event("chemdft:workspace-items-changed"))}
      />
      </>
    ) : null}
    {resource?.document ? <div className="workspace-document-canvas">
      {/* Extracted Chemical Figures Strip */}
      <section
        className="document-figures-section"
        data-testid="document-figures-section"
        style={{
          marginBottom: 16,
          padding: 12,
          background: "var(--bp-surface-subtle, #f9fafb)",
          border: "1px solid #c5cbd3",
          borderRadius: 6,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>
              Extracted Chemical Figures ({visibleFigures.length})
            </h3>
            <span style={{ fontSize: "0.8rem", color: "#5c7080" }}>
              Extract diagrams from PDF pages to inspect and propose chemical structures.
            </span>
          </div>
          <button
            type="button"
            className="extract-figures-button"
            data-testid="extract-figures-button"
            disabled={extractingFigures}
            onClick={() => void handleExtractFigures()}
            style={{
              background: extractingFigures ? "#8a9ba8" : "#2b6cb0",
              color: "#ffffff",
              border: "none",
              padding: "6px 14px",
              borderRadius: 4,
              fontSize: "0.85rem",
              fontWeight: 500,
              cursor: extractingFigures ? "not-allowed" : "pointer",
            }}
          >
            {extractingFigures ? "Extracting figures…" : "Extract Figures from PDF"}
          </button>
        </div>

        {extractingFigures && (
          <p data-testid="extracting-figures-indicator" style={{ fontSize: "0.85rem", color: "#106ba3", margin: "4px 0" }}>
            Extracting figures from PDF content stream…
          </p>
        )}

        {extractionError && (
          <p className="workspace-canvas-error" data-testid="figure-extraction-error" role="alert">
            {extractionError}
          </p>
        )}

        {visibleFigures.length > 0 ? (
          <div
            className="extracted-figures-strip"
            data-testid="extracted-figures-strip"
            style={{ display: "flex", gap: 12, overflowX: "auto", padding: "6px 2px" }}
          >
            {visibleFigures.map((fig) => (
              <button
                type="button"
                key={fig.id}
                className="figure-thumbnail-button"
                data-testid="figure-thumbnail-button"
                onClick={() =>
                  openSelection(
                    { kind: "structureCandidate", id: fig.id, projectId },
                    fig.source_anchor?.figure_number
                      ? `Candidate · Fig. ${fig.source_anchor.figure_number}`
                      : `Candidate · p. ${fig.source_page ?? 1}`,
                  )
                }
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  background: "#ffffff",
                  border: "1px solid #c5cbd3",
                  borderRadius: 4,
                  padding: 6,
                  cursor: "pointer",
                  minWidth: 80,
                  maxWidth: 120,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getCandidateFigureUrl(projectId, fig.id)}
                  alt={`Figure on page ${fig.source_page ?? 1}`}
                  data-testid="figure-thumbnail"
                  style={{ width: 72, height: 72, objectFit: "contain", border: "1px solid #e1e8ed", borderRadius: 3 }}
                />
                <span style={{ fontSize: "0.75rem", marginTop: 4, fontWeight: 500, color: "#1c2127", textAlign: "center" }}>
                  {fig.source_anchor?.figure_number ? `Fig. ${fig.source_anchor.figure_number}` : `p. ${fig.source_page ?? 1}`}
                </span>
              </button>
            ))}
          </div>
        ) : (
          !extractingFigures && (
            <p style={{ fontSize: "0.8rem", color: "#5c7080", margin: "4px 0" }}>
              No figures extracted yet. Click &quot;Extract Figures from PDF&quot; to detect diagrams.
            </p>
          )
        )}
      </section>
      {resource.evidence ? <p className="workspace-source-location">{resource.evidence.evidence_type.replaceAll("_", " ")} · {resource.evidence.source_class} · page {resource.evidence.source_anchor?.page_number ?? "—"}</p> : null}
      {selection.locator?.anchorId && !resource.evidence ? <p className="workspace-source-location">Cited passage · page {selection.locator.page ?? "—"}. Exact region is not available from this source.</p> : null}
      {resource.document.media_type === "application/pdf" ? <PdfSourceViewer
        projectId={projectId} document={resource.document} candidate={resource.evidence ?? null}
        requestedPage={selection.locator?.page ?? resource.evidence?.source_anchor?.page_number ?? null}
        onDigitizerPoint={() => undefined} onPageChange={pageChanged}
        digitizerDraft={xrdSourceSession && xrdSourceSession.source_document_id === resource.document.id
          && xrdSourceSession.source_evidence_id === resource.evidence?.id ? {
          sourceFrame: {
            page: xrdSourceSession.page_number,
            pixelWidth: xrdSourceSession.source_pixel_width,
            pixelHeight: xrdSourceSession.source_pixel_height,
            cssWidth: 0,
            cssHeight: 0,
            scale: xrdSourceSession.source_render_scale,
            renderSha256: xrdSourceSession.source_render_sha256,
            renderVersion: xrdSourceSession.source_render_version,
          },
          regionStart: null,
          region: xrdSourceSession.plot_region,
          xPixelA: xrdSourceSession.x_calibration.pixel_a,
          xPixelB: xrdSourceSession.x_calibration.pixel_b,
          yPixelA: xrdSourceSession.y_calibration?.pixel_a ?? null,
          yPixelB: xrdSourceSession.y_calibration?.pixel_b ?? null,
          points: xrdSourceSession.points.map((point) => point.source_pixel),
          selectedPointIndex: xrdSourceSelectedPoint,
        } : { sourceFrame: null, regionStart: null, region: null, xPixelA: null, xPixelB: null, yPixelA: null, yPixelB: null, points: [] }}
        digitizerCaptureMode="off" digitizerPage={xrdSourceSession?.page_number ?? 6} onXrdSourceClick={() => undefined} onRenderFrame={() => undefined}
        canvasId="workspace-pdf-canvas" /> :
        <p className="workspace-canvas-empty">This document has no in-workspace viewer. Its source metadata remains available here.</p>}
    </div> : null}
    {resource?.version ? conformerSetup ? <ConformerSearchPanel key={`conformer:${projectId}:${resource.version.version.id}`} projectId={projectId} structure={resource.version}
      onBack={() => setConformerSetup(false)}
      onOpenResult={(detail) => { if (detail.result) openSelection({kind: "calculationResult", id: detail.result.id, sourceId: detail.calculation.id, projectId}, "CREST ensemble"); }}
      onOpenCalculation={(detail) => openSelection({kind: "calculation", id: detail.calculation.id, projectId}, "Conformer search")} /> : <StructureVersionWorkbench detail={resource.version} active={active} /> : null}
    {resource?.dataset ? <DatasetPreview dataset={resource.dataset} detailed /> : null}
    {resource?.calculation?.specification.task_type === "CONFORMER_SEARCH" && kind === "calculation" ? <ConformerRunStatus
      key={resource.calculation.calculation.id} projectId={projectId} detail={resource.calculation}
      onOpenResult={(detail) => { if (detail.result) openSelection({kind: "calculationResult", id: detail.result.id, sourceId: detail.calculation.id, projectId}, "CREST ensemble"); }} /> : null}
    {kind === "calculationResult" && result ? <ScientificStateStrip key={`state:${result.id}`} projectId={projectId} resultId={result.id} result={result} /> : null}
    {resource?.calculation && kind === "calculationResult" && result?.result_type === "chemdft.conformer-ensemble" ? <ConformerEnsembleExplorer
      active={active} projectId={projectId} calculationId={sourceId!} resultId={id} detail={resource.calculation} inputStructure={resource.inputVersion}
      onInspectInput={resource.inputVersion ? () => openSelection({kind: "structureVersion", id: resource.inputVersion!.version.id, sourceId: resource.inputVersion!.structure.id, projectId}, "Original input version") : undefined} /> : null}
    {resource?.calculation?.optimization_trajectory ? <OptimizationTrajectoryPanel key={resource.calculation.calculation.id} projectId={projectId} detail={resource.calculation} onOpenFinal={(version) => openSelection({ kind: "optimizedStructureVersion", id: version.version.id, projectId, sourceId: version.structure.id }, `${version.structure.name} · optimized V${version.version.revision}`)} /> : null}
    {kind === "calculationResult" && result?.result_type === "chemdft.vibrational-analysis"
      ? (result.payload as VibrationalAnalysis).raman_method ||
        (result.payload as VibrationalAnalysis).modes?.some((m) => m.raman_activity !== undefined && m.raman_activity !== null)
        ? <RamanSpectroscopyPanel
            projectId={projectId}
            calculationId={resource?.calculation?.calculation.id ?? sourceId ?? ""}
            resultId={result.id}
            result={result}
            active={active}
            structureName={structureName}
            initialSelectedMode={initialSelectedMode}
            onModeSelected={onModeSelected}
          />
        : <IrSpectroscopyPanel
            projectId={projectId}
            calculationId={resource?.calculation?.calculation.id ?? sourceId ?? ""}
            resultId={result.id}
            result={result}
            active={active}
            structureName={structureName}
            initialSelectedMode={initialSelectedMode}
            onModeSelected={onModeSelected}
          /> : null}
    {kind === "calculationResult" && result?.result_type === "chemdft.thermochemistry"
      ? <ThermochemistryAdvancedPanel result={result} /> : null}
    {kind === "calculationResult" && result?.result_type === "chemdft.tddft"
      ? <UvVisSpectroscopyPanel
          projectId={projectId}
          calculationId={resource?.calculation?.calculation.id ?? sourceId ?? ""}
          resultId={result.id}
          result={result.payload as TddftResult}
          active={active}
          structureName={structureName}
          initialSelectedState={initialSelectedState}
          onStateSelected={onStateSelected}
        /> : null}
    {kind === "calculationResult" && result?.result_type === "chemdft.molecular-orbitals" && "orbitals" in result.payload
      ? <MolecularOrbitalWorkspace active={active} projectId={projectId} calculationId={resource?.calculation?.calculation.id ?? sourceId ?? ""} resultId={result.id} result={result.payload as MolecularOrbitalAnalysis} /> : null}
    {resource?.calculation && result?.result_type === "chemdft.dispersion-corrected-energy" ? <Dftd4ResultView key={result.id} projectId={projectId} initial={resource.calculation} /> : null}
    {result?.result_type === "chemdft.energy" ? <Dftd4CorrectionControl key={`dftd4:${result.id}`} projectId={projectId} source={result} /> : null}
    {resource?.calculation && result?.result_type === "chemdft.energy" ? <CalculationScientificSummary key={`summary:${result.id}`} projectId={projectId} detail={resource.calculation} input={resource.inputVersion} /> : null}
    {resource?.calculation && energy && (result?.result_type === "chemdft.energy" || kind === "calculationResult" || kind === "calculation") ? (
      <div style={{ marginBottom: "20px" }}>
        <EnergyPrecisionPlate
          projectId={projectId}
          calculationId={resource.calculation.calculation.id}
          resultId={result?.id}
          calculationState={resource.calculation.calculation.state}
          method={resource.calculation.specification.method.identifier}
          basis={resource.calculation.specification.basis?.identifier ?? null}
          engineName={result?.producer_software.name ?? resource.calculation.specification.engine_preference?.engine ?? "xtb"}
          engineVersion={result?.producer_software.version ?? ""}
          energyValue={energy.value}
          energyUnit={energy.unit.code}
          converged={result?.payload && "converged" in result.payload && typeof result.payload.converged === "boolean" ? result.payload.converged : undefined}
          scfIterations={result?.payload && "scf_iterations" in result.payload ? Number((result.payload as unknown as Record<string, unknown>).scf_iterations) : null}
          inputHash={resource.calculation.calculation_input_hash}
          sourceClass={result?.source_class ?? "CALCULATED"}
          validationState={result?.validation_state ?? "VALIDATED"}
          authority={result?.authority}
          verificationState={result?.verification_state}
          effectiveState={result?.effective_state}
          structureName={resource.inputVersion ? compactStructureTitle(resource.inputVersion.structure.name, resource.inputVersion.version.revision) : undefined}
          rawPayload={(result?.payload as unknown as Record<string, unknown>) ?? null}
          structureId={resource.inputVersion?.structure.id}
          structureVersionId={resource.inputVersion?.version.id}
          provenanceRecordId={result?.provenance_record_id}
          onInspectStructure={resource.inputVersion ? () => openSelection({ kind: "structureVersion", id: resource.inputVersion!.version.id, sourceId: resource.inputVersion!.structure.id, projectId }, compactStructureTitle(resource.inputVersion!.structure.name, resource.inputVersion!.version.revision)) : undefined}
          onPlanNextStep={() => window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist"))}
        />
      </div>
    ) : null}
    {resource?.calculation && resource.calculation.specification.task_type !== "CONFORMER_SEARCH" && (kind === "calculation" || (result?.result_type !== "chemdft.molecular-orbitals" && result?.result_type !== "chemdft.tddft" && result?.result_type !== "chemdft.thermochemistry" && result?.result_type !== "chemdft.vibrational-analysis" && result?.result_type !== "chemdft.dispersion-corrected-energy")) ? <div className="workspace-calculation-summary" data-testid="workspace-calculation-summary"><h2>{resource.calculation.specification.task_type.replaceAll("_", " ")}</h2>
      <dl><div><dt>Status</dt><dd>{resource.calculation.calculation.state}</dd></div>
      {resource.calculation.calculation.state === "FAILED" ? <div><dt>Failure</dt><dd data-testid="workspace-calculation-failure">{resource.calculation.attempt?.diagnostic ?? resource.calculation.compute_execution?.diagnostic ?? resource.calculation.attempt?.failure_code ?? "No publishable result; no failure detail was recorded."}</dd></div> : null}
      {!result && !["SUCCEEDED", "FAILED", "CANCELED"].includes(resource.calculation.calculation.state) ? <div><dt>Result</dt><dd role="status">Not published yet — this view refreshes while the job runs. Nothing is shown until the engine output is validated.</dd></div> : null}
      {!result && resource.calculation.calculation.state === "SUCCEEDED" ? <div><dt>Result</dt><dd>No published result is attached to this calculation.</dd></div> : null}
      <div><dt>Method</dt><dd>{resource.calculation.specification.method.display_name}</dd></div>
      <div><dt>Basis</dt><dd>{resource.calculation.specification.basis?.display_name ?? "None"}</dd></div>
      <div><dt>Input hash</dt><dd>{resource.calculation.calculation_input_hash}</dd></div></dl>
      {result ? <div className="workspace-result-summary"><strong>{result.result_type.replaceAll("_", " ")}</strong>
        {energy ? <p>{energy.value} {energy.unit.code}</p> : resource.calculation.optimization_trajectory ? <p>Engine trajectory and final geometry available above.</p> : kind === "calculation" ? <p>Open the result to see its scientific viewer.</p> : result.result_type === "chemdft.vibrational-analysis" || result.result_type === "chemdft.tddft" ? null : <p>This result has no supported numeric canvas renderer.</p>}
        <span>Produced by {result.producer_software.name} {result.producer_software.version} · {result.source_class ?? "CALCULATED"}</span>
        {kind === "calculation" ? <button type="button" data-testid="workspace-open-result-tab" onClick={() => openSelection({ kind: "calculationResult", id: result.id, projectId, sourceId: resource.calculation!.calculation.id }, `Result · ${result.result_type.replace(/^chemdft\./, "")}`)}>Open result</button> : null}
      </div> : null}</div> : null}
    {resource?.note ? <div className="workspace-note-content"><strong>Confirmed project note</strong><p>{resource.note.content}</p><span>Saved {formatDate(resource.note.created_at)}</span></div> : null}
    {kind === "historyEvent" && history ? <div className="workspace-history-detail"><strong>{history.label}</strong>
      <p>{history.detail}</p><span>{history.occurredAt ? formatDate(history.occurredAt) : "Recorded in project history"}</span>
      {history.linkedSelection ? <button type="button" onClick={() => openSelection(history.linkedSelection!, "Linked project item")}>Open linked item</button> : null}</div> : null}
  </section>;
}

function EmptyStructureState({ title, hasDocuments, onImport, onCreate }: { title: string; hasDocuments: boolean; onImport: () => void; onCreate: () => void }) {
  return (
    <div className="structure-empty-state">
      <AppIcon icon="cube" />
      <h2>{title}</h2>
      <p>{hasDocuments ? "This project contains scientific documents, but no saved atomic coordinates are available for 3D visualization or calculation. Reported or hypothetical structure figures remain evidence, not validated structures." : "Import a real SDF, MOL, XYZ, or CIF file, or choose to draw a molecule. No molecule, crystal, coordinate, lattice, version, provenance, or diagnostic data is simulated here."}</p>
      <div className="phase7-actions">
        <ActionButton small icon="upload" text="Import structure file" onClick={onImport} />
        <ActionButton small icon="edit" text="Create molecule" onClick={onCreate} />
        {hasDocuments ? <a href="#phase7-evidence">Inspect detected structure evidence</a> : null}
      </div>
    </div>
  );
}

function PeriodicCellPanel({ cell }: { cell: PeriodicCell }) {
  const vectors = cell.lattice_vectors as [unknown, unknown, unknown];
  return (
    <>
      <dl className="cell-summary">
        <div><dt>a</dt><dd>{formatNumber(cell.a)} Å</dd></div>
        <div><dt>b</dt><dd>{formatNumber(cell.b)} Å</dd></div>
        <div><dt>c</dt><dd>{formatNumber(cell.c)} Å</dd></div>
        <div><dt>α</dt><dd>{formatNumber(cell.alpha)}°</dd></div>
        <div><dt>β</dt><dd>{formatNumber(cell.beta)}°</dd></div>
        <div><dt>γ</dt><dd>{formatNumber(cell.gamma)}°</dd></div>
      </dl>
      <StructureTable
        title="Lattice vectors"
        headers={["Vector", "x", "y", "z"]}
        rows={vectors.map((vector, index) => {
          const values = Array.isArray(vector) ? vector : [];
          return [`v${index + 1}`, formatNumber(Number(values[0])), formatNumber(Number(values[1])), formatNumber(Number(values[2]))];
        })}
        emptyText="No lattice vectors are present in this version."
      />
    </>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: NonNullable<VersionDetail["diagnostics"]> }) {
  return (
    <div className="diagnostic-list" aria-label="Diagnostics" data-empty={diagnostics.length === 0 || undefined}>
      <strong>Diagnostics</strong>
      {diagnostics.length === 0 ? <span>No parser diagnostics were reported for this version.</span> : diagnostics.map((diagnostic) => (
        <span key={`${diagnostic.severity}:${diagnostic.code}:${diagnostic.message}`}>
          <AppIcon icon={diagnostic.severity === "ERROR" ? "error" : diagnostic.severity === "WARNING" ? "warning-sign" : "info-sign"} />
          {diagnostic.severity} · {diagnostic.code}: {diagnostic.message}
        </span>
      ))}
    </div>
  );
}

function ProvenancePanel({ detail }: { detail: VersionDetail }) {
  const provenance = detail.provenance;
  const sourceArtifact = provenance?.source_artifact;
  return (
    <>
      <h2>Provenance</h2>
      <dl className="provenance-list">
        <div><dt>Origin</dt><dd>{detail.version.origin}</dd></div>
        <div><dt>Authority</dt><dd>{detail.version.origin === "RECONSTRUCTED" && provenance?.detail === "MANUAL_ENTRY" ? "User reviewed reconstruction" : provenance?.source_class ?? "Not established"}</dd></div>
        {detail.version.origin === "RECONSTRUCTED" && provenance?.source_class ? <div><dt>Source class</dt><dd>{provenance.source_class} · Figure 2 evidence</dd></div> : null}
        {provenance?.coordinate_origin ? <div><dt>Coordinate source</dt><dd>{provenance.coordinate_origin}{provenance.coordinate_input_format ? ` · ${provenance.coordinate_input_format}` : ""}{provenance.coordinate_unit ? ` · ${provenance.coordinate_unit}` : ""}</dd></div> : null}
        {provenance?.coordinate_file_sha256 ? <div><dt>Coordinate file SHA-256</dt><dd>{provenance.coordinate_file_sha256}</dd></div> : null}
        <div><dt>Verification</dt><dd>{detail.version.origin === "RECONSTRUCTED" && provenance?.verification_state === "VERIFIED" ? "USER REVIEWED (VERIFIED)" : provenance?.verification_state === "UNVERIFIED" ? "NOT REVIEWED" : provenance?.verification_state ?? "Not reviewed"}</dd></div>
        <div><dt>Source artifact</dt><dd>{sourceArtifact ? `${shortId(sourceArtifact.artifact_id)} · ${sourceArtifact.sha256.slice(0, 12)}` : "Not exposed"}</dd></div>
        <div><dt>Parser</dt><dd>{provenance?.parser ? `${provenance.parser} ${provenance.parser_version ?? ""}` : "Not applicable"}</dd></div>
        <div><dt>Adapter</dt><dd>{provenance?.adapter ? `${provenance.adapter} ${provenance.adapter_version ?? ""}` : "Not applicable"}</dd></div>
        <div><dt>Operation</dt><dd>{provenance?.operation ?? "Not recorded"}</dd></div>
        {provenance?.geometry_candidate_id ? <div><dt>Geometry candidate</dt><dd>{provenance.geometry_candidate_id}</dd></div> : null}
        {provenance?.generation_method ? <div><dt>Generation method</dt><dd>{provenance.generation_method}</dd></div> : null}
        {provenance?.geometry_class ? <div><dt>Geometry class</dt><dd>{provenance.geometry_class}</dd></div> : null}
        {provenance?.candidate_sha256 ? <div><dt>Candidate SHA-256</dt><dd>{provenance.candidate_sha256}</dd></div> : null}
        {detail.version.parent_version_id ? <div><dt>Parent version</dt><dd>{detail.version.parent_version_id}</dd></div> : null}
        {provenance?.calculation_id ? <div><dt>Calculation</dt><dd>{provenance.calculation_id}</dd></div> : null}
        {provenance?.trajectory_id ? <div><dt>Trajectory</dt><dd>{provenance.trajectory_id}</dd></div> : null}
        {provenance?.final_step_index != null ? <div><dt>Final step</dt><dd>{provenance.final_step_index + 1}</dd></div> : null}
        <div><dt>Timestamp</dt><dd>{formatDate(provenance?.created_at ?? detail.version.created_at)}</dd></div>
        <div><dt>Actor</dt><dd>{provenance?.source_class === "CALCULATED" ? "PySCF scientific worker" : provenance?.actor_id ? shortId(provenance.actor_id) : shortId(detail.version.created_by)}</dd></div>
        <div><dt>Storage</dt><dd>No filesystem or bucket key is exposed to the browser</dd></div>
      </dl>
    </>
  );
}

function StructureTable({
  title,
  headers,
  rows,
  emptyText,
  selectedRowKey,
  onRowClick,
}: {
  title: string;
  headers: string[];
  rows: string[][];
  emptyText: string;
  selectedRowKey?: string | null;
  onRowClick?: (row: string[]) => void;
}) {
  return (
    <div className="structure-table-wrap">
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="table-empty">{emptyText}</p> : (
        <div className="structure-table-scroll" tabIndex={0} role="region" aria-label={`${title} table`}><table className="structure-table">
          <thead>
            <tr>
              {headers.map((header) => <th scope="col" key={header}>{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.join(":")}
                data-selected={selectedRowKey === row[0] ? "true" : undefined}
                data-clickable={onRowClick ? "true" : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {row.map((cell, index) => <td key={`${index}:${cell}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

function VisualizationInspector({
  scene,
  selectedAtomIndex,
}: {
  scene: ScientificScene | null;
  selectedAtomIndex: number | null;
}) {
  const atom = selectedAtomIndex == null ? null : scene?.atoms.find((item) => item.index === selectedAtomIndex);
  return (
    <>
      <h2>Visualization selection</h2>
      <dl className="provenance-list">
        <div><dt>Scene</dt><dd>{scene ? scene.id : "Not built"}</dd></div>
        <div><dt>Selection</dt><dd>{atom ? `Atom ${atom.index} · ${atom.element}` : "None"}</dd></div>
        <div><dt>Coordinates</dt><dd>{atom ? `${formatNumber(atom.position[0])}, ${formatNumber(atom.position[1])}, ${formatNumber(atom.position[2])} Å` : "No atom selected"}</dd></div>
        <div><dt>Source coordinates</dt><dd>{atom ? `${atom.sourceCoordinateSystem} · ${formatNumber(atom.sourcePosition[0])}, ${formatNumber(atom.sourcePosition[1])}, ${formatNumber(atom.sourcePosition[2])}` : "No atom selected"}</dd></div>
        <div><dt>Occupancy</dt><dd>{atom?.occupancy == null ? "Not specified" : formatNumber(atom.occupancy)}</dd></div>
      </dl>
    </>
  );
}

function atomRows(atoms: Atom[], periodic: boolean): string[][] {
  return atoms.map((atom) => periodic
    ? [
      String(atom.index),
      atom.element,
      approvalCoordinate(atom.x),
      approvalCoordinate(atom.y),
      approvalCoordinate(atom.z),
      atom.occupancy == null ? "1" : formatNumber(atom.occupancy),
    ]
    : [
      String(atom.index),
      atom.element,
      String(atom.atomic_number),
      approvalCoordinate(atom.x),
      approvalCoordinate(atom.y),
      approvalCoordinate(atom.z),
    ]);
}

function bondRows(bonds: Bond[]): string[][] {
  return bonds.map((bond) => [
    String(bond.atom_index_a),
    String(bond.atom_index_b),
    bond.order == null ? "1" : formatNumber(bond.order),
  ]);
}

function Phase7EvidencePanel({
  projectId,
  documents,
  datasets,
  onPromoted,
  onImport,
}: {
  projectId: string;
  documents: ScientificDocument[];
  datasets: ExperimentalDatasetView[];
  onPromoted: (output: StructureCandidatePromotionOutput) => Promise<void>;
  onImport?: () => void;
}) {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<EvidenceCandidate[]>([]);
  const [structureCandidates, setStructureCandidates] = useState<StructureCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [citationPage, setCitationPage] = useState<number | null>(null);
  const [citationNavigation, setCitationNavigation] = useState(false);
  const [documentOpenError, setDocumentOpenError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [digitizedDataset, setDigitizedDataset] = useState<ExperimentalDatasetView | null>(null);
  const [digitizerPoint, setDigitizerPoint] = useState<DigitizerPoint | null>(null);
  const [xrdDraft, setXrdDraft] = useState<XrdDigitizerDraft>({
    sourceFrame: null, regionStart: null, region: null,
    xPixelA: null, xPixelB: null, yPixelA: null, yPixelB: null, points: [],
  });
  const [xrdCaptureMode, setXrdCaptureMode] = useState<XrdDigitizerCaptureMode>("off");
  const [activeGroup, setActiveGroup] = useState("all");
  const [showRawEvidence, setShowRawEvidence] = useState(false);
  const activeDocumentId = selectedDocumentId ?? documents[0]?.id ?? null;
  useEffect(() => {
    let active = true;
    void listStructureCandidates(projectId)
      .then((output) => { if (active) setStructureCandidates([...(output.candidates ?? [])]); })
      .catch(() => { if (active) setStructureCandidates([]); });
    return () => { active = false; };
  }, [projectId, documents.length]);
  useEffect(() => {
    if (!activeDocumentId) {
      queueMicrotask(() => setCandidates([]));
      return;
    }
    void getDocument(projectId, activeDocumentId).then((output) => {
      const loaded = output.candidates ?? [];
      setCandidates(loaded);
    }).catch((error: unknown) => setDocumentOpenError(error instanceof Error ? error.message : "Unable to open document."));
  }, [projectId, activeDocumentId]);
  useEffect(() => {
    function selectImportedDocument(event: Event) {
      const documentId = (event as CustomEvent<string>).detail;
      setSelectedDocumentId(documentId);
      setSelectedCandidateId(null);
      setCitationNavigation(false);
      setCitationPage(null);
      setSearch("");
      setActiveGroup("all");
      setShowRawEvidence(false);
    }
    window.addEventListener("chemdft:document-imported", selectImportedDocument);
    return () => window.removeEventListener("chemdft:document-imported", selectImportedDocument);
  }, []);
  useEffect(() => {
    function openCitation(event: Event) {
      const citation = (event as CustomEvent<AICitation>).detail;
      if (citation.citation_type !== "DOCUMENT") return;
      setSelectedDocumentId(citation.entity_id);
      setSelectedCandidateId(null);
      setCitationPage(citation.page_number ?? null);
      setCitationNavigation(true);
      setDocumentOpenError(null);
      setSearch("");
      setActiveGroup("all");
      setShowRawEvidence(false);
      void getDocument(projectId, citation.entity_id).then((output) => {
        const loaded = output.candidates ?? [];
        setCandidates(loaded);
      }).catch((error: unknown) => setDocumentOpenError(error instanceof Error ? error.message : "Unable to open cited document."));
    }
    window.addEventListener("chemdft:citation-click", openCitation);
    return () => window.removeEventListener("chemdft:citation-click", openCitation);
  }, [projectId]);
  const selectedDocument = documents.find((item) => item.id === activeDocumentId) ?? null;
  const displayedDatasets = Array.from(
    new Map(
      [digitizedDataset, ...datasets]
        .filter((dataset): dataset is ExperimentalDatasetView => dataset !== null)
        .map((dataset) => [dataset.id, dataset]),
    ).values(),
  );
  const searchedCandidates = search.trim()
    ? candidates.filter((candidate) => JSON.stringify(candidate).toLowerCase().includes(search.trim().toLowerCase()))
    : candidates;
  const groups = groupEvidence(searchedCandidates);
  const filteredCandidates = showRawEvidence || activeGroup === "all"
    ? searchedCandidates
    : groups.find((group) => group.id === activeGroup)?.candidates ?? [];
  const visibleRows = showRawEvidence
    ? filteredCandidates.map((candidate) => ({
      key: `raw:${candidate.id}`, label: evidenceTitle(candidate), candidates: [candidate], primary: candidate,
      figureNumber: null, modality: "other" as const,
    }))
    : canonicalEvidenceRows(filteredCandidates);
  const selectedCandidate = citationNavigation ? null :
    visibleRows.find((row) => row.candidates.some((item) => item.id === selectedCandidateId))?.primary
      ?? visibleRows[0]?.primary ?? null;
  const selectedEvidenceRow = visibleRows.find((row) => row.candidates.some((item) => item.id === selectedCandidate?.id)) ?? null;
  const digitizerPage = selectedEvidenceRow?.modality === "dls" && selectedEvidenceRow.figureNumber === "4" ? 7 : 6;
  function selectCandidate(candidate: EvidenceCandidate) {
    setCitationNavigation(false);
    setCitationPage(null);
    setSelectedCandidateId(candidate.id);
    setDigitizerPoint(null);
    setXrdCaptureMode("off");
    setXrdDraft({ sourceFrame: null, regionStart: null, region: null,
      xPixelA: null, xPixelB: null, yPixelA: null, yPixelB: null, points: [] });
    window.setTimeout(() => globalThis.document.getElementById("phase7-pdf-canvas")?.scrollIntoView({ block: "center", inline: "nearest" }), 0);
  }
  function handleXrdSourceClick(point: DigitizerPoint) {
    if (xrdCaptureMode === "off" || xrdDraft.sourceFrame?.page !== digitizerPage) return;
    if (!["region-first", "region-second"].includes(xrdCaptureMode)
      && (!xrdDraft.region || point.x < xrdDraft.region.x || point.x > xrdDraft.region.x + xrdDraft.region.width
        || point.y < xrdDraft.region.y || point.y > xrdDraft.region.y + xrdDraft.region.height)) return;
    if (xrdCaptureMode === "region-first") {
      setXrdDraft((current) => ({ ...current, regionStart: point, region: null }));
      setXrdCaptureMode("region-second");
    } else if (xrdCaptureMode === "region-second") {
      setXrdDraft((current) => {
        const start = current.regionStart;
        if (!start) return current;
        return { ...current, region: {
          x: Math.min(start.x, point.x), y: Math.min(start.y, point.y),
          width: Math.abs(start.x - point.x), height: Math.abs(start.y - point.y),
        } };
      });
      setXrdCaptureMode("off");
    } else if (xrdCaptureMode === "x-tick-a") {
      setXrdDraft((current) => ({ ...current, xPixelA: point }));
      setXrdCaptureMode("off");
    } else if (xrdCaptureMode === "x-tick-b") {
      setXrdDraft((current) => ({ ...current, xPixelB: point }));
      setXrdCaptureMode("off");
    } else if (xrdCaptureMode === "y-tick-a") {
      setXrdDraft((current) => ({ ...current, yPixelA: point }));
      setXrdCaptureMode("off");
    } else if (xrdCaptureMode === "y-tick-b") {
      setXrdDraft((current) => ({ ...current, yPixelB: point }));
      setXrdCaptureMode("off");
    } else if (xrdCaptureMode === "peaks" || xrdCaptureMode === "curve") {
      setXrdDraft((current) => ({ ...current, points: [...current.points, point].slice(-2_000) }));
    }
  }
  const handleSourceFrame = useCallback((frame: SourceRenderFrame) => {
    setXrdDraft((current) => {
      const previous = current.sourceFrame;
      if (!previous || previous.page !== frame.page || previous.pixelWidth === frame.pixelWidth && previous.pixelHeight === frame.pixelHeight) {
        return { ...current, sourceFrame: frame };
      }
      const scalePoint = (point: DigitizerPoint | null) => point ? {
        x: point.x * frame.pixelWidth / previous.pixelWidth,
        y: point.y * frame.pixelHeight / previous.pixelHeight,
      } : null;
      const start = scalePoint(current.regionStart);
      const region = current.region ? {
        x: current.region.x * frame.pixelWidth / previous.pixelWidth,
        y: current.region.y * frame.pixelHeight / previous.pixelHeight,
        width: current.region.width * frame.pixelWidth / previous.pixelWidth,
        height: current.region.height * frame.pixelHeight / previous.pixelHeight,
      } : null;
      return { ...current, sourceFrame: frame, regionStart: start, region,
        xPixelA: scalePoint(current.xPixelA), xPixelB: scalePoint(current.xPixelB),
        yPixelA: scalePoint(current.yPixelA), yPixelB: scalePoint(current.yPixelB),
        points: current.points.map((point) => scalePoint(point)!),
      };
    });
  }, []);
  async function accept(candidate: EvidenceCandidate) {
    await reviewEvidence(projectId, candidate.id, { decision: "ACCEPTED" });
    setCandidates((current) => current.map((item) => item.id === candidate.id ? { ...item, review_state: "ACCEPTED" } : item));
  }
  async function reject(candidate: EvidenceCandidate) {
    await reviewEvidence(projectId, candidate.id, { decision: "REJECTED" });
    setCandidates((current) => current.map((item) => item.id === candidate.id ? { ...item, review_state: "REJECTED" } : item));
  }
  async function reviewStructure(item: StructureCandidate) {
    const output = await reviewStructureCandidate(projectId, item.id);
    setStructureCandidates((current) => current.map((entry) => entry.id === item.id ? output.candidate : entry));
    window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
  }
  async function rejectStructure(item: StructureCandidate) {
    const output = await rejectStructureCandidate(projectId, item.id);
    setStructureCandidates((current) => current.map((entry) => entry.id === item.id ? output.candidate : entry));
    window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
  }
  const selectedStructureCandidate = selectedCandidate
    ? structureCandidates.find((item) => item.source_evidence_id === selectedCandidate.id) ?? null
    : null;

  if (documents.length === 0 && displayedDatasets.length === 0) {
    return (
      <section className="phase7-panel phase7-panel--collapsed" aria-label="Experimental and document evidence" id="phase7-evidence" data-testid="phase7-evidence-collapsed">
        <div className="phase7-collapsed-row">
          <span className="phase7-collapsed-label">Documents and datasets: nothing yet.</span>
          {onImport ? (
            <button type="button" className="phase7-collapsed-import-btn" onClick={onImport} data-testid="phase7-import-btn">
              Import a paper or report
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="phase7-panel" aria-label="Experimental and document evidence" id="phase7-evidence">
      <div className="pane-heading"><div><h2>Documents &amp; experiments</h2><p>Evidence stays source-linked and distinct from raw experimental datasets.</p></div><StatusTag>{plural(documents.length, "document")} · {plural(displayedDatasets.length, "dataset")}</StatusTag></div>
      <div className="phase7-grid">
        <div><h3>Documents</h3>{documents.length === 0 ? <p className="table-empty">Import a scientific paper or report.</p> : documents.map((document) => <button type="button" className="phase7-row" data-selected={activeDocumentId === document.id ? "true" : undefined} key={document.id} onClick={() => { setSelectedDocumentId(document.id); setSelectedCandidateId(null); setSearch(""); setActiveGroup("all"); setShowRawEvidence(false); }}><strong>{document.title ?? "Untitled document"}</strong><span>{document.page_count} pages · {document.doi ?? "No DOI extracted"}</span></button>)}</div>
        <div><h3>Scientific datasets</h3>{displayedDatasets.length === 0 ? <p className="table-empty">No scientific datasets are saved.</p> : displayedDatasets.map((dataset) => <DatasetPreview key={dataset.id} dataset={dataset} />)}</div>
      </div>
      {activeDocumentId ? (
        <div className="phase7-evidence">
          <div className="phase7-evidence-toolbar">
            <div><h3>Detected findings</h3><p>{selectedDocument?.title ?? "Imported document"} · {candidates.length} evidence records · extracted records are not validated coordinates</p></div>
            <input aria-label="Search extracted document text" placeholder="Search extracted text" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
          </div>
          <div className="phase7-evidence-groups" aria-label="Scientific evidence groups">
            <button type="button" aria-pressed={!showRawEvidence && activeGroup === "all"} onClick={() => { setShowRawEvidence(false); setActiveGroup("all"); }}>All findings ({searchedCandidates.length} records)</button>
            {groups.map((group) => <button type="button" key={group.id} aria-pressed={!showRawEvidence && activeGroup === group.id} onClick={() => { setShowRawEvidence(false); setActiveGroup(group.id); }}>{group.label} ({canonicalEvidenceRows(group.candidates).length})</button>)}
            <button type="button" aria-pressed={showRawEvidence} onClick={() => setShowRawEvidence((value) => !value)}>{showRawEvidence ? "Grouped view" : "Advanced · raw records"}</button>
          </div>
          {documents.length > 0 ? <p className="phase7-import-summary"><strong>Document imported.</strong> Findings are extracted for review; the paper has not created a saved StructureVersion.</p> : null}
          {!showRawEvidence && activeGroup === "all" ? <div className="phase7-primary-actions">
            {groups.map((group) => <button type="button" key={group.id} onClick={() => { setActiveGroup(group.id); setShowRawEvidence(false); const candidate = group.candidates.find((item) => item.source_anchor?.source_type === "FIGURE") ?? group.candidates[0]; if (candidate) selectCandidate(candidate); }}>View {group.label}</button>)}
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist"))}>Ask AI</button>
          </div> : null}
          <div className="phase7-review-layout">
            <div className="phase7-review-list" aria-label="Evidence list">
              {visibleRows.length === 0 ? <p className="table-empty">No candidates detected.</p> : visibleRows.map((row) => (
                <button type="button" className="phase7-evidence-row" data-selected={selectedEvidenceRow?.key === row.key ? "true" : undefined} key={row.key} onClick={() => selectCandidate(row.primary)}>
                  <div><strong>{row.label}</strong><span>{row.figureNumber ? `${row.candidates.length} source records · ` : ""}{row.primary.source_class} · {row.primary.review_state} · page {row.primary.source_anchor?.page_number ?? "—"}</span></div>
                  <span>{row.figureNumber ? `Fig. ${row.figureNumber}` : row.primary.source_anchor?.source_type ?? "SOURCE"}</span>
                </button>
              ))}
            </div>
            <PdfSourceViewer
              projectId={projectId}
              document={selectedDocument!}
              candidate={selectedCandidate}
              requestedPage={citationPage}
              onDigitizerPoint={(point) => { if (xrdCaptureMode === "off") setDigitizerPoint(point); }}
              digitizerDraft={xrdDraft}
              digitizerCaptureMode={xrdCaptureMode}
              digitizerPage={digitizerPage}
              onXrdSourceClick={handleXrdSourceClick}
              onRenderFrame={handleSourceFrame}
            />
            <DocumentEvidenceInspector
              key={`${selectedDocument?.id ?? "none"}:${selectedCandidate?.id ?? "none"}`}
              projectId={projectId}
              document={selectedDocument}
              citationPage={citationPage}
              documentOpenError={documentOpenError}
              candidate={selectedCandidate}
              figureRecords={selectedEvidenceRow?.figureNumber ? selectedEvidenceRow.candidates : []}
              figureLabel={selectedEvidenceRow?.figureNumber ? selectedEvidenceRow.label : null}
              digitizerEligible={figureCanBeDigitized(selectedEvidenceRow)}
              digitizerPoint={digitizerPoint}
              xrdDigitizerEligible={selectedEvidenceRow?.modality === "xrd"
                && selectedEvidenceRow.figureNumber === "3"
                && selectedEvidenceRow.primary.source_anchor?.page_number === 6
                && selectedEvidenceRow.primary.source_anchor?.figure_number === "3"}
              dlsDigitizerEligible={selectedEvidenceRow?.modality === "dls"
                && selectedEvidenceRow.figureNumber === "4"
                && selectedEvidenceRow.primary.source_anchor?.page_number === 7
                && selectedEvidenceRow.primary.source_anchor?.figure_number === "4"}
              xrdDraft={xrdDraft}
              xrdCaptureMode={xrdCaptureMode}
              onXrdCaptureMode={setXrdCaptureMode}
              onXrdDraftChange={setXrdDraft}
              rawView={showRawEvidence}
              structureCandidate={selectedStructureCandidate}
              reportedCellEvidence={searchedCandidates.filter((item) => item.document_id === selectedCandidate?.document_id && item.evidence_type === "REPORTED_CELL_PARAMETER")}
              onAccept={accept}
              onReject={reject}
              onReviewStructure={reviewStructure}
              onRejectStructure={rejectStructure}
              onPromoted={onPromoted}
              onDigitized={setDigitizedDataset}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

type PdfViewport = { width: number; height: number };
type PdfRenderTask = { promise: Promise<void>; cancel?: () => void };
type PdfPageProxy = {
  getViewport: (input: { scale: number }) => PdfViewport;
  render: (input: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => PdfRenderTask;
};
type PdfDocumentProxy = { numPages: number; getPage: (page: number) => Promise<PdfPageProxy> };
type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  version: string;
  getDocument: (input: { url: string; disableJavaScript: boolean; isEvalSupported: boolean }) => { promise: Promise<PdfDocumentProxy> };
};
type EChartsInstance = { setOption: (option: unknown) => void; resize: () => void; dispose: () => void; on: (event: string, handler: (params: { data?: { pointIndex?: number } }) => void) => void; dispatchAction: (action: object) => void };
type EChartsModule = { init: (element: HTMLElement) => EChartsInstance };

function DocumentEvidenceInspector({
  projectId,
  document,
  citationPage,
  documentOpenError,
  candidate,
  figureRecords,
  figureLabel,
  digitizerEligible,
  digitizerPoint,
  xrdDigitizerEligible,
  dlsDigitizerEligible,
  xrdDraft,
  xrdCaptureMode,
  onXrdCaptureMode,
  onXrdDraftChange,
  rawView,
  structureCandidate,
  reportedCellEvidence,
  onAccept,
  onReject,
  onReviewStructure,
  onRejectStructure,
  onPromoted,
  onDigitized,
}: {
  projectId: string;
  document: ScientificDocument | null;
  citationPage: number | null;
  documentOpenError: string | null;
  candidate: EvidenceCandidate | null;
  figureRecords: EvidenceCandidate[];
  figureLabel: string | null;
  digitizerEligible: boolean;
  digitizerPoint: DigitizerPoint | null;
  xrdDigitizerEligible: boolean;
  dlsDigitizerEligible: boolean;
  xrdDraft: XrdDigitizerDraft;
  xrdCaptureMode: XrdDigitizerCaptureMode;
  onXrdCaptureMode: (mode: XrdDigitizerCaptureMode) => void;
  onXrdDraftChange: (draft: XrdDigitizerDraft) => void;
  rawView: boolean;
  structureCandidate: StructureCandidate | null;
  reportedCellEvidence: EvidenceCandidate[];
  onAccept: (candidate: EvidenceCandidate) => Promise<void>;
  onReject: (candidate: EvidenceCandidate) => Promise<void>;
  onReviewStructure: (candidate: StructureCandidate) => Promise<void>;
  onRejectStructure: (candidate: StructureCandidate) => Promise<void>;
  onPromoted: (output: StructureCandidatePromotionOutput) => Promise<void>;
  onDigitized: (dataset: ExperimentalDatasetView) => void;
}) {
  const [representations, setRepresentations] = useState<CandidateRepresentationView[]>([]);
  const [preview, setPreview] = useState<PreviewScene | null>(null);
  const [editingDraft, setEditingDraft] = useState<"ketcher" | null>(null);
  const [representationMessage, setRepresentationMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coordinateUnit, setCoordinateUnit] = useState<"" | "angstrom" | "bohr">("");
  const [pasteCoordinates, setPasteCoordinates] = useState("");
  const [pasteName, setPasteName] = useState("User supplied reconstruction");
  const [coordinateSystem, setCoordinateSystem] = useState<"CARTESIAN" | "FRACTIONAL">("CARTESIAN");
  const [usePaperCell, setUsePaperCell] = useState(false);
  const [manualCell, setManualCell] = useState({ a: "", b: "", c: "", alpha: "90", beta: "90", gamma: "120" });
  const [reviewChecklist, setReviewChecklist] = useState<CandidateRepresentationReviewChecklist>({
    inspected_source: false,
    understands_missing_paper_coordinates: false,
    coordinate_source_declared: false,
    units_checked: false,
    cell_checked_if_used: false,
    validation_warnings_reviewed: false,
    differences_acknowledged: false,
    stereochemistry_reviewed: false,
    charges_reviewed: false,
  });
  const [activeRevisionId, setActiveRevisionId] = useState<string | null>(null);
  const [reconstructionTab, setReconstructionTab] = useState<"import" | "paste" | "draw">("import");
  const structureCandidateId = structureCandidate?.id;
  const activeRepresentation = representations.find((item) => item.id === activeRevisionId) ?? representations.at(-1) ?? null;
  const checklistComplete = Object.values(reviewChecklist).every(Boolean);

  useEffect(() => {
    let active = true;
    if (candidate?.evidence_type === "STRUCTURE_FIGURE_CANDIDATE" && structureCandidateId) {
      const savedTab = localStorage.getItem(`chemdft:reconstruction-tab:${projectId}:${structureCandidateId}`);
      if (savedTab === "import" || savedTab === "paste" || savedTab === "draw") {
        queueMicrotask(() => { if (active) setReconstructionTab(savedTab); });
      }
      const savedRevision = localStorage.getItem(`chemdft:reconstruction-revision:${projectId}:${structureCandidateId}`);
      if (savedRevision) queueMicrotask(() => { if (active) setActiveRevisionId(savedRevision); });
      void listCandidateRepresentations(projectId, structureCandidateId)
        .then((output) => { if (active) setRepresentations([...(output.representations ?? [])]); })
        .catch((error: unknown) => { if (active) setRepresentationMessage(error instanceof Error ? error.message : "Unable to load candidate representations."); });
    }
    return () => { active = false; };
  }, [candidate?.evidence_type, projectId, structureCandidateId]);

  useEffect(() => {
    if (!activeRepresentation || !structureCandidateId) return;
    let active = true;
    const key = `chemdft:reconstruction-checklist:${projectId}:${structureCandidateId}:${activeRepresentation.id}`;
    const emptyChecklist: CandidateRepresentationReviewChecklist = {
      inspected_source: false,
      understands_missing_paper_coordinates: false,
      coordinate_source_declared: false,
      units_checked: false,
      cell_checked_if_used: false,
      validation_warnings_reviewed: false,
      differences_acknowledged: false,
      stereochemistry_reviewed: false,
      charges_reviewed: false,
    };
    try {
      const saved = localStorage.getItem(key);
      const savedChecklist = saved ? JSON.parse(saved) as Partial<CandidateRepresentationReviewChecklist> : {};
      const restoredChecklist = activeRepresentation.review_state === "REVIEWED" && activeRepresentation.review_checklist
        ? { ...emptyChecklist, ...activeRepresentation.review_checklist }
        : { ...emptyChecklist, ...savedChecklist };
      queueMicrotask(() => { if (active) setReviewChecklist(restoredChecklist); });
    } catch { /* Ignore invalid saved review preferences. */ }
    // A revision change restores only that revision's checklist.
    return () => { active = false; };
  }, [activeRepresentation, structureCandidateId, projectId]);

  function updateReviewChecklist(key: keyof CandidateRepresentationReviewChecklist, checked: boolean) {
    const updated = { ...reviewChecklist, [key]: checked };
    setReviewChecklist(updated);
    if (activeRepresentation && structureCandidateId) {
      try { localStorage.setItem(`chemdft:reconstruction-checklist:${projectId}:${structureCandidateId}:${activeRepresentation.id}`, JSON.stringify(updated)); } catch { /* Review progress is best-effort local state until submitted. */ }
    }
  }

  async function reloadRepresentations(candidateId: string) {
    const output = await listCandidateRepresentations(projectId, candidateId);
    setRepresentations([...(output.representations ?? [])]);
    const latest = output.representations?.at(-1);
    if (latest) {
      setActiveRevisionId(latest.id);
      localStorage.setItem(`chemdft:reconstruction-revision:${projectId}:${candidateId}`, latest.id);
    }
    window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
  }

  async function saveKetcherDraft(molBlock: string) {
    if (!structureCandidate || !coordinateUnit) return;
    const output = await importCandidateCoordinates({
      projectId,
      candidateId: structureCandidate.id,
      file: new File([molBlock], "manual-reconstruction.mol", { type: "chemical/x-mdl-molfile" }),
      fileFormat: "MOL",
      coordinateUnit: coordinateUnit as "angstrom" | "bohr",
      coordinateOrigin: representations.some((item) => item.coordinates_available) ? "USER_EDITED" : "USER_CREATED",
      ...(activeRepresentation ? { parentRepresentationId: activeRepresentation.id } : {}),
    });
    await reloadRepresentations(structureCandidate.id);
    setEditingDraft(null);
    setRepresentationMessage(output.representation.validation_diagnostics?.join(" ") ?? "Manual coordinates saved as a new unverified revision.");
  }

  async function importCoordinates(file?: File) {
    if (!structureCandidate || !file || !coordinateUnit) return;
    const extension = file.name.split(".").pop()?.toUpperCase();
    if (!(extension === "XYZ" || extension === "MOL" || extension === "SDF" || extension === "CIF")) {
      setRepresentationMessage("Choose an XYZ, MOL, SDF, or CIF coordinate file.");
      return;
    }
    setBusy(true);
    try {
      await importCandidateCoordinates({
        projectId,
        candidateId: structureCandidate.id,
        file,
        fileFormat: extension,
        coordinateUnit,
        coordinateOrigin: "USER_IMPORTED_FILE",
        ...(activeRepresentation ? { parentRepresentationId: activeRepresentation.id } : {}),
      });
      await reloadRepresentations(structureCandidate.id);
      setRepresentationMessage(`Imported ${file.name} as a new unverified coordinate revision.`);
    } catch (error) {
      setRepresentationMessage(error instanceof Error ? error.message : "Unable to import coordinates.");
    } finally { setBusy(false); }
  }

  async function savePastedCoordinates() {
    if (!structureCandidate || !coordinateUnit || !pasteCoordinates.trim()) return;
    const selectedCell: CandidateCellParameters | undefined = coordinateSystem === "FRACTIONAL" && usePaperCell ? { a: 4.958, b: 4.958, c: 13.593, alpha: 90, beta: 90, gamma: 120, unit: coordinateUnit } :
      coordinateSystem === "FRACTIONAL" ? { a: Number(manualCell.a), b: Number(manualCell.b), c: Number(manualCell.c), alpha: Number(manualCell.alpha), beta: Number(manualCell.beta), gamma: Number(manualCell.gamma), unit: coordinateUnit } : undefined;
    const citedCell = coordinateSystem === "FRACTIONAL" && usePaperCell ? reportedCellEvidence.at(0) : undefined;
    setBusy(true);
    try {
      await pasteCandidateCoordinates(projectId, structureCandidate.id, {
        name: pasteName,
        coordinate_system: coordinateSystem,
        unit: coordinateUnit,
        coordinate_text: pasteCoordinates,
        ...(activeRepresentation ? { parent_representation_id: activeRepresentation.id } : {}),
        ...(selectedCell ? { cell: selectedCell, cell_source: usePaperCell ? "PAPER_EVIDENCE" : "USER_ENTERED", ...(citedCell ? { cell_source_evidence_id: citedCell.id } : {}) } : {}),
      });
      await reloadRepresentations(structureCandidate.id);
      setRepresentationMessage("Pasted coordinates saved as a new unverified revision. The paper cell was recorded separately from your coordinates.");
    } catch (error) {
      setRepresentationMessage(error instanceof Error ? error.message : "Unable to save pasted coordinates.");
    } finally { setBusy(false); }
  }

  async function openCandidatePreview(representation: CandidateRepresentationView) {
    if (!structureCandidate) return;
    setBusy(true);
    setRepresentationMessage("Loading candidate preview…");
    try {
      const detail: CandidateRepresentationDetail = await getCandidateRepresentation(projectId, structureCandidate.id, representation.id);
      if (detail.validation_state !== "PREVIEWABLE" || !detail.coordinate_representation) {
        setRepresentationMessage(detail.validation_diagnostics?.join(" ") || "This representation has no previewable coordinates.");
        return;
      }
      setPreview(buildCandidatePreviewScene({
        candidateId: structureCandidate.id,
        representationId: detail.id,
        representationRevision: detail.revision,
        representation: detail.coordinate_representation,
      }));
      setRepresentationMessage(null);
    } catch (error) {
      setRepresentationMessage(error instanceof Error ? error.message : "Unable to open candidate preview.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewRepresentation(representation: CandidateRepresentationView) {
    if (!structureCandidate) return;
    setBusy(true);
    try {
      await reviewCandidateRepresentation(projectId, structureCandidate.id, representation.id, reviewChecklist);
      await reloadRepresentations(structureCandidate.id);
      setRepresentationMessage("Representation reviewed. It remains unverified until explicitly promoted.");
    } catch (error) {
      setRepresentationMessage(error instanceof Error ? error.message : "Unable to review representation.");
    } finally {
      setBusy(false);
    }
  }

  async function rejectRepresentation(representation: CandidateRepresentationView) {
    if (!structureCandidate) return;
    setBusy(true);
    try {
      await rejectCandidateRepresentation(projectId, structureCandidate.id, representation.id);
      await reloadRepresentations(structureCandidate.id);
      setPreview(null);
      setRepresentationMessage("Representation rejected; its immutable source record is retained.");
    } catch (error) {
      setRepresentationMessage(error instanceof Error ? error.message : "Unable to reject representation.");
    } finally {
      setBusy(false);
    }
  }

  async function promoteRepresentation(representation: CandidateRepresentationView) {
    if (!structureCandidate) return;
    setBusy(true);
    setRepresentationMessage("Promoting the explicitly reviewed reconstruction as immutable V1…");
    try {
      const output = await promoteStructureCandidate(projectId, structureCandidate.id, representation.id);
      setRepresentationMessage("Promoted as an immutable reconstructed StructureVersion with user review recorded.");
      setPreview(null);
      await onPromoted(output);
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
    } catch (error) {
      setRepresentationMessage(error instanceof Error ? error.message : "Candidate promotion failed.");
    } finally {
      setBusy(false);
    }
  }
  if (!document) return <p className="table-empty">Select a document to inspect its source evidence.</p>;
  const figureEvidence = candidate?.source_anchor?.source_type === "FIGURE";
  return (
    <div className="phase7-inspector">
      {documentOpenError ? <p className="workspace-document-error" role="alert">Document open failed: {documentOpenError}</p> : null}
      {citationPage && !candidate ? <p className="workspace-source-location">Cited passage · page {citationPage}. Exact region is not available from this source.</p> : null}
      <div className="phase7-detail-card">
        <h3>Evidence inspector</h3>
        {candidate ? (
          <>
            {structureCandidate ? (
              <section className="phase7-structure-candidate" aria-label="Detected structure candidate">
                <div>
                  <strong>Detected structure candidate</strong>
                  <span>{document.title ?? "Paper"} · {structureCandidate.source_anchor?.figure_number ? `Fig. ${structureCandidate.source_anchor.figure_number} · ` : ""}p. {structureCandidate.source_page ?? "—"}</span>
                </div>
                <p><StatusTag intent="none">Reported figure · Unverified</StatusTag></p>
                <p><strong>Source representation:</strong> Figure evidence only. It does not create authoritative chemistry.</p>
                <div className="phase7-actions">
                  <ActionButton small text="Inspect candidate" onClick={() => globalThis.document.getElementById("candidate-representation-history")?.scrollIntoView({ block: "nearest" })} />
                  <ActionButton small text="View source" onClick={() => globalThis.document.getElementById("phase7-pdf-canvas")?.scrollIntoView({ block: "center" })} />
                  <ActionButton small text="Review candidate" disabled={structureCandidate.candidate_state !== "DETECTED"} onClick={() => void onReviewStructure(structureCandidate)} />
                  <ActionButton small text="Reject candidate" disabled={structureCandidate.candidate_state === "REJECTED" || structureCandidate.candidate_state === "PROMOTED"} onClick={() => void onRejectStructure(structureCandidate)} />
                </div>
                {structureCandidate.candidate_state === "REVIEWED" ? <p className="workspace-muted">Reviewed candidate · still not a validated structure.</p> : null}
                {structureCandidate.candidate_state === "REJECTED" ? <p className="workspace-muted">Candidate rejected · source evidence remains unchanged.</p> : null}
                {structureCandidate.candidate_state !== "REJECTED" && structureCandidate.candidate_state !== "PROMOTED" ? (
                  <div className="candidate-representation-workbench" aria-label="Human-reviewed reconstruction workbench">
                    <div className="candidate-representation-heading"><strong>Reconstruct from user supplied coordinates</strong><span>The paper reports cell parameters but does not provide full atomic coordinates. Coordinates below must come from you or an imported file.</span></div>
                    <div className="candidate-preview-warning" role="note">UNVERIFIED RECONSTRUCTION · Candidate coordinates remain outside calculations until an explicit review and promotion.</div>
                    {reportedCellEvidence.at(0) ? <p className="workspace-muted">Reported cell evidence only: a=b=4.958 Å, c=13.593 Å, α=β=90°, γ=120° · source {shortId(reportedCellEvidence.at(0)!.id)}. Cell values do not supply atomic coordinates.</p> : <p className="workspace-muted">No reported cell evidence is linked to this candidate. Cell values do not supply atomic coordinates.</p>}
                    <div className="reconstruction-input-tabs" role="tablist" aria-label="Coordinate input method">
                      {(["import", "paste", "draw"] as const).map((tab) => <button type="button" role="tab" aria-selected={reconstructionTab === tab} key={tab} onClick={() => { setReconstructionTab(tab); localStorage.setItem(`chemdft:reconstruction-tab:${projectId}:${structureCandidate.id}`, tab); }}>{tab === "import" ? "Import file" : tab === "paste" ? "Paste coordinates" : "Draw / edit"}</button>)}
                    </div>
                    <label>Coordinate units <select aria-label="Coordinate units" value={coordinateUnit} onChange={(event) => setCoordinateUnit(event.currentTarget.value as "" | "angstrom" | "bohr")}><option value="">Choose units…</option><option value="angstrom">Ångström</option><option value="bohr">Bohr</option></select></label>
                    {reconstructionTab === "import" ? <div className="candidate-coordinate-entry"><label htmlFor="candidate-coordinate-file">Import XYZ, MOL, SDF, or CIF coordinates</label><input id="candidate-coordinate-file" type="file" accept=".xyz,.mol,.sdf,.cif" disabled={busy || !coordinateUnit} onChange={(event) => void importCoordinates(event.currentTarget.files?.[0])} /><small>Original bytes are hashed and retained in provenance. Import creates a revision; it never creates a StructureVersion.</small></div> : null}
                    {reconstructionTab === "paste" ? <div className="candidate-coordinate-entry">
                      <label htmlFor="candidate-coordinate-system">Coordinate system</label><select id="candidate-coordinate-system" value={coordinateSystem} onChange={(event) => setCoordinateSystem(event.currentTarget.value as "CARTESIAN" | "FRACTIONAL")}><option value="CARTESIAN">Cartesian · x y z</option><option value="FRACTIONAL">Fractional · fx fy fz</option></select>
                      <label htmlFor="candidate-coordinate-name">Revision name</label><input id="candidate-coordinate-name" value={pasteName} onChange={(event) => setPasteName(event.currentTarget.value)} />
                      <label htmlFor="candidate-coordinate-text">One atom per line: element x y z</label><textarea id="candidate-coordinate-text" rows={5} value={pasteCoordinates} onChange={(event) => setPasteCoordinates(event.currentTarget.value)} placeholder={"Cr 0.000 0.000 0.000\nO 0.000 0.000 1.950"} />
                      {coordinateSystem === "FRACTIONAL" ? <fieldset className="candidate-cell-entry"><legend>Explicit unit cell required for fractional coordinates</legend><label><input type="checkbox" checked={usePaperCell} disabled={coordinateUnit !== "angstrom" || reportedCellEvidence.length === 0} onChange={(event) => setUsePaperCell(event.currentTarget.checked)} /> Apply paper reported cell: a=b=4.958 Å, c=13.593 Å, α=β=90°, γ=120°</label><small>These values provide a cell only. They do not provide atom positions. {reportedCellEvidence.at(0) ? `Source evidence ${shortId(reportedCellEvidence.at(0)!.id)}.` : "No linked reported-cell evidence was found."}</small>
                        {!usePaperCell ? <div className="candidate-cell-grid">{(["a", "b", "c", "alpha", "beta", "gamma"] as const).map((key) => <label key={key}>{key}<input aria-label={`Cell ${key}`} type="number" step="any" value={manualCell[key]} onChange={(event) => { const value = event.currentTarget.value; setManualCell((cell) => ({ ...cell, [key]: value })); }} /></label>)}</div> : null}</fieldset> : null}
                      <ActionButton small intent="primary" text={busy ? "Saving…" : "Create coordinate revision"} disabled={busy || !coordinateUnit || !pasteCoordinates.trim() || (coordinateSystem === "FRACTIONAL" && !usePaperCell && Object.values(manualCell).some((value) => !value))} onClick={() => void savePastedCoordinates()} />
                    </div> : null}
                    {reconstructionTab === "draw" ? <div className="candidate-coordinate-entry"><p>Draw or edit a geometry in the structure editor. Saving creates a user-authored coordinate revision.</p><ActionButton small disabled={busy || !coordinateUnit} text="Open structure editor" onClick={() => setEditingDraft("ketcher")} />{editingDraft === "ketcher" ? <KetcherEditorPanel mode="candidate" initialMolfile={null} onCancel={() => setEditingDraft(null)} onSave={saveKetcherDraft} /> : null}</div> : null}
                    {representations.length === 0 ? <p className="table-empty">No representation history is available.</p> : (
                      <div className="candidate-representation-list" id="candidate-representation-history" aria-label="Candidate representation history">
                        {representations.map((representation) => (
                          <article className="candidate-representation-row" key={representation.id} data-active={activeRepresentation?.id === representation.id ? "true" : undefined}>
                            <div className="candidate-representation-meta"><strong>R{representation.revision} · {representation.representation_type.replaceAll("_", " ")}</strong><span>{representation.representation_origin.replaceAll("_", " ")} · {representation.coordinates_available ? "coordinates available" : "image reference only"} · {representation.validation_state.replaceAll("_", " ")} · {representation.review_state?.replaceAll("_", " ") ?? "not reviewed"}</span>{representation.coordinate_provenance ? <small>Coordinate source: {String(representation.coordinate_provenance.origin)} · {String(representation.coordinate_provenance.coordinate_unit ?? "units missing")} {representation.coordinate_provenance.original_file_sha256 ? `· SHA-256 ${String(representation.coordinate_provenance.original_file_sha256).slice(0, 12)}…` : ""}</small> : null}{representation.cell_provenance ? <small>Cell source: {String(representation.cell_provenance.source)}{representation.cell_provenance.source_evidence_id ? ` · evidence ${shortId(String(representation.cell_provenance.source_evidence_id))}` : ""}</small> : null}{representation.validation_diagnostics?.map((diagnostic) => <small key={diagnostic}>Validation: {diagnostic}</small>)}</div>
                            <div className="phase7-actions">
                              <ActionButton small text={activeRepresentation?.id === representation.id ? "Selected revision" : "Select revision"} aria-pressed={activeRepresentation?.id === representation.id} onClick={() => { setActiveRevisionId(representation.id); localStorage.setItem(`chemdft:reconstruction-revision:${projectId}:${structureCandidate.id}`, representation.id); setReviewChecklist({ inspected_source: false, understands_missing_paper_coordinates: false, coordinate_source_declared: false, units_checked: false, cell_checked_if_used: false, validation_warnings_reviewed: false, differences_acknowledged: false, stereochemistry_reviewed: false, charges_reviewed: false }); }} />
                              {representation.validation_state === "PREVIEWABLE" ? <ActionButton small text="Open preview" disabled={busy} onClick={() => void openCandidatePreview(representation)} /> : null}
                              <ActionButton small text="Review representation" disabled={busy || (representation.review_state === "REVIEWED" && representation.review_checklist?.stereochemistry_reviewed === true && representation.review_checklist?.charges_reviewed === true) || representation.validation_state !== "PREVIEWABLE" || !checklistComplete || activeRepresentation?.id !== representation.id} onClick={() => void reviewRepresentation(representation)} />
                              <ActionButton small text="Reject representation" disabled={busy || representation.review_state === "REJECTED"} onClick={() => void rejectRepresentation(representation)} />
                              <ActionButton small intent="primary" text="Promote to StructureVersion" disabled={busy || structureCandidate.candidate_state !== "REVIEWED" || representation.review_state !== "REVIEWED" || representation.validation_state !== "PREVIEWABLE" || !representation.coordinates_available || !representation.coordinate_provenance} onClick={() => void promoteRepresentation(representation)} />
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                    {activeRepresentation?.coordinates_available ? <fieldset className="candidate-review-checklist"><legend>Human review checklist · all items must be acknowledged</legend>{([
                      ["inspected_source", "I inspected the original figure and its source evidence."],
                      ["understands_missing_paper_coordinates", "I understand the paper does not provide full atomic coordinates."],
                      ["coordinate_source_declared", "I inspected the declared source of the graph and coordinates."],
                      ["units_checked", "I checked the coordinate units."],
                      ["cell_checked_if_used", "I checked the cell parameters, if a cell is used."],
                      ["validation_warnings_reviewed", "Validation passed or I reviewed the warnings."],
                      ["differences_acknowledged", "I acknowledge any differences from the source figure and evidence."],
                      ["stereochemistry_reviewed", "I explicitly reviewed stereochemistry, including R/S and E/Z assignments."],
                      ["charges_reviewed", "I explicitly reviewed formal charges and isotopes."],
                    ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={reviewChecklist[key] === true} onChange={(event) => updateReviewChecklist(key, event.currentTarget.checked)} />{label}</label>)}</fieldset> : null}
                    {representationMessage ? <p className="candidate-representation-message" role="status">{representationMessage}</p> : null}
                    {preview ? <CandidatePreviewPanel scene={preview} title="Unverified reconstruction" /> : null}
                  </div>
                ) : null}
              </section>
            ) : null}
            <dl className="provenance-list">
              {figureEvidence ? <>
                <div><dt>Evidence</dt><dd>{figureLabel ?? "Figure evidence"}</dd></div>
                <div><dt>Figure</dt><dd>{candidate.source_anchor?.figure_number ?? "Not identified"}</dd></div>
                <div><dt>Page</dt><dd>{candidate.source_anchor?.page_number ?? "Not anchored"}</dd></div>
                <div><dt>Caption</dt><dd>{candidate.source_anchor?.caption || candidate.source_anchor?.snippet || "No caption extracted"}</dd></div>
                <div><dt>Source document</dt><dd>{document.title ?? shortId(document.id)}</dd></div>
                <div><dt>Source class</dt><dd>{candidate.source_class}</dd></div>
                <div><dt>Extraction method</dt><dd>{candidate.extraction_method} · {candidate.extractor_version}</dd></div>
                <div><dt>Review state</dt><dd>{candidate.review_state}</dd></div>
                <div><dt>Anchor precision</dt><dd>{isPageOnlyAnchor(candidate) ? "Page-level source · region not available" : "Source region bounds"}</dd></div>
                {structureCandidate ? <div><dt>Linked candidate</dt><dd>Figure candidate · {structureCandidate.candidate_state} · UNVERIFIED</dd></div> : null}
              </> : <>
                <div><dt>Type</dt><dd>{candidate.evidence_type}</dd></div>
                <div><dt>Source class</dt><dd>{candidate.source_class}</dd></div>
                <div><dt>Review</dt><dd>{candidate.review_state}</dd></div>
                <div><dt>Document</dt><dd>{document.title ?? shortId(document.id)}</dd></div>
                <div><dt>Page</dt><dd>{candidate.source_anchor?.page_number ?? "Not anchored"}</dd></div>
                <div><dt>Anchor precision</dt><dd>{isPageOnlyAnchor(candidate) ? "Page only · figure/region bounds unavailable" : "Region bounds supplied by source"}</dd></div>
                <div><dt>Figure/table</dt><dd>{candidate.source_anchor?.figure_number ?? candidate.source_anchor?.table_number ?? "Not identified"}</dd></div>
                <div><dt>Extractor</dt><dd>{candidate.extraction_method} · {candidate.extractor_version}</dd></div>
                <div><dt>Reported value</dt><dd>{formatPayload(candidate.structured_payload)}</dd></div>
              </>}
            </dl>
            {figureRecords.length > 1 ? <details className="phase7-figure-provenance">
              <summary>{figureRecords.length} extractor records for this figure</summary>
              <ul>{figureRecords.map((record) => <li key={record.id}>
                <strong>Finding {record.id}</strong> · {record.source_class} · {record.review_state} · page {record.source_anchor?.page_number ?? "—"}<br />
                {record.extraction_method} · {record.extractor_version}<br />
                {record.source_anchor?.caption || record.source_anchor?.snippet || "No caption text"}
              </li>)}</ul>
            </details> : null}
            {rawView && figureEvidence ? <details className="phase7-figure-provenance">
              <summary>Advanced · raw extractor payload</summary>
              <pre>{JSON.stringify(candidate.structured_payload, null, 2)}</pre>
            </details> : null}
            <div className="phase7-actions">
              <ActionButton small text="View source" onClick={() => globalThis.document.getElementById("phase7-pdf-canvas")?.scrollIntoView({ block: "center" })} />
              <ActionButton small text="Accept evidence" disabled={candidate.review_state === "ACCEPTED"} onClick={() => void onAccept(candidate)} />
              <ActionButton small text="Reject evidence" disabled={candidate.review_state === "REJECTED"} onClick={() => void onReject(candidate)} />
            </div>
            {candidate.source_anchor?.source_type === "FIGURE" ? (
              <p className="phase7-science-safety"><strong>Reported figure evidence.</strong> This is not a validated structure; no atomic coordinates are available from this record.</p>
            ) : null}
            {figureEvidence && digitizerEligible && candidate.evidence_type !== "STRUCTURE_FIGURE_CANDIDATE" ? (
              xrdDigitizerEligible ? <XrdDigitizationWorkbench
                projectId={projectId}
                document={document}
                candidate={candidate}
                draft={xrdDraft}
                captureMode={xrdCaptureMode}
                onCaptureMode={onXrdCaptureMode}
                onDraftChange={onXrdDraftChange}
                onCommitted={onDigitized}
              /> : dlsDigitizerEligible && document ? <DlsDigitizationWorkbench
                projectId={projectId}
                document={document}
                candidate={candidate}
                draft={xrdDraft}
                captureMode={xrdCaptureMode}
                onCaptureMode={onXrdCaptureMode}
                onDraftChange={onXrdDraftChange}
                onCommitted={onDigitized}
              /> : <DigitizerPanel
                projectId={projectId}
                candidate={candidate}
                document={document}
                latestPoint={digitizerPoint}
                onDigitized={onDigitized}
              />
            ) : null}
          </>
        ) : <p className="table-empty">Select evidence to inspect source and provenance.</p>}
      </div>
    </div>
  );
}

function PdfSourceViewer({
  projectId,
  document,
  candidate,
  requestedPage,
  onDigitizerPoint,
  digitizerDraft,
  digitizerCaptureMode,
  digitizerPage,
  onXrdSourceClick,
  onRenderFrame,
  onPageChange,
  canvasId = "phase7-pdf-canvas",
}: {
  projectId: string;
  document: ScientificDocument;
  candidate: EvidenceCandidate | null;
  requestedPage: number | null;
  onDigitizerPoint: (point: DigitizerPoint) => void;
  digitizerDraft: XrdDigitizerDraft;
  digitizerCaptureMode: XrdDigitizerCaptureMode;
  digitizerPage: number;
  onXrdSourceClick: (point: DigitizerPoint) => void;
  onRenderFrame: (frame: SourceRenderFrame) => void;
  onPageChange?: (page: number) => void;
  canvasId?: string;
}) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PdfDocumentProxy | null>(null);
  const [page, setPage] = useState(requestedPage ?? candidate?.source_anchor?.page_number ?? 1);
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [status, setStatus] = useState("Loading PDF viewer…");
  const [pdfVersion, setPdfVersion] = useState("pdfjs-unknown");

  useEffect(() => {
    queueMicrotask(() => setPage(requestedPage ?? candidate?.source_anchor?.page_number ?? 1));
  }, [candidate?.id, candidate?.source_anchor?.page_number, requestedPage]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist") as unknown as PdfJsModule;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
        setPdfVersion(`pdfjs-${pdfjs.version}`);
        const loaded = await pdfjs.getDocument({ url: documentSourceUrl(projectId, document.id), disableJavaScript: true, isEvalSupported: false }).promise;
        if (!cancelled) {
          setPdf(loaded);
          setPage((value) => Math.min(Math.max(value, 1), loaded.numPages));
          setStatus("PDF loaded · rendering page…");
        }
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Unable to open PDF source.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [document.id, projectId]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    let task: PdfRenderTask | null = null;
    void (async () => {
      const pdfPage = await pdf.getPage(page);
      if (cancelled || !canvasRef.current) return;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      setSize({ width: viewport.width, height: viewport.height });
      setStatus(`Rendering page ${page}…`);
      task = pdfPage.render({ canvasContext: context, viewport });
      await task.promise;
      if (!cancelled) {
        setStatus(`Page ${page} rendered`);
        const renderSha256 = await hashCanvasPng(canvas);
        if (!cancelled) onRenderFrame({
          page,
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
          cssWidth: viewport.width,
          cssHeight: viewport.height,
          scale,
          renderSha256,
          renderVersion: `${pdfVersion}; canvas-png-v1`,
        });
      }
    })().catch((error: unknown) => {
      if (!cancelled) setStatus(error instanceof Error ? `Unable to render page ${page}: ${error.message}` : `Unable to render page ${page}.`);
    });
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [page, pdf, scale, pdfVersion, onRenderFrame]);

  const highlight = candidate?.source_anchor && candidate.source_anchor.page_number === page
    ? normalizedAnchorToCssRect(candidate.source_anchor, size.width, size.height)
    : null;
  const hasUserDefinedRegion = page === digitizerPage && digitizerDraft.sourceFrame?.page === digitizerPage && digitizerDraft.region;
  async function fitPage(mode: "width" | "page") {
    if (!pdf || !viewerRef.current) return;
    const pdfPage = await pdf.getPage(page);
    const base = pdfPage.getViewport({ scale: 1 });
    const availableWidth = Math.max(240, viewerRef.current.clientWidth - 28);
    const widthScale = availableWidth / base.width;
    const nextScale = mode === "width" ? widthScale : Math.min(widthScale, Math.max(240, window.innerHeight * 0.68 - 120) / base.height);
    setScale(Number(Math.max(0.2, Math.min(nextScale, 3)).toFixed(2)));
  }
  return (
    <div className="phase7-pdf-viewer" ref={viewerRef}>
      <div className="phase7-pdf-toolbar">
        <ActionButton small text="Prev" disabled={page <= 1} onClick={() => { const next = Math.max(1, page - 1); setPage(next); onPageChange?.(next); }} />
        <span>Page {page} / {pdf?.numPages ?? document.page_count}</span>
        <ActionButton small text="Next" disabled={pdf ? page >= pdf.numPages : page >= document.page_count} onClick={() => { const next = Math.min(pdf?.numPages ?? document.page_count, page + 1); setPage(next); onPageChange?.(next); }} />
        <ActionButton small text="Fit width" aria-label="Fit PDF to viewer width" onClick={() => void fitPage("width")} />
        <ActionButton small text="Fit page" aria-label="Fit entire PDF page in viewer" onClick={() => void fitPage("page")} />
        <ActionButton small text="100%" aria-label="Show PDF at 100 percent" onClick={() => setScale(1)} />
        <ActionButton small text="-" onClick={() => setScale((value) => Math.max(0.6, Number((value - 0.2).toFixed(1))))} />
        <span>{Math.round(scale * 100)}%</span>
        <ActionButton small text="+" onClick={() => setScale((value) => Math.min(2.4, Number((value + 0.2).toFixed(1))))} />
      </div>
      {status ? <p className="table-empty">{status}</p> : null}
      <div className="phase7-pdf-page" style={{ width: size.width, height: size.height }} data-render-page={page}>
        <canvas
          ref={canvasRef}
          id={canvasId}
          data-digitizer-active={digitizerCaptureMode !== "off" ? "true" : undefined}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const cssPoint = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
            if (digitizerCaptureMode !== "off" && page === digitizerPage) {
              onXrdSourceClick({
                x: cssPoint.x * event.currentTarget.width / bounds.width,
                y: cssPoint.y * event.currentTarget.height / bounds.height,
              });
            } else {
              onDigitizerPoint(cssPoint);
            }
          }}
        />
        {page === digitizerPage && digitizerDraft.sourceFrame?.page === digitizerPage && digitizerDraft.sourceFrame.pixelWidth > 0 ? <div className="phase7-digitization-overlay" aria-hidden="true">
          {digitizerDraft.region ? <div className="phase7-digitization-region" style={{
            left: digitizerDraft.region.x * size.width / digitizerDraft.sourceFrame.pixelWidth,
            top: digitizerDraft.region.y * size.height / digitizerDraft.sourceFrame.pixelHeight,
            width: digitizerDraft.region.width * size.width / digitizerDraft.sourceFrame.pixelWidth,
            height: digitizerDraft.region.height * size.height / digitizerDraft.sourceFrame.pixelHeight,
          }}><span>User-defined graph region</span></div> : null}
          {[
            digitizerDraft.regionStart,
            digitizerDraft.xPixelA,
            digitizerDraft.xPixelB,
            digitizerDraft.yPixelA,
            digitizerDraft.yPixelB,
          ].filter((point): point is DigitizerPoint => point !== null).map((point, index) => <i key={`calibration:${index}:${point.x}:${point.y}`} className="phase7-digitization-marker calibration" style={{
            left: point.x * size.width / digitizerDraft.sourceFrame!.pixelWidth,
            top: point.y * size.height / digitizerDraft.sourceFrame!.pixelHeight,
          }} />)}
          {digitizerDraft.points.map((point, index) => <i key={`point:${index}:${point.x}:${point.y}`} className={index === digitizerDraft.selectedPointIndex ? "phase7-digitization-marker selected" : "phase7-digitization-marker"} style={{
            left: point.x * size.width / digitizerDraft.sourceFrame!.pixelWidth,
            top: point.y * size.height / digitizerDraft.sourceFrame!.pixelHeight,
          }} />)}
        </div> : null}
        {highlight && candidateHasRegionBounds(candidate) ? <div className="phase7-highlight" style={highlight} /> : null}
        {highlight && !candidateHasRegionBounds(candidate) && !hasUserDefinedRegion ? <div className="phase7-page-anchor-note">Page-level source · region not available</div> : null}
      </div>
    </div>
  );
}

async function hashCanvasPng(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => {
    if (value) resolve(value);
    else reject(new Error("PDF page render could not be hashed."));
  }, "image/png"));
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function XrdDigitizationWorkbench({
  projectId,
  document,
  candidate,
  draft,
  captureMode,
  onCaptureMode,
  onDraftChange,
  onCommitted,
}: {
  projectId: string;
  document: ScientificDocument;
  candidate: EvidenceCandidate;
  draft: XrdDigitizerDraft;
  captureMode: XrdDigitizerCaptureMode;
  onCaptureMode: (mode: XrdDigitizerCaptureMode) => void;
  onDraftChange: (draft: XrdDigitizerDraft) => void;
  onCommitted: (dataset: ExperimentalDatasetView) => void;
}) {
  const [xValueA, setXValueA] = useState("");
  const [xValueB, setXValueB] = useState("");
  const [yValueA, setYValueA] = useState("");
  const [yValueB, setYValueB] = useState("");
  const [yUnitStatus, setYUnitStatus] = useState<"ARBITRARY" | "SOURCE_DEFINED">("ARBITRARY");
  const [ySourceUnit, setYSourceUnit] = useState("");
  const [pointMode, setPointMode] = useState<"PEAK_PICKING" | "CURVE_POINTS">("PEAK_PICKING");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const frame = draft.sourceFrame;
  const region = draft.region;
  const numericXValues = [Number(xValueA), Number(xValueB)];
  const xValuesValid = xValueA.trim() !== "" && xValueB.trim() !== ""
    && numericXValues.every(Number.isFinite) && numericXValues[0] !== numericXValues[1];
  const xPixelsValid = Boolean(draft.xPixelA && draft.xPixelB && draft.xPixelA.x !== draft.xPixelB.x);
  const xReady = Boolean(region && frame?.page === 6 && xValuesValid && xPixelsValid);
  const yValuesValid = yValueA.trim() !== "" && yValueB.trim() !== ""
    && Number.isFinite(Number(yValueA)) && Number.isFinite(Number(yValueB)) && Number(yValueA) !== Number(yValueB);
  const yPixelsValid = Boolean(draft.yPixelA && draft.yPixelB && draft.yPixelA.y !== draft.yPixelB.y);
  const hasAnyYCalibration = Boolean(draft.yPixelA || draft.yPixelB || yValueA.trim() || yValueB.trim());
  const yReady = yValuesValid && yPixelsValid;
  const yCalibrationPartial = hasAnyYCalibration && !yReady;
  const sourcePoints = draft.points.map((point) => ({
    source_pixel: point,
    two_theta_degree: xReady && draft.xPixelA && draft.xPixelB
      ? numericXValues[0]! + (point.x - draft.xPixelA.x) * (numericXValues[1]! - numericXValues[0]!) / (draft.xPixelB.x - draft.xPixelA.x)
      : null,
    intensity: yReady && draft.yPixelA && draft.yPixelB
      ? Number(yValueA) + (point.y - draft.yPixelA.y) * (Number(yValueB) - Number(yValueA)) / (draft.yPixelB.y - draft.yPixelA.y)
      : null,
  }));
  const pointValuesValid = sourcePoints.every((point) => point.two_theta_degree !== null
    && Number.isFinite(point.two_theta_degree) && point.two_theta_degree >= 0 && point.two_theta_degree <= 180
    && (point.intensity === null || Number.isFinite(point.intensity)));
  const regionReady = Boolean(region && frame?.page === 6 && region.width > 1 && region.height > 1
    && region.x + region.width <= frame.pixelWidth && region.y + region.height <= frame.pixelHeight);
  const sourceYUnitValid = yUnitStatus !== "SOURCE_DEFINED" || ySourceUnit.trim().length > 0;
  const canCommit = regionReady && xReady && !yCalibrationPartial && sourceYUnitValid && draft.points.length > 0 && pointValuesValid && !busy;
  const status = !regionReady ? "REGION REQUIRED"
    : !xReady ? "X CALIBRATION REQUIRED"
      : draft.points.length === 0 ? "READY TO DIGITIZE"
        : "UNCOMMITTED";

  async function commit() {
    if (!canCommit || !frame || !region || !draft.xPixelA || !draft.xPixelB) return;
    setBusy(true);
    setMessage(null);
    try {
      const dataset = await createXrdDigitizedDataset(projectId, candidate.id, {
        experiment_name: "Figure 3 XRD · DIGITIZED",
        source_document_sha256: document.sha256,
        source_render_sha256: frame.renderSha256,
        source_render_version: frame.renderVersion,
        source_render_scale: frame.scale,
        source_pixel_width: frame.pixelWidth,
        source_pixel_height: frame.pixelHeight,
        plot_region: region,
        x_calibration: {
          pixel_a: draft.xPixelA, pixel_b: draft.xPixelB,
          value_a: numericXValues[0]!, value_b: numericXValues[1]!,
          label: "2theta", unit: "degree", scale: "linear",
        },
        ...(yReady && draft.yPixelA && draft.yPixelB ? {
          y_calibration: {
            pixel_a: draft.yPixelA, pixel_b: draft.yPixelB,
            value_a: Number(yValueA), value_b: Number(yValueB),
            label: "Intensity", unit: yUnitStatus === "ARBITRARY" ? "arbitrary" : ySourceUnit.trim(), scale: "linear" as const,
          },
          y_unit_status: yUnitStatus,
        } : { y_unit_status: "UNKNOWN" as const }),
        point_mode: pointMode,
        points: draft.points.map((source_pixel) => ({ source_pixel })) as XrdDigitizedDatasetInput["points"],
      });
      onCommitted(dataset);
      setMessage(`Saved DIGITIZED dataset · ${dataset.point_count} points · V${dataset.digitization_session?.revision ?? 1}.`);
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Digitized dataset could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="xrd-digitizer" aria-label="Figure 3 XRD digitization workbench">
    <div className="xrd-digitizer-heading"><div><h3>Figure 3 · XRD digitization</h3><p>{document.title ?? "Source document"} · page 6 · Figure 3 · {candidate.review_state}</p></div><strong data-state={status.toLowerCase().replaceAll(" ", "-")}>{status}</strong></div>
    <p className="xrd-digitizer-source-note">The source extractor has only page-level bounds. Define the graph region on the rendered PDF. Every captured location is stored in that PDF render’s source pixels.</p>
    <div className="xrd-digitizer-steps">
      <div><strong>Region</strong><span>{regionReady ? "User-defined graph region" : "Required"}</span></div>
      <div><strong>2θ calibration</strong><span>{xReady ? "Linear · degrees" : "Two tick locations and values"}</span></div>
      <div><strong>Intensity</strong><span>{yReady ? `Calibrated · ${yUnitStatus === "ARBITRARY" ? "arbitrary units" : ySourceUnit}` : "Optional · otherwise omitted"}</span></div>
      <div><strong>Points</strong><span>{draft.points.length} · {pointMode === "PEAK_PICKING" ? "manual peaks" : "manual curve points"}</span></div>
    </div>
    <div className="xrd-digitizer-region-control">
      <span>{captureMode === "region-first" ? "Click the top-left region corner." : captureMode === "region-second" ? "Click the opposite region corner." : captureMode === "peaks" ? "Click each peak maximum on the PDF." : captureMode === "curve" ? "Click curve points from left to right." : "Choose a capture action, then click the Figure 3 page."}</span>
      <ActionButton small text={captureMode === "region-first" || captureMode === "region-second" ? "Cancel region" : regionReady ? "Redefine graph region" : "Define graph region"} disabled={!frame || frame.page !== 6} onClick={() => onCaptureMode(captureMode.startsWith("region-") ? "off" : "region-first")} />
    </div>
    {regionReady ? <p className="xrd-digitizer-region-label">User-defined graph region · {Math.round(region!.width)} × {Math.round(region!.height)} source pixels</p> : null}
    <fieldset className="xrd-digitizer-calibration"><legend>X calibration · 2θ / degree · linear</legend>
      <label>Tick A value<input inputMode="decimal" value={xValueA} onChange={(event) => setXValueA(event.currentTarget.value)} placeholder="Read from a printed tick" /></label>
      <ActionButton small text={draft.xPixelA ? "Reset tick A" : "Set tick A on source"} disabled={!regionReady} onClick={() => { if (draft.xPixelA) onDraftChange({ ...draft, xPixelA: null }); else onCaptureMode("x-tick-a"); }} />
      <label>Tick B value<input inputMode="decimal" value={xValueB} onChange={(event) => setXValueB(event.currentTarget.value)} placeholder="Read from a printed tick" /></label>
      <ActionButton small text={draft.xPixelB ? "Reset tick B" : "Set tick B on source"} disabled={!regionReady} onClick={() => { if (draft.xPixelB) onDraftChange({ ...draft, xPixelB: null }); else onCaptureMode("x-tick-b"); }} />
    </fieldset>
    <details className="xrd-digitizer-calibration-optional">
      <summary>Calibrate intensity (optional)</summary>
      <p>If the graph provides readable Y tick values, mark two ticks. Otherwise leave intensity uncalibrated; peak positions can still be saved.</p>
      <div className="xrd-digitizer-calibration">
        <label>Y tick A value<input inputMode="decimal" value={yValueA} onChange={(event) => setYValueA(event.currentTarget.value)} /></label>
        <ActionButton small text={draft.yPixelA ? "Reset Y tick A" : "Set Y tick A on source"} disabled={!regionReady} onClick={() => { if (draft.yPixelA) onDraftChange({ ...draft, yPixelA: null }); else onCaptureMode("y-tick-a"); }} />
        <label>Y tick B value<input inputMode="decimal" value={yValueB} onChange={(event) => setYValueB(event.currentTarget.value)} /></label>
        <ActionButton small text={draft.yPixelB ? "Reset Y tick B" : "Set Y tick B on source"} disabled={!regionReady} onClick={() => { if (draft.yPixelB) onDraftChange({ ...draft, yPixelB: null }); else onCaptureMode("y-tick-b"); }} />
      </div>
      <label>Intensity unit status<select value={yUnitStatus} onChange={(event) => setYUnitStatus(event.currentTarget.value as typeof yUnitStatus)}><option value="ARBITRARY">Arbitrary units</option><option value="SOURCE_DEFINED">Unit printed in source</option></select></label>
      {yUnitStatus === "SOURCE_DEFINED" ? <label>Printed unit<input value={ySourceUnit} onChange={(event) => setYSourceUnit(event.currentTarget.value)} /></label> : null}
      {yCalibrationPartial ? <p className="xrd-digitizer-warning">Finish both Y tick locations and values or clear the partial calibration.</p> : null}
    </details>
    <fieldset className="xrd-digitizer-points"><legend>Manual point capture</legend>
      <label>Point type<select value={pointMode} onChange={(event) => { const next = event.currentTarget.value as typeof pointMode; if (next !== pointMode && draft.points.length) onDraftChange({ ...draft, points: [] }); setPointMode(next); }}>{/* A point order has one meaning for the entire immutable session. */}<option value="PEAK_PICKING">Peak picking</option><option value="CURVE_POINTS">Curve points</option></select></label>
      <div className="phase7-actions">
        <ActionButton small text={captureMode === "peaks" || captureMode === "curve" ? "Finish point capture" : pointMode === "PEAK_PICKING" ? "Pick peak maxima" : "Trace curve points"} disabled={!xReady} onClick={() => onCaptureMode(captureMode === "peaks" || captureMode === "curve" ? "off" : pointMode === "PEAK_PICKING" ? "peaks" : "curve")} />
        <ActionButton small text="Clear points" disabled={draft.points.length === 0} onClick={() => onDraftChange({ ...draft, points: [] })} />
      </div>
      {sourcePoints.length ? <div className="xrd-digitizer-point-list" aria-label="Digitized point preview">{sourcePoints.map((point, index) => <div key={`${index}:${point.source_pixel.x}:${point.source_pixel.y}`}><span>{index + 1}</span><strong>{point.two_theta_degree?.toFixed(3) ?? "—"}°</strong><small>{point.intensity === null ? "intensity omitted" : `${point.intensity.toPrecision(4)} ${yUnitStatus === "ARBITRARY" ? "a.u." : ySourceUnit}`}</small></div>)}</div> : <p className="table-empty">No graph values are saved until you explicitly commit this draft.</p>}
      {yCalibrationPartial ? null : <ActionButton text={busy ? "Committing…" : "Commit DIGITIZED dataset"} disabled={!canCommit} onClick={() => void commit()} />}
      {message ? <p className="xrd-digitizer-message" role="status">{message}</p> : null}
      {draft.points.length > 0 && !pointValuesValid ? <p className="xrd-digitizer-warning">One or more calibrated points are invalid. Check that all points are inside the graph region and the X ticks are correct.</p> : null}
    </fieldset>
    <p className="xrd-digitizer-authority">Source class will be DIGITIZED. The original PDF and independently EXTRACTED textual peaks remain separate.</p>
  </section>;
}

function DlsDigitizationWorkbench({
  projectId, document, candidate, draft, captureMode, onCaptureMode, onDraftChange, onCommitted,
}: {
  projectId: string;
  document: ScientificDocument;
  candidate: EvidenceCandidate;
  draft: XrdDigitizerDraft;
  captureMode: XrdDigitizerCaptureMode;
  onCaptureMode: (mode: XrdDigitizerCaptureMode) => void;
  onDraftChange: (draft: XrdDigitizerDraft) => void;
  onCommitted: (dataset: ExperimentalDatasetView) => void;
}) {
  const [xA, setXA] = useState("1");
  const [xB, setXB] = useState("1000");
  const [yA, setYA] = useState("0");
  const [yB, setYB] = useState("25");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const frame = draft.sourceFrame;
  const region = draft.region;
  const numeric = [xA, xB, yA, yB].map(Number);
  const ready = Boolean(frame?.page === 7 && region && draft.xPixelA && draft.xPixelB && draft.yPixelA && draft.yPixelB
    && numeric.every(Number.isFinite) && numeric[0]! > 0 && numeric[1]! > 0 && numeric[0] !== numeric[1]
    && numeric[2]! < numeric[3]! && draft.xPixelA.x !== draft.xPixelB.x && draft.yPixelA.y !== draft.yPixelB.y);
  const regionReady = Boolean(frame?.page === 7 && region && region.width > 1 && region.height > 1
    && region.x + region.width <= frame.pixelWidth && region.y + region.height <= frame.pixelHeight);
  const mappedPoints = draft.points.map((point) => {
    if (!ready || !draft.xPixelA || !draft.xPixelB || !draft.yPixelA || !draft.yPixelB) return null;
    const xf = (point.x - draft.xPixelA.x) / (draft.xPixelB.x - draft.xPixelA.x);
    const yf = (point.y - draft.yPixelA.y) / (draft.yPixelB.y - draft.yPixelA.y);
    return { x: 10 ** (Math.log10(numeric[0]!) + xf * (Math.log10(numeric[1]!) - Math.log10(numeric[0]!))), y: numeric[2]! + yf * (numeric[3]! - numeric[2]!) };
  });
  const canCommit = ready && regionReady && draft.points.length > 1 && mappedPoints.every((point) => point && Number.isFinite(point.x) && point.x > 0 && point.y >= 0 && point.y <= 100) && !busy;
  async function commit() {
    if (!canCommit || !frame || !region || !draft.xPixelA || !draft.xPixelB || !draft.yPixelA || !draft.yPixelB) return;
    setBusy(true); setMessage(null);
    try {
      const payload: GraphDigitizedDatasetInput = {
        experiment_name: "Figure 4 DLS · DIGITIZED",
        source_document_sha256: document.sha256,
        source_render_sha256: frame.renderSha256,
        source_render_version: frame.renderVersion,
        source_render_scale: frame.scale,
        source_pixel_width: frame.pixelWidth,
        source_pixel_height: frame.pixelHeight,
        plot_region: region,
        x_calibration: { pixel_a: draft.xPixelA, pixel_b: draft.xPixelB, value_a: numeric[0]!, value_b: numeric[1]!, label: "Diameter", unit: "nm", scale: "log" },
        y_calibration: { pixel_a: draft.yPixelA, pixel_b: draft.yPixelB, value_a: numeric[2]!, value_b: numeric[3]!, label: "q", unit: "%", scale: "linear" },
        point_mode: "HISTOGRAM_POINTS",
        points: draft.points.map((source_pixel) => ({ source_pixel })) as GraphDigitizedDatasetInput["points"],
      };
      const dataset = await createGraphDigitizedDataset(projectId, candidate.id, payload);
      onCommitted(dataset);
      setMessage(`Saved DIGITIZED dataset · ${dataset.point_count} points · V${dataset.digitization_session?.revision ?? 1}.`);
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
    } catch (error) { setMessage(error instanceof Error ? error.message : "DLS dataset could not be saved."); }
    finally { setBusy(false); }
  }
  const setValue = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => setter(event.currentTarget.value);
  return <section className="xrd-digitizer" aria-label="Figure 4 DLS digitization workbench">
    <div className="xrd-digitizer-heading"><div><h3>Figure 4 · DLS distribution</h3><p>{document.title ?? "Source document"} · page 7 · Figure 4 · {candidate.review_state}</p></div><strong>{canCommit ? "READY TO SAVE" : "CALIBRATION REQUIRED"}</strong></div>
    <p className="xrd-digitizer-source-note">Source axes: Diameter (nm), logarithmic; q (%), linear. The right-hand “Undersize” axis is not digitized. No distribution type or DLS intensity is inferred.</p>
    <div className="xrd-digitizer-region-control"><span>{captureMode === "region-first" ? "Click the graph’s top-left corner." : captureMode === "region-second" ? "Click the opposite corner." : captureMode === "curve" ? "Click representative histogram points." : "Define the graph region on the rendered page."}</span><ActionButton small text={regionReady ? "Redefine graph region" : "Define graph region"} disabled={!frame || frame.page !== 7} onClick={() => onCaptureMode(captureMode.startsWith("region-") ? "off" : "region-first")} /></div>
    {regionReady ? <p className="xrd-digitizer-region-label">User-defined region · {Math.round(region!.width)} × {Math.round(region!.height)} source pixels</p> : null}
    <fieldset className="xrd-digitizer-calibration"><legend>X calibration · Diameter (nm) · logarithmic</legend>
      <label>First tick<input value={xA} onChange={setValue(setXA)} /></label><ActionButton small text={draft.xPixelA ? "Reset tick" : "Set tick on source"} disabled={!regionReady} onClick={() => draft.xPixelA ? onDraftChange({ ...draft, xPixelA: null }) : onCaptureMode("x-tick-a")} />
      <label>Second tick<input value={xB} onChange={setValue(setXB)} /></label><ActionButton small text={draft.xPixelB ? "Reset tick" : "Set tick on source"} disabled={!regionReady} onClick={() => draft.xPixelB ? onDraftChange({ ...draft, xPixelB: null }) : onCaptureMode("x-tick-b")} />
    </fieldset>
    <fieldset className="xrd-digitizer-calibration"><legend>Y calibration · q (%) · linear</legend>
      <label>First tick<input value={yA} onChange={setValue(setYA)} /></label><ActionButton small text={draft.yPixelA ? "Reset tick" : "Set tick on source"} disabled={!regionReady} onClick={() => draft.yPixelA ? onDraftChange({ ...draft, yPixelA: null }) : onCaptureMode("y-tick-a")} />
      <label>Second tick<input value={yB} onChange={setValue(setYB)} /></label><ActionButton small text={draft.yPixelB ? "Reset tick" : "Set tick on source"} disabled={!regionReady} onClick={() => draft.yPixelB ? onDraftChange({ ...draft, yPixelB: null }) : onCaptureMode("y-tick-b")} />
    </fieldset>
    <fieldset className="xrd-digitizer-points"><legend>Manual histogram points</legend><div className="phase7-actions"><ActionButton small text={captureMode === "curve" ? "Finish point capture" : "Capture distribution points"} disabled={!ready} onClick={() => onCaptureMode(captureMode === "curve" ? "off" : "curve")} /><ActionButton small text="Clear points" disabled={!draft.points.length} onClick={() => onDraftChange({ ...draft, points: [] })} /></div>
      {mappedPoints.length ? <div className="xrd-digitizer-point-list">{mappedPoints.map((point, i) => <div key={i}><span>{i + 1}</span><strong>{point ? `${Number(point.x.toPrecision(5))} nm` : "—"}</strong><small>{point ? `q ${point.y.toFixed(2)}%` : "calibrate axes"}</small></div>)}</div> : <p className="table-empty">No graph points captured.</p>}
      <ActionButton text={busy ? "Committing…" : "Commit DIGITIZED dataset"} disabled={!canCommit} onClick={() => void commit()} />{message ? <p role="status">{message}</p> : null}
    </fieldset>
  </section>;
}

function DigitizerPanel({
  projectId,
  document,
  candidate,
  latestPoint,
  onDigitized,
}: {
  projectId: string;
  document: ScientificDocument;
  candidate: EvidenceCandidate;
  latestPoint: DigitizerPoint | null;
  onDigitized: (dataset: ExperimentalDatasetView) => void;
}) {
  const [points, setPoints] = useState<DigitizerPoint[]>([]);
  const [xUnit, setXUnit] = useState("unitless");
  const [yUnit, setYUnit] = useState("unitless");
  const [xMax, setXMax] = useState("100");
  const [yMax, setYMax] = useState("100");
  const anchor = candidate.source_anchor;
  useEffect(() => {
    if (latestPoint) queueMicrotask(() => setPoints((current) => [...current, latestPoint].slice(-200)));
  }, [latestPoint]);
  if (!anchor) return null;
  const sourceAnchor = anchor;
  const calibration = {
    xAxis: { pixelA: { x: 0, y: 100 }, pixelB: { x: 100, y: 100 }, valueA: 0, valueB: Number(xMax), scale: "linear" as const },
    yAxis: { pixelA: { x: 0, y: 100 }, pixelB: { x: 0, y: 0 }, valueA: 0, valueB: Number(yMax), scale: "linear" as const },
  };
  const scientificPoints = points.map((point) => calibratedPoint(point, calibration));
  async function commitDigitized() {
    const firstPoint = scientificPoints[0];
    if (!firstPoint) return;
    const dataset = await createDigitizedDataset(projectId, candidate.id, {
      modality: "OTHER",
      experiment_name: `Digitized ${candidate.evidence_type}`,
      calibration: {
        page: sourceAnchor.page_number,
        figure_region: sourceAnchor,
        plot_bounds: { x: sourceAnchor.x ?? 0, y: sourceAnchor.y ?? 0, width: sourceAnchor.width ?? 1, height: sourceAnchor.height ?? 1 },
        x_pixel_a: calibration.xAxis.pixelA,
        x_pixel_b: calibration.xAxis.pixelB,
        x_value_a: calibration.xAxis.valueA,
        x_value_b: calibration.xAxis.valueB,
        y_pixel_a: calibration.yAxis.pixelA,
        y_pixel_b: calibration.yAxis.pixelB,
        y_value_a: calibration.yAxis.valueA,
        y_value_b: calibration.yAxis.valueB,
        x_scale: "linear",
        y_scale: "linear",
        x_unit: xUnit,
        y_unit: yUnit,
        x_label: "x",
        y_label: "y",
      },
      points: [firstPoint, ...scientificPoints.slice(1)],
    });
    onDigitized(dataset);
  }
  return (
    <div className="phase7-digitizer">
      <h3>Manual digitizer</h3>
      <p>Click points on the rendered PDF page, declare axes, and commit an approximate DIGITIZED dataset.</p>
      <div className="phase7-digitizer-controls">
        <label>X max<input value={xMax} onChange={(event) => setXMax(event.currentTarget.value)} /></label>
        <label>X unit<input value={xUnit} onChange={(event) => setXUnit(event.currentTarget.value)} /></label>
        <label>Y max<input value={yMax} onChange={(event) => setYMax(event.currentTarget.value)} /></label>
        <label>Y unit<input value={yUnit} onChange={(event) => setYUnit(event.currentTarget.value)} /></label>
      </div>
      <p className="table-empty">{scientificPoints.length} point{scientificPoints.length === 1 ? "" : "s"} captured from {document.title ?? "document"}.</p>
      <div className="phase7-actions">
        <ActionButton small text="Clear points" disabled={points.length === 0} onClick={() => setPoints([])} />
        <ActionButton small text="Commit digitized dataset" disabled={points.length === 0} onClick={() => void commitDigitized()} />
      </div>
    </div>
  );
}

function DatasetPreview({ dataset, detailed = false }: { dataset: ExperimentalDatasetView; detailed?: boolean }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<EChartsInstance | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const session = dataset.digitization_session;
  const xrd = session && "reported_peaks" in session ? session : null;
  const graph = session && "point_mode" in session && session.point_mode === "HISTOGRAM_POINTS" ? session : null;
  const isXrd = Boolean(xrd);
  useEffect(() => {
    if (!chartRef.current) return;
    let disposed = false;
    let chart: ReturnType<EChartsModule["init"]> | null = null;
    void (async () => {
      const echarts = await import("echarts") as unknown as EChartsModule;
      if (!chartRef.current || disposed) return;
      chart = echarts.init(chartRef.current);
      chartInstanceRef.current = chart;
      if (graph) {
        const points = graph.points.map((point, index) => ({ name: `Point ${index + 1}`, value: [point.x_value, point.y_value], pointIndex: index, sourcePixel: point.source_pixel }));
        chart.setOption({ animation: false,
          grid: { left: 72, right: 28, top: 24, bottom: detailed ? 62 : 32 },
          legend: { show: detailed, data: ["Digitized Figure 4 · q (%)"], bottom: 0 },
          tooltip: { trigger: "item", formatter: (params: { data?: { value?: number[]; sourcePixel?: { x: number; y: number } } }) => {
            const value = params.data?.value ?? [];
            return `Diameter ${Number(value[0]).toPrecision(5)} nm<br>q ${Number(value[1]).toFixed(3)}%<br>Source pixel (${params.data?.sourcePixel?.x.toFixed(1)}, ${params.data?.sourcePixel?.y.toFixed(1)})`;
          } },
          dataZoom: detailed ? [{ type: "inside", filterMode: "none" }, { type: "slider", height: 14, bottom: 28, filterMode: "none" }] : [],
          xAxis: { type: "log", logBase: 10, name: "Diameter / nm", nameLocation: "middle", nameGap: 28, scale: true },
          yAxis: { type: "value", name: "q / %", min: 0, scale: true },
          series: [{ name: "Digitized Figure 4 · q (%)", type: "line", step: "middle", showSymbol: true,
            symbolSize: detailed ? 8 : 5, data: points, itemStyle: { color: "#b77925" }, lineStyle: { color: "#b77925", width: 2 } }],
        });
        chart.on("click", (params: { data?: { pointIndex?: number } }) => { if (typeof params.data?.pointIndex === "number") setSelectedPoint(params.data.pointIndex); });
        return;
      }
      if (xrd) {
        const points = xrd.points;
        const intensityAvailable = xrd.y_calibration !== null;
        const plotPoints = points.map((point, index) => ({
          name: `Point ${index + 1}`,
          value: [point.two_theta_degree, intensityAvailable ? point.intensity : 0],
          pointIndex: index,
          sourcePixel: point.source_pixel,
        }));
        chart.setOption({
          animation: false,
          grid: { left: 64, right: 58, top: 26, bottom: detailed ? 76 : 38 },
          legend: { show: detailed, data: [xrd.point_mode === "PEAK_PICKING" ? "Digitized peaks" : "Digitized curve", "Reported peaks from paper text"], bottom: 2 },
          tooltip: { trigger: "item", formatter: (params: { data?: { value?: number[]; pointIndex?: number; sourcePixel?: { x: number; y: number } } }) => {
            const data = params.data;
            if (!data?.value) return "Reported peak from paper text";
            const [theta, intensity] = data.value;
            return `2θ ${Number(theta).toFixed(3)}°${intensityAvailable ? `<br>Intensity ${Number(intensity).toPrecision(5)}` : "<br>Peak position only; intensity not calibrated"}<br>Source pixel (${data.sourcePixel?.x.toFixed(1)}, ${data.sourcePixel?.y.toFixed(1)})`;
          } },
          dataZoom: detailed ? [{ type: "inside", filterMode: "none" }, { type: "slider", height: 14, bottom: 36, filterMode: "none" }] : [],
          xAxis: { type: "value", name: "2θ / degree", nameLocation: "middle", nameGap: 30, scale: true },
          yAxis: intensityAvailable
            ? { type: "value", name: `Intensity (${xrd.y_unit_status === "ARBITRARY" ? "a.u." : xrd.y_calibration?.unit})`, scale: true }
            : { type: "value", show: false, min: -1, max: 1 },
          series: [
            {
              name: xrd.point_mode === "PEAK_PICKING" ? "Digitized peaks" : "Digitized curve",
              type: xrd.point_mode === "PEAK_PICKING" || !intensityAvailable ? "scatter" : "line",
              showSymbol: true,
              symbolSize: detailed ? 9 : 5,
              data: plotPoints,
              itemStyle: { color: "#b77925" },
              lineStyle: { color: "#b77925", width: 2 },
            },
            {
              name: "Reported peaks from paper text",
              type: "scatter",
              data: [],
              itemStyle: { color: "#7656a5" },
              markLine: {
                symbol: "none", silent: true, lineStyle: { color: "#7656a5", type: "dashed", width: 1 },
                label: { color: "#614587", fontSize: 10, formatter: (item: { name?: string }) => item.name ?? "reported" },
                data: (xrd.reported_peaks ?? []).map((peak, index) => ({ xAxis: peak.two_theta_degree, name: `R${index + 1}` })),
              },
            },
          ],
        });
        chart.on("click", (params: { data?: { pointIndex?: number } }) => {
          if (typeof params.data?.pointIndex === "number") setSelectedPoint(params.data.pointIndex);
        });
        return;
      }
      const firstRow = dataset.values[0] ?? {};
      const keys = Object.keys(firstRow);
      const xKey = keys[0];
      const yKey = keys[1];
      chart.setOption({
        animation: false,
        grid: { left: 34, right: 12, top: 16, bottom: 26 },
        xAxis: { type: "value", name: dataset.axes[0]?.label },
        yAxis: { type: "value", name: dataset.axes[1]?.label },
        series: xKey && yKey ? [{ type: "line", showSymbol: true, data: dataset.values.map((row) => [row[xKey], row[yKey]]) }] : [],
      });
    })();
    return () => {
      disposed = true;
      chartInstanceRef.current = null;
      chart?.dispose();
    };
  }, [dataset, detailed, graph, session, xrd]);
  const selected = selectedPoint === null ? null : xrd?.points[selectedPoint] ?? null;
  const selectedGraphPoint = selectedPoint === null ? null : graph?.points[selectedPoint] ?? null;
  const sampledGraphPeak = graph?.points.reduce((peak, point) => point.y_value > peak.y_value ? point : peak, graph.points[0]!);
  const axisValue = (point: { x: number; y: number }, axis: NonNullable<typeof xrd>["x_calibration"], dimension: "x" | "y") => {
    const a = axis.pixel_a[dimension];
    const b = axis.pixel_b[dimension];
    return axis.value_a + (point[dimension] - a) * (axis.value_b - axis.value_a) / (b - a);
  };
  return (
    <div className={`phase7-dataset-card${isXrd && detailed ? " phase7-xrd-review" : ""}`}>
      <strong>{graph ? `Figure ${graph.figure_number} DLS · DIGITIZED · V${graph.revision}` : xrd ? `Figure ${xrd.figure_number} XRD · DIGITIZED · V${xrd.revision}` : dataset.name}</strong>
      <span>{dataset.modality} · {dataset.source_class} · {dataset.state} · {dataset.point_count} points</span>
      {session ? <div className="xrd-review-toolbar"><span>{graph ? "Diameter (nm), logarithmic · q (%), source-defined" : xrd?.y_calibration ? `Intensity calibrated · ${xrd.y_unit_status === "ARBITRARY" ? "arbitrary units" : xrd.y_calibration.unit}` : "Peak positions only; marker height is not intensity."}</span><button type="button" onClick={() => chartInstanceRef.current?.dispatchAction({ type: "dataZoom", start: 0, end: 100 })}>Reset zoom</button></div> : null}
      <div ref={chartRef} className="phase7-chart" />
      {graph && detailed ? <>
        <div className="xrd-digitizer-point-list" aria-label="Digitized DLS point selector">{graph.points.map((point, index) => { const label = formatDigitizedDlsPoint(index, point.x_value, point.y_value); return <button type="button" key={index} aria-label={`Select point ${label}`} aria-pressed={selectedPoint === index} onClick={() => setSelectedPoint(index)}><span>{label}</span></button>; })}</div>
        <section className="xrd-peak-comparison"><strong>Source semantics · EXTRACTED claims remain separate</strong>
          <div><span>Reported in prose · EXTRACTED · page 2</span><span>Particle-size range 800–2000 nm; hydrodynamic radius 1482.3 nm. Source record c19cd4e7-d94a-444e-bdc5-06d3c92bf968</span></div>
          <div><span>Reported in table · EXTRACTED · page 8</span><span>Hydrodynamic diameter dH: mean 1496.1 nm · median 1428.3 nm · mode 1588.2 nm. Source record 7230bc32-c5ce-44ad-854b-7a813d12d8d7</span></div>
          <div><span>Digitized Figure 4 · DIGITIZED</span><span>Diameter (nm) versus q (%); highest sampled point ≈ {sampledGraphPeak ? Number(sampledGraphPeak.x_value.toPrecision(5)) : null} nm at q ≈ {sampledGraphPeak?.y_value.toFixed(2)}%.</span></div>
          <small>The prose reports a hydrodynamic radius; the table reports hydrodynamic diameter statistics. These claims are not directly comparable without an explicit reconciliation. The printed 800–2000 nm range wording is preserved, and no radius-to-diameter conversion is applied.</small>
        </section>
        {selectedGraphPoint ? <section className="xrd-point-inspector"><strong>Selected digitized point {selectedPoint! + 1}</strong><span>Diameter {Number(selectedGraphPoint.x_value.toPrecision(6))} nm</span><span>q {selectedGraphPoint.y_value.toFixed(4)}%</span><span>Source pixel ({selectedGraphPoint.source_pixel.x.toFixed(1)}, {selectedGraphPoint.source_pixel.y.toFixed(1)})</span><span>Figure 4 · page 7 · revision V{graph.revision}</span><span>X calibration {graph.x_calibration.value_a}–{graph.x_calibration.value_b} nm · logarithmic</span><span>Y calibration {graph.y_calibration.value_a}–{graph.y_calibration.value_b} % · linear</span><span>Dataset SHA-256 {graph.dataset_sha256}</span><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("chemdft:xrd-view-source", { detail: { documentId: graph.source_document_id, evidenceId: graph.source_evidence_id, page: graph.page_number, session: graph, selectedPointIndex: selectedPoint } }))}>View Figure 4 source</button></section> : <p className="xrd-point-hint">Select a plotted point to inspect its source pixel and calibration provenance.</p>}
        <details className="xrd-provenance"><summary>Dataset and source provenance</summary><dl>
          <div><dt>Source document</dt><dd>{graph.source_document_id}</dd></div><div><dt>Page / figure</dt><dd>Page {graph.page_number} · Figure {graph.figure_number}</dd></div>
          <div><dt>Source artifact SHA-256</dt><dd title={graph.source_artifact_sha256}>{graph.source_artifact_sha256.slice(0, 14)}…</dd></div><div><dt>Rendered page SHA-256</dt><dd title={graph.source_render_sha256}>{graph.source_render_sha256.slice(0, 14)}… · {graph.source_render_version}</dd></div>
          <div><dt>Region</dt><dd>{graph.plot_region.x.toFixed(1)}, {graph.plot_region.y.toFixed(1)} · {graph.plot_region.width.toFixed(1)} × {graph.plot_region.height.toFixed(1)} px (user-defined)</dd></div><div><dt>Calibration</dt><dd>{graph.x_calibration.value_a}–{graph.x_calibration.value_b} nm log · {graph.y_calibration.value_a}–{graph.y_calibration.value_b}% linear</dd></div>
          <div><dt>Operator / revision</dt><dd>{graph.operator_id} · V{graph.revision}</dd></div><div><dt>Dataset SHA-256</dt><dd title={graph.dataset_sha256}>{graph.dataset_sha256.slice(0, 14)}…</dd></div>
        </dl></details>
      </> : null}
      {xrd && detailed ? <>
        <div className="xrd-peak-comparison"><strong>Reported textual peaks · chart markers R1–R{(xrd.reported_peaks ?? []).length}</strong>{(xrd.reported_peaks ?? []).map((peak, index) => {
          const nearest = xrd.points.reduce((best, point, index) => Math.abs(point.two_theta_degree - peak.two_theta_degree) < Math.abs(best.point.two_theta_degree - peak.two_theta_degree) ? { point, index } : best, { point: xrd.points[0]!, index: 0 });
          return <div key={peak.evidence_id} title={`R${index + 1}: ${peak.two_theta_degree.toFixed(3)}° reported`}><span>R{index + 1} · {peak.two_theta_degree.toFixed(3)}° · EXTRACTED</span><span>nearest {nearest.point.two_theta_degree.toFixed(3)}° · Δ2θ {Math.abs(nearest.point.two_theta_degree - peak.two_theta_degree).toFixed(3)}°</span></div>;
        })}</div>
        {selected ? <section className="xrd-point-inspector"><strong>Selected digitized point {selectedPoint! + 1}</strong><span>2θ {selected.two_theta_degree.toFixed(4)}°</span><span>{selected.intensity == null ? "Intensity absent" : `Intensity ${selected.intensity.toPrecision(5)} ${xrd.y_unit_status === "ARBITRARY" ? "a.u." : xrd.y_calibration?.unit}`}</span><span>Source pixel ({selected.source_pixel.x.toFixed(1)}, {selected.source_pixel.y.toFixed(1)})</span><span>Figure {xrd.figure_number} · page {xrd.page_number} · session V{xrd.revision}</span><span>{`X calibration: ${axisValue(xrd.x_calibration.pixel_a, xrd.x_calibration, "x").toFixed(2)}° to ${axisValue(xrd.x_calibration.pixel_b, xrd.x_calibration, "x").toFixed(2)}°`}</span><span>Dataset SHA-256 {xrd.dataset_sha256}</span><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("chemdft:xrd-view-source", { detail: { documentId: xrd.source_document_id, evidenceId: xrd.source_evidence_id, page: xrd.page_number, session: xrd, selectedPointIndex: selectedPoint } }))}>View source</button></section> : <p className="xrd-point-hint">Select a plotted point to inspect its source pixel and calibration provenance.</p>}
        <details className="xrd-provenance"><summary>Dataset and source provenance</summary><dl>
          <div><dt>Source document</dt><dd>{xrd.source_document_id}</dd></div><div><dt>Page / figure</dt><dd>Page {xrd.page_number} · Figure {xrd.figure_number}</dd></div>
          <div><dt>Source artifact SHA-256</dt><dd title={xrd.source_artifact_sha256}>{xrd.source_artifact_sha256.slice(0, 14)}…</dd></div><div><dt>Rendered page SHA-256</dt><dd title={xrd.source_render_sha256}>{xrd.source_render_sha256.slice(0, 14)}… · {xrd.source_render_version}</dd></div>
          <div><dt>Region</dt><dd>{xrd.plot_region.x.toFixed(1)}, {xrd.plot_region.y.toFixed(1)} · {xrd.plot_region.width.toFixed(1)} × {xrd.plot_region.height.toFixed(1)} px (user-defined)</dd></div><div><dt>Calibration</dt><dd>2θ {axisValue(xrd.x_calibration.pixel_a, xrd.x_calibration, "x").toFixed(2)}–{axisValue(xrd.x_calibration.pixel_b, xrd.x_calibration, "x").toFixed(2)}°{xrd.y_calibration ? ` · intensity ${xrd.y_calibration.value_a}–${xrd.y_calibration.value_b} ${xrd.y_calibration.unit}` : " · intensity uncalibrated"}</dd></div>
          <div><dt>Operator / revision</dt><dd>{xrd.operator_id} · V{xrd.revision}</dd></div><div><dt>Dataset SHA-256</dt><dd title={xrd.dataset_sha256}>{xrd.dataset_sha256.slice(0, 14)}…</dd></div>
        </dl></details>
      </> : null}
    </div>
  );
}

function formatPayload(payload: Record<string, unknown>): string {
  const value = payload.reported_value ?? payload.normalized_value ?? payload.caption ?? payload.quantity ?? payload.parameter;
  if (typeof value === "number") return `${formatNumber(value)} ${String(payload.reported_unit ?? "")}`.trim();
  if (typeof value === "string") return value.length > 140 ? `${value.slice(0, 140)}…` : value;
  return "Structured payload";
}

function detectFormat(filename: string): string {
  const extension = filename.split(".").pop()?.toUpperCase();
  return ["SDF", "MOL", "XYZ", "CIF", "PDF", "CSV", "TSV", "XY"].includes(extension ?? "") ? extension ?? "SDF" : "SDF";
}

function formatNumber(value: number): string {
  return formatScientificNumber(value);
}

function formatDate(value: string | null | undefined): string {
  return formatTimestamp(value);
}

function shortId(value?: string | null): string {
  return value ? value.slice(0, 8) : "—";
}
