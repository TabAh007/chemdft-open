"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AppPopover } from "@chemdft/ui";
import type { CalculationExportCatalog } from "@chemdft/schemas";

import {
  downloadProject3dPdf,
  downloadProjectArchive,
  downloadProjectHtml,
  downloadProjectReportPdf,
  downloadStructureFile,
  fetchExportCapabilities,
  type ExportCapabilities,
} from "@/lib/project-export-api";
import {
  downloadCalculationExport,
  getExportCatalog,
} from "@/lib/analysis-api";
import { saveBlob } from "@/lib/download";
import { Export3dPdfDialog } from "./export-3d-pdf-dialog";
import { ShareDialog } from "./share-dialog";
import { SnapshotDialog } from "./snapshot-dialog";
import styles from "./export-share.module.css";

export type ExportGroupKey = "SHARE_AND_READ" | "STRUCTURE_DATA" | "PICTURES_AND_TABLES" | "PROJECT_ZIP";

export const EXPORT_GROUPS_ORDER: readonly { key: ExportGroupKey; label: string }[] = [
  { key: "SHARE_AND_READ", label: "Share and read" },
  { key: "STRUCTURE_DATA", label: "Structure data" },
  { key: "PICTURES_AND_TABLES", label: "Pictures and tables" },
  { key: "PROJECT_ZIP", label: "Whole project .zip" },
];

export interface UnifiedExportItem {
  id: string;
  group: ExportGroupKey;
  label: string;
  subtext: string;
  disabled?: boolean | undefined;
  disabledReason?: string | undefined;
  badge?: "AVAILABLE" | "IN TESTING" | "PLANNED" | string | undefined;
  badgeTestId?: string | undefined;
  testId?: string | undefined;
  runTestId?: string | undefined;
  onSelect: () => void | Promise<void>;
}

export type ExportContextKind = "project" | "structure" | "drawing" | "result" | "comparison";

export interface BaseExportMenuProps {
  context: ExportContextKind;
  className?: string | undefined;
  buttonClassName?: string | undefined;
  testId?: string | undefined;
  buttonTestId?: string | undefined;
  dropdownTestId?: string | undefined;
  disabled?: boolean | undefined;
  disabledReason?: string | undefined;
  showShare?: boolean | undefined;
  onShare?: (() => void) | undefined;
  shareTestId?: string | undefined;
}

export interface ProjectExportProps extends BaseExportMenuProps {
  context: "project";
  projectId: string;
  projectName?: string | undefined;
  structureLabel?: string | null | undefined;
  structureId?: string | null | undefined;
  structureVersionId?: string | null | undefined;
  formula?: string | undefined;
  atomCount?: number | undefined;
  authority?: "CALCULATED" | "USER_ENTERED · NOT OPTIMIZED" | undefined;
}

export interface StructureExportProps extends BaseExportMenuProps {
  context: "structure";
  projectId: string;
  structureId?: string | null | undefined;
  structureVersionId?: string | null | undefined;
  structureName?: string | null | undefined;
  formula?: string | undefined;
  atomCount?: number | undefined;
  authority?: "CALCULATED" | "USER_ENTERED · NOT OPTIMIZED" | undefined;
  isPeriodic?: boolean | undefined;
  onExportFile?: ((format: "XYZ" | "SDF" | "MOL" | "SMILES" | "CIF") => Promise<void> | void) | undefined;
  onExportImage?: (() => void) | undefined;
}

export interface DrawingExportProps extends BaseExportMenuProps {
  context: "drawing";
  hasCandidate: boolean;
  drawingEmpty: boolean;
  ready: boolean;
  structureName?: string | undefined;
  onExportHtml: () => Promise<void> | void;
  onExportPdf: () => Promise<void> | void;
  onExport3dPdf?: (() => void) | undefined;
  onExportXyz: () => void;
  onExportStructureFile: (format: "sdf" | "mol" | "smi") => Promise<void> | void;
  onExportArchive: () => Promise<void> | void;
  onExportImage: (format: "svg" | "png") => Promise<void> | void;
}

export interface ResultExportProps extends BaseExportMenuProps {
  context: "result";
  projectId: string;
  calculationId: string;
  resultId?: string | undefined;
  structureLabel?: string | undefined;
  onExportImage?: (() => void) | undefined;
}

export interface ComparisonExportProps extends BaseExportMenuProps {
  context: "comparison";
  canCompare?: boolean | undefined;
  unavailableCount?: number | undefined;
  onExport: (kind: "csv" | "json" | "report-html" | "report-markdown" | "report-json") => void;
}

export type ExportMenuProps =
  | ProjectExportProps
  | StructureExportProps
  | DrawingExportProps
  | ResultExportProps
  | ComparisonExportProps;

export function ExportMenu(props: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [is3dPdfOpen, setIs3dPdfOpen] = useState(false);
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareSummary, setShareSummary] = useState("");
  const [shareFilename, setShareFilename] = useState<string | undefined>(undefined);
  const [capabilities, setCapabilities] = useState<ExportCapabilities>({
    export_3d_pdf_available: false,
    export_3d_pdf_reason: "Requires Asymptote server toolchain and Adobe Acrobat on client (IN TESTING).",
    export_report_pdf_available: true,
    export_html_available: true,
    export_archive_available: true,
  });

  // For result context: fetch catalog
  const [resultCatalog, setResultCatalog] = useState<CalculationExportCatalog | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const reasonIdPrefix = useId();

  useEffect(() => {
    if (props.context === "project" || props.context === "structure") {
      void fetchExportCapabilities().then((caps) => setCapabilities(caps));
    }
  }, [props.context]);

  const isResultContext = props.context === "result";
  const resultCalculationId = isResultContext ? props.calculationId : undefined;
  const resultProjectId = isResultContext ? props.projectId : undefined;

  useEffect(() => {
    if (isResultContext && resultCalculationId && resultProjectId) {
      void getExportCatalog(resultProjectId, resultCalculationId)
        .then((cat) => setResultCatalog(cat))
        .catch(() => setResultCatalog(null));
    }
  }, [isResultContext, resultCalculationId, resultProjectId]);

  // Focus management
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"]):not(:disabled)') ??
        menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
      first?.focus();
    }, 10);
    return () => window.clearTimeout(timer);
  }, [open]);

  function handleMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const index = items.indexOf(active!);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = index < items.length - 1 ? index + 1 : 0;
      items[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = index > 0 ? index - 1 : items.length - 1;
      items[prev]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  function handleButtonKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  // Active structure / display details
  const activeStructureName = useMemo(() => {
    if (props.context === "project") {
      return (props.structureLabel ? props.structureLabel.split(" · ")[0] : null) || props.projectName || "Active Structure";
    }
    if (props.context === "structure") {
      return props.structureName || "Active Structure";
    }
    if (props.context === "drawing") {
      return props.structureName || "Drawn Molecule";
    }
    if (props.context === "result") {
      return props.structureLabel || "Result Structure";
    }
    return "Comparison";
  }, [props]);

  const flashStatus = useCallback((msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 3500);
  }, []);

  const handleDownloadSnapshot = useCallback((
    scale: 1 | 2 | 4,
    background: "white" | "transparent",
    options?: {
      cropToContent?: boolean;
      showLegend?: boolean;
      showTriad?: boolean;
      showCellLabels?: boolean;
      showPolyhedra?: boolean;
      showCellOutline?: boolean;
      bondColorMode?: "split" | "uniform";
      addCreditLine?: boolean;
    },
  ) => {
    const cleanName = (activeStructureName || "structure").toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    window.dispatchEvent(
      new CustomEvent("chemdft:export-3d-snapshot", {
        detail: {
          scale,
          background,
          filename: cleanName,
          ...options,
        },
      }),
    );
    flashStatus(`Exported ${scale}× snapshot (${background} background)`);
  }, [activeStructureName, flashStatus]);

  // Generic share preparation
  function handleOpenShare() {
    if (props.onShare) {
      props.onShare();
      return;
    }
    setShareFilename(undefined);
    if (props.context === "project" || props.context === "structure") {
      const formula = props.formula ?? "Molecule";
      const authority = props.authority ?? "USER_ENTERED · NOT OPTIMIZED";
      setShareSummary(
        `ChemDFT Project: ${activeStructureName} (${formula}) · Authority: [${authority}]. Verified quantum computational evidence.`
      );
    } else if (props.context === "result") {
      setShareSummary(
        `ChemDFT Result: ${props.calculationId} · Structure: ${activeStructureName}. Stored quantum chemical evidence.`
      );
    } else {
      setShareSummary(`ChemDFT Research Evidence: ${activeStructureName}`);
    }
    setIsShareOpen(true);
  }

  // Assemble menu items by context
  const items: UnifiedExportItem[] = useMemo(() => {
    switch (props.context) {
      case "project": {
        const p = props;
        return [
          {
            id: "project-html",
            group: "SHARE_AND_READ",
            label: "Interactive 3D web page (.html)",
            subtext: "Works offline in any browser",
            badge: "AVAILABLE",
            testId: "export-item-html",
            onSelect: async () => {
              try {
                const res = await downloadProjectHtml(p.projectId, p.structureVersionId ?? undefined);
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "HTML export failed.");
              }
            },
          },
          {
            id: "project-report-pdf",
            group: "SHARE_AND_READ",
            label: "Report PDF",
            subtext: "Multi-page print & publication",
            badge: "AVAILABLE",
            testId: "export-item-report-pdf",
            onSelect: async () => {
              try {
                const res = await downloadProjectReportPdf(p.projectId, p.structureVersionId ?? undefined);
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "Report PDF export failed.");
              }
            },
          },
          {
            id: "project-3d-pdf",
            group: "SHARE_AND_READ",
            label: "3D PDF (needs Adobe Acrobat or Reader)",
            subtext: "ISO 32000-1 rotatable PRC model",
            badge: capabilities.export_3d_pdf_available ? "AVAILABLE" : "IN TESTING",
            badgeTestId: "badge-3d-pdf-testing",
            testId: "export-item-3d-pdf",
            onSelect: () => {
              setIs3dPdfOpen(true);
            },
          },
          {
            id: "project-xyz",
            group: "STRUCTURE_DATA",
            label: "Cartesian coordinates (.xyz)",
            subtext: "Atomic coordinates format",
            badge: p.structureVersionId ? "AVAILABLE" : undefined,
            disabled: !p.structureVersionId,
            disabledReason: "Cartesian coordinates — no committed structure version available",
            testId: "export-item-xyz",
            onSelect: async () => {
              if (!p.structureId || !p.structureVersionId) return;
              try {
                const res = await downloadStructureFile(p.projectId, p.structureId, p.structureVersionId, "XYZ");
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "XYZ export failed.");
              }
            },
          },
          {
            id: "project-sdf",
            group: "STRUCTURE_DATA",
            label: "Structure-data file (.sdf)",
            subtext: "MDL SDfile format",
            badge: p.structureVersionId ? "AVAILABLE" : undefined,
            disabled: !p.structureVersionId,
            disabledReason: "Structure-data file — no committed structure version available",
            testId: "export-item-sdf",
            onSelect: async () => {
              if (!p.structureId || !p.structureVersionId) return;
              try {
                const res = await downloadStructureFile(p.projectId, p.structureId, p.structureVersionId, "SDF");
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "SDF export failed.");
              }
            },
          },
          {
            id: "project-mol",
            group: "STRUCTURE_DATA",
            label: "MDL Molfile (.mol)",
            subtext: "Single-molecule connection table",
            badge: p.structureVersionId ? "AVAILABLE" : undefined,
            disabled: !p.structureVersionId,
            disabledReason: "MDL Molfile — no committed structure version available",
            testId: "export-item-mol",
            onSelect: async () => {
              if (!p.structureId || !p.structureVersionId) return;
              try {
                const res = await downloadStructureFile(p.projectId, p.structureId, p.structureVersionId, "MOL");
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "MOL export failed.");
              }
            },
          },
          {
            id: "project-smiles",
            group: "STRUCTURE_DATA",
            label: "SMILES string (.smi)",
            subtext: "Simplified molecular-input line-entry",
            badge: p.structureVersionId ? "AVAILABLE" : undefined,
            disabled: !p.structureVersionId,
            disabledReason: "SMILES string — no committed structure version available",
            testId: "export-item-smiles",
            onSelect: async () => {
              if (!p.structureId || !p.structureVersionId) return;
              try {
                const res = await downloadStructureFile(p.projectId, p.structureId, p.structureVersionId, "SMILES");
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "SMILES export failed.");
              }
            },
          },
          {
            id: "project-png",
            group: "PICTURES_AND_TABLES",
            label: "Snapshot image (.png)",
            subtext: "Snapshot of the active 3D view",
            badge: "AVAILABLE",
            testId: "export-item-image-png",
            onSelect: () => setIsSnapshotOpen(true),
          },
          {
            id: "project-csv",
            group: "PICTURES_AND_TABLES",
            label: "Table of values (.csv)",
            subtext: "Tabular properties and calculation summary",
            disabled: true,
            disabledReason: "Table of values — needs a calculation result",
            testId: "export-item-table-csv",
            onSelect: () => {},
          },
          {
            id: "project-archive",
            group: "PROJECT_ZIP",
            label: "Project archive bundle (.zip)",
            subtext: "Complete bundle with all structures & results",
            badge: "AVAILABLE",
            testId: "export-item-archive",
            onSelect: async () => {
              try {
                const res = await downloadProjectArchive(p.projectId);
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "Archive export failed.");
              }
            },
          },
        ];
      }

      case "structure": {
        const p = props;
        const hasStruct = Boolean(p.structureVersionId);
        return [
          {
            id: "structure-html",
            group: "SHARE_AND_READ",
            label: "Interactive 3D web page (.html)",
            subtext: hasStruct ? "Works offline in any browser" : "Interactive 3D web page — select a structure first",
            disabled: !hasStruct,
            disabledReason: "Interactive 3D web page — select a structure first",
            testId: "export-item-html",
            onSelect: async () => {
              if (!p.structureVersionId) return;
              try {
                const res = await downloadProjectHtml(p.projectId, p.structureVersionId);
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "HTML export failed.");
              }
            },
          },
          {
            id: "structure-report-pdf",
            group: "SHARE_AND_READ",
            label: "Report PDF (.pdf)",
            subtext: hasStruct ? "Multi-page print & publication" : "Report PDF — select a structure first",
            disabled: !hasStruct,
            disabledReason: "Report PDF — select a structure first",
            testId: "export-item-report-pdf",
            onSelect: async () => {
              if (!p.structureVersionId) return;
              try {
                const res = await downloadProjectReportPdf(p.projectId, p.structureVersionId);
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "Report PDF export failed.");
              }
            },
          },
          {
            id: "structure-3d-pdf",
            group: "SHARE_AND_READ",
            label: "3D PDF (.pdf)",
            subtext: "3D PDF — IN TESTING · needs Adobe Acrobat",
            disabled: true,
            disabledReason: "3D PDF — IN TESTING · needs Adobe Acrobat",
            testId: "export-item-3d-pdf",
            onSelect: () => {},
          },
          {
            id: "structure-xyz",
            group: "STRUCTURE_DATA",
            label: "Cartesian coordinates (.xyz)",
            subtext: hasStruct ? "Atomic coordinates format" : "Cartesian coordinates — select a structure first",
            disabled: !hasStruct,
            disabledReason: "Cartesian coordinates — select a structure first",
            testId: "export-item-xyz",
            onSelect: () => void p.onExportFile?.("XYZ"),
          },
          {
            id: "structure-sdf",
            group: "STRUCTURE_DATA",
            label: "Structure-data file (.sdf)",
            subtext: hasStruct ? "MDL SDfile format" : "Structure-data file — select a structure first",
            disabled: !hasStruct,
            disabledReason: "Structure-data file — select a structure first",
            testId: "export-item-sdf",
            onSelect: () => void p.onExportFile?.("SDF"),
          },
          {
            id: "structure-mol",
            group: "STRUCTURE_DATA",
            label: "MDL Molfile (.mol)",
            subtext: hasStruct ? "Single-molecule connection table" : "MDL Molfile — select a structure first",
            disabled: !hasStruct,
            disabledReason: "MDL Molfile — select a structure first",
            testId: "export-item-mol",
            onSelect: () => void p.onExportFile?.("MOL"),
          },
          {
            id: "structure-smiles",
            group: "STRUCTURE_DATA",
            label: "SMILES string (.smi)",
            subtext: hasStruct ? "Simplified molecular-input line-entry" : "SMILES string — select a structure first",
            disabled: !hasStruct,
            disabledReason: "SMILES string — select a structure first",
            testId: "export-item-smiles",
            onSelect: () => void p.onExportFile?.("SMILES"),
          },
          ...(p.isPeriodic
            ? [
                {
                  id: "structure-cif",
                  group: "STRUCTURE_DATA" as const,
                  label: "Crystallographic Information File (.cif)",
                  subtext: hasStruct ? "CIF unit cell & coordinates" : "CIF — select a structure first",
                  disabled: !hasStruct,
                  disabledReason: "CIF — select a structure first",
                  testId: "export-item-cif",
                  onSelect: () => void p.onExportFile?.("CIF"),
                },
              ]
            : []),
          {
            id: "structure-png",
            group: "PICTURES_AND_TABLES",
            label: "Snapshot of the 3D view (.png)",
            subtext: "Capture current 3D view representation",
            testId: "export-item-image-png",
            onSelect: () => setIsSnapshotOpen(true),
          },
          {
            id: "structure-csv",
            group: "PICTURES_AND_TABLES",
            label: "Table of values (.csv)",
            subtext: "Tabular properties and calculation summary",
            disabled: true,
            disabledReason: "Table of values — needs a calculation result",
            testId: "export-item-table-csv",
            onSelect: () => {},
          },
          {
            id: "structure-archive",
            group: "PROJECT_ZIP",
            label: "Project archive bundle (.zip)",
            subtext: "Complete project bundle with all structures & results",
            testId: "export-item-archive",
            onSelect: async () => {
              try {
                const res = await downloadProjectArchive(p.projectId);
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "Archive export failed.");
              }
            },
          },
        ];
      }

      case "drawing": {
        const p = props;
        const candidate = p.hasCandidate;
        return [
          {
            id: "drawing-html",
            group: "SHARE_AND_READ",
            label: candidate ? "Interactive 3D web page (.html)" : "Interactive 3D web page (.html) (Generate 3D first)",
            subtext: candidate ? "Works offline in any browser" : "Interactive 3D web page — press Generate 3D first",
            disabled: !candidate,
            disabledReason: "Interactive 3D web page — press Generate 3D first",
            testId: "export-item-html",
            onSelect: () => void p.onExportHtml(),
          },
          {
            id: "drawing-report-pdf",
            group: "SHARE_AND_READ",
            label: "Report PDF (2D drawing sheet)",
            subtext: "2D drawing sheet with properties and check",
            testId: "export-item-report-pdf",
            onSelect: () => void p.onExportPdf(),
          },
          {
            id: "drawing-3d-pdf",
            group: "SHARE_AND_READ",
            label: candidate
              ? "3D PDF (needs Adobe Acrobat or Reader)"
              : "3D PDF (needs Adobe Acrobat or Reader) (Generate 3D first · IN TESTING)",
            subtext: candidate
              ? "ISO 32000-1 rotatable PRC model (needs Adobe Acrobat)"
              : "3D PDF — IN TESTING · press Generate 3D first (needs Adobe Acrobat)",
            disabled: !candidate,
            disabledReason: "3D PDF — IN TESTING · press Generate 3D first (needs Adobe Acrobat)",
            testId: "export-item-3d-pdf",
            onSelect: () => {
              if (p.onExport3dPdf) p.onExport3dPdf();
            },
          },
          {
            id: "drawing-xyz",
            group: "STRUCTURE_DATA",
            label: candidate ? "Cartesian coordinates (.xyz)" : "Cartesian coordinates (.xyz) (Generate 3D first)",
            subtext: candidate ? "Atomic coordinates format" : "Cartesian coordinates — press Generate 3D first",
            disabled: !candidate,
            disabledReason: "Cartesian coordinates — press Generate 3D first",
            testId: "export-item-xyz",
            onSelect: () => p.onExportXyz(),
          },
          {
            id: "drawing-sdf",
            group: "STRUCTURE_DATA",
            label: "Structure-data file (.sdf)",
            subtext: "MDL SDfile format",
            testId: "export-item-sdf",
            onSelect: () => void p.onExportStructureFile("sdf"),
          },
          {
            id: "drawing-mol",
            group: "STRUCTURE_DATA",
            label: "Molfile (.mol)",
            subtext: "Single-molecule connection table",
            testId: "export-item-mol",
            onSelect: () => void p.onExportStructureFile("mol"),
          },
          {
            id: "drawing-smiles",
            group: "STRUCTURE_DATA",
            label: "SMILES string (.smi)",
            subtext: "Simplified molecular-input line-entry",
            testId: "export-item-smiles",
            onSelect: () => void p.onExportStructureFile("smi"),
          },
          {
            id: "drawing-svg",
            group: "PICTURES_AND_TABLES",
            label: "Image (SVG)",
            subtext: "Scalable vector graphics of drawing",
            testId: "export-item-svg",
            onSelect: () => void p.onExportImage("svg"),
          },
          {
            id: "drawing-png",
            group: "PICTURES_AND_TABLES",
            label: "Image (PNG)",
            subtext: "Raster PNG image of drawing",
            testId: "export-item-image-png",
            onSelect: () => void p.onExportImage("png"),
          },
          {
            id: "drawing-csv",
            group: "PICTURES_AND_TABLES",
            label: "Table of values (.csv)",
            subtext: "Tabular properties summary (.csv)",
            disabled: !candidate,
            disabledReason: "Table of values — press Generate 3D first",
            testId: "export-item-table-csv",
            onSelect: () => {},
          },
          {
            id: "drawing-archive",
            group: "PROJECT_ZIP",
            label: "Project archive (.zip)",
            subtext: "Complete bundle with 2D drawings & properties",
            testId: "export-item-archive",
            onSelect: () => void p.onExportArchive(),
          },
        ];
      }

      case "result": {
        const p = props;
        const catalog = resultCatalog;
        const findOption = (format: string) => catalog?.formats.find((f) => f.format === format);
        const optJson = findOption("result-json");
        const optTraj = findOption("trajectory-xyz");
        const optSpec = findOption("spectrum-csv");
        const optCube = findOption("cube");
        const optBundle = findOption("reproducibility-bundle");
        const optReport = findOption("report");

        return [
          {
            id: "result-html",
            group: "SHARE_AND_READ",
            label: "Interactive 3D web page (.html)",
            subtext: "Interactive 3D web page — available in 3D workbench",
            disabled: true,
            disabledReason: "Interactive 3D web page — available in 3D workbench",
            testId: "export-item-html",
            onSelect: () => {},
          },
          {
            id: "result-report-html",
            group: "SHARE_AND_READ",
            label: "Scientific report (.html)",
            subtext: "Methods, results with units, charts of stored data and provenance",
            disabled: optReport ? !optReport.available : false,
            disabledReason: optReport?.unsupported_reason ?? "Report HTML not available",
            testId: "export-item-report-html",
            runTestId: "export-run-report-html",
            onSelect: async () => {
              try {
                const res = await downloadCalculationExport({
                  projectId: p.projectId,
                  calculationId: p.calculationId,
                  format: "report",
                  variant: "html",
                });
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "Report HTML export failed.");
              }
            },
          },
          {
            id: "result-report-markdown",
            group: "SHARE_AND_READ",
            label: "Scientific report (.md)",
            subtext: "Evaluated methods, standing and provenance in Markdown",
            disabled: optReport ? !optReport.available : false,
            disabledReason: optReport?.unsupported_reason ?? "Report Markdown not available",
            testId: "export-item-report-markdown",
            runTestId: "export-run-report-markdown",
            onSelect: async () => {
              try {
                const res = await downloadCalculationExport({
                  projectId: p.projectId,
                  calculationId: p.calculationId,
                  format: "report",
                  variant: "markdown",
                });
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "Report Markdown export failed.");
              }
            },
          },
          {
            id: "result-report-json",
            group: "SHARE_AND_READ",
            label: "Scientific report (.json)",
            subtext: "Full evaluation report with units in machine-readable JSON",
            disabled: optReport ? !optReport.available : false,
            disabledReason: optReport?.unsupported_reason ?? "Report JSON not available",
            testId: "export-item-report-json",
            runTestId: "export-run-report-json",
            onSelect: async () => {
              try {
                const res = await downloadCalculationExport({
                  projectId: p.projectId,
                  calculationId: p.calculationId,
                  format: "report",
                  variant: "json",
                });
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "Report JSON export failed.");
              }
            },
          },
          {
            id: "result-3d-pdf",
            group: "SHARE_AND_READ",
            label: "3D PDF (.pdf)",
            subtext: "3D PDF — IN TESTING · needs Adobe Acrobat",
            disabled: true,
            disabledReason: "3D PDF — IN TESTING · needs Adobe Acrobat",
            testId: "export-item-3d-pdf",
            onSelect: () => {},
          },
          {
            id: "result-trajectory-xyz",
            group: "STRUCTURE_DATA",
            label: "Optimization trajectory (.xyz)",
            subtext: "Every stored optimization frame in order (Å, energies in Eh in each comment line)",
            disabled: optTraj ? !optTraj.available : true,
            disabledReason: optTraj?.unsupported_reason ?? "Optimization trajectory — no optimization frames were recorded",
            testId: "export-item-trajectory-xyz",
            runTestId: "export-run-trajectory-xyz",
            onSelect: async () => {
              try {
                const res = await downloadCalculationExport({
                  projectId: p.projectId,
                  calculationId: p.calculationId,
                  format: "trajectory-xyz",
                });
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "Trajectory XYZ export failed.");
              }
            },
          },
          {
            id: "result-cube",
            group: "STRUCTURE_DATA",
            label: "Field grid (.cube)",
            subtext: "A stored density, potential or orbital grid in Gaussian CUBE form (lengths in bohr)",
            disabled: optCube ? !optCube.available : true,
            disabledReason: optCube?.unsupported_reason ?? "Field grid — only orbital results have a field grid",
            testId: "export-item-cube",
            runTestId: "export-run-cube",
            onSelect: async () => {
              try {
                const res = await downloadCalculationExport({
                  projectId: p.projectId,
                  calculationId: p.calculationId,
                  format: "cube",
                });
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "Cube export failed.");
              }
            },
          },
          {
            id: "result-json",
            group: "STRUCTURE_DATA",
            label: "Result JSON (.json)",
            subtext: "Values with units, method and engine, structure identity, scientific state and provenance lineage",
            disabled: optJson ? !optJson.available : false,
            disabledReason: optJson?.unsupported_reason ?? "Result JSON not available",
            testId: "export-item-result-json",
            runTestId: "export-run-result-json",
            onSelect: async () => {
              try {
                const res = await downloadCalculationExport({
                  projectId: p.projectId,
                  calculationId: p.calculationId,
                  format: "result-json",
                });
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "Result JSON export failed.");
              }
            },
          },
          {
            id: "result-spectrum-csv",
            group: "PICTURES_AND_TABLES",
            label: "Spectrum data (.csv)",
            subtext: "Stored stick data only — no broadening and no peak picking",
            disabled: optSpec ? !optSpec.available : false,
            disabledReason: optSpec?.unsupported_reason ?? "Spectrum data — only frequency/IR/Raman results have stick spectra",
            testId: "export-item-spectrum-csv",
            runTestId: "export-run-spectrum-csv-ir",
            onSelect: async () => {
              try {
                const res = await downloadCalculationExport({
                  projectId: p.projectId,
                  calculationId: p.calculationId,
                  format: "spectrum-csv",
                  variant: optSpec?.variants?.[0]?.key,
                });
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "Spectrum CSV export failed.");
              }
            },
          },
          {
            id: "result-png",
            group: "PICTURES_AND_TABLES",
            label: "Snapshot of the 3D view (.png)",
            subtext: "Capture current 3D view representation",
            testId: "export-item-image-png",
            onSelect: () => setIsSnapshotOpen(true),
          },
          {
            id: "result-reproducibility-bundle",
            group: "PROJECT_ZIP",
            label: "Reproducibility package (.zip)",
            subtext: "Allowlisted specification, structure, engine identity, environment and result, with checksums",
            disabled: optBundle ? !optBundle.available : false,
            disabledReason: optBundle?.unsupported_reason ?? "Evidence archive not available",
            testId: "export-item-reproducibility-bundle",
            runTestId: "export-run-reproducibility-bundle",
            onSelect: async () => {
              try {
                const res = await downloadCalculationExport({
                  projectId: p.projectId,
                  calculationId: p.calculationId,
                  format: "reproducibility-bundle",
                  variant: optBundle?.variants?.[0]?.key,
                });
                saveBlob(res.blob, res.filename);
                flashStatus(`Saved ${res.filename}`);
              } catch (e) {
                flashStatus(e instanceof Error ? e.message : "Reproducibility bundle export failed.");
              }
            },
          },
        ];
      }

      case "comparison": {
        const p = props;
        const canComp = p.canCompare ?? true;
        const fallbackReason = p.disabledReason ?? "Select at least two available results";
        return [
          {
            id: "compare-html",
            group: "SHARE_AND_READ",
            label: "Interactive 3D web page (.html)",
            subtext: "Interactive 3D web page — comparisons provide tabular reports and charts",
            disabled: true,
            disabledReason: "Interactive 3D web page — comparisons provide tabular reports and charts",
            testId: "export-item-html",
            onSelect: () => {},
          },
          {
            id: "compare-report-html",
            group: "SHARE_AND_READ",
            label: "Comparison report (.html)",
            subtext: "Full report with interactive comparison charts",
            disabled: !canComp,
            disabledReason: fallbackReason,
            testId: "compare-report-html",
            onSelect: () => p.onExport("report-html"),
          },
          {
            id: "compare-report-markdown",
            group: "SHARE_AND_READ",
            label: "Comparison report (.md)",
            subtext: "Markdown summary table for notes & publications",
            disabled: !canComp,
            disabledReason: fallbackReason,
            testId: "compare-report-markdown",
            onSelect: () => p.onExport("report-markdown"),
          },
          {
            id: "compare-report-json",
            group: "SHARE_AND_READ",
            label: "Comparison report (.json)",
            subtext: "Structured comparison report data",
            disabled: !canComp,
            disabledReason: fallbackReason,
            testId: "compare-report-json",
            onSelect: () => p.onExport("report-json"),
          },
          {
            id: "compare-3d-pdf",
            group: "SHARE_AND_READ",
            label: "3D PDF (.pdf)",
            subtext: "3D PDF — comparisons provide tabular reports and charts",
            disabled: true,
            disabledReason: "3D PDF — comparisons provide tabular reports and charts",
            testId: "export-item-3d-pdf",
            onSelect: () => {},
          },
          {
            id: "compare-json",
            group: "STRUCTURE_DATA",
            label: "Comparison data (.json)",
            subtext: "Structured comparison data for computational pipelines (.json)",
            disabled: !canComp,
            disabledReason: fallbackReason,
            testId: "compare-export-json",
            onSelect: () => p.onExport("json"),
          },
          {
            id: "compare-xyz",
            group: "STRUCTURE_DATA",
            label: "Cartesian coordinates (.xyz)",
            subtext: "Cartesian coordinates — comparisons provide tabular reports and charts",
            disabled: true,
            disabledReason: "Cartesian coordinates — comparisons provide tabular reports and charts",
            testId: "export-item-xyz",
            onSelect: () => {},
          },
          {
            id: "compare-csv",
            group: "PICTURES_AND_TABLES",
            label: "Comparison data (.csv)",
            subtext: "Tabular metrics and property differences (.csv)",
            disabled: !canComp,
            disabledReason: fallbackReason,
            testId: "compare-export-csv",
            onSelect: () => p.onExport("csv"),
          },
          {
            id: "compare-png",
            group: "PICTURES_AND_TABLES",
            label: "Snapshot image (.png)",
            subtext: "Snapshot image — no 3D canvas on comparison view",
            disabled: true,
            disabledReason: "Snapshot image — no 3D canvas on comparison view",
            testId: "export-item-image-png",
            onSelect: () => {},
          },
          {
            id: "compare-archive",
            group: "PROJECT_ZIP",
            label: "Whole project .zip",
            subtext: "Complete archive bundle — available in project view",
            disabled: true,
            disabledReason: "Whole project .zip — available in project view",
            testId: "export-item-archive",
            onSelect: () => {},
          },
        ];
      }
    }
  }, [props, capabilities, resultCatalog, flashStatus]);

  // Overall enabled status: button is only disabled if NOTHING can be exported
  const anyEnabled = useMemo(() => items.some((it) => !it.disabled), [items]);
  const buttonDisabled = (props.disabled ?? false) || !anyEnabled;

  const defaultButtonTestId = useMemo(() => {
    if (props.buttonTestId) return props.buttonTestId;
    if (props.context === "project") return "project-export-menu-btn";
    if (props.context === "comparison") return "compare-export";
    if (props.context === "drawing") return "editor-export";
    if (props.context === "result") return "inspector-export";
    return "export-menu-btn";
  }, [props.buttonTestId, props.context]);

  const defaultDropdownTestId = useMemo(() => {
    if (props.dropdownTestId) return props.dropdownTestId;
    if (props.context === "project") return "project-export-menu-dropdown";
    if (props.context === "comparison") return "compare-export-menu";
    if (props.context === "drawing") return "editor-export-menu";
    if (props.context === "result") return "result-export-menu";
    return "export-menu-dropdown";
  }, [props.dropdownTestId, props.context]);

  const defaultShareTestId = useMemo(() => {
    if (props.shareTestId) return props.shareTestId;
    if (props.context === "project") return "project-share-btn";
    if (props.context === "drawing") return "editor-share-drawing";
    return "share-btn";
  }, [props.shareTestId, props.context]);

  // Render neutral Share button when enabled for this screen
  const showShare = props.showShare ?? (props.context !== "comparison");

  return (
    <div
      className={`${styles.exportControlsWrapper} ${props.className ?? ""}`}
      data-testid={props.testId ?? (props.context === "project" ? "project-export-controls" : "export-controls")}
    >
      {status ? (
        <span className={`${styles.statusMessage} ${styles.statusOk}`} role="status">
          {status}
        </span>
      ) : null}

      <AppPopover
        isOpen={open && !buttonDisabled}
        onInteraction={(next) => setOpen(next)}
        placement="bottom-end"
        popoverClassName={styles.unifiedMenuPopover ?? ""}
        content={
          <div
            ref={menuRef}
            className={styles.unifiedMenu}
            role="menu"
            aria-label="Export options"
            onKeyDown={handleMenuKeyDown}
            data-testid={defaultDropdownTestId}
          >
            {EXPORT_GROUPS_ORDER.map((group, groupIdx) => {
              const groupItems = items.filter((it) => it.group === group.key);
              if (groupItems.length === 0) return null;
              return (
                <div key={group.key} className={styles.menuGroup}>
                  {groupIdx > 0 ? <div className={styles.menuGroupDivider} role="separator" /> : null}
                  <div className={styles.menuGroupHeader} role="presentation">
                    {group.label}
                  </div>
                  {groupItems.map((item, itemIdx) => {
                    const reasonId = `${reasonIdPrefix}-${group.key}-${itemIdx}-reason`;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        className={styles.menuItemRow}
                        aria-disabled={item.disabled ? "true" : undefined}
                        aria-describedby={item.disabled && item.disabledReason ? reasonId : undefined}
                        onClick={() => {
                          if (item.disabled) return;
                          setOpen(false);
                          void item.onSelect();
                        }}
                        data-testid={item.testId}
                      >
                        <div className={styles.menuItemRowContent}>
                          <span className={styles.menuItemTitle}>{item.label}</span>
                          {item.disabled && item.disabledReason ? (
                            <span id={reasonId} className={styles.menuItemReason}>
                              {item.disabledReason}
                            </span>
                          ) : (
                            <span className={styles.menuItemSubtext}>{item.subtext}</span>
                          )}
                        </div>
                        {item.badge ? (
                          <span
                            className={`${styles.menuItemBadge} ${
                              item.badge === "AVAILABLE"
                                ? styles.menuItemBadgeAvailable
                                : item.badge === "IN TESTING"
                                  ? styles.menuItemBadgeTesting
                                  : styles.menuItemBadgePlanned
                            }`}
                            data-testid={item.badgeTestId}
                          >
                            {item.badge}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        }
      >
        <button
          ref={buttonRef}
          type="button"
          className={`${styles.unifiedExportButton} ${props.buttonClassName ?? ""}`}
          aria-label="Export"
          aria-haspopup="menu"
          aria-expanded={open && !buttonDisabled}
          disabled={buttonDisabled}
          title={buttonDisabled ? props.disabledReason ?? "Nothing available to export" : undefined}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={handleButtonKeyDown}
          data-testid={defaultButtonTestId}
        >
          <span>Export ▾</span>
        </button>
      </AppPopover>

      {showShare ? (
        <button
          type="button"
          className={styles.unifiedShareButton}
          onClick={handleOpenShare}
          data-testid={defaultShareTestId}
        >
          Share…
        </button>
      ) : null}

      {(props.context === "project" || props.context === "structure") && (
        <>
          <Export3dPdfDialog
            isOpen={is3dPdfOpen}
            onClose={() => setIs3dPdfOpen(false)}
            onOpenShare={(fn, sum) => {
              setIs3dPdfOpen(false);
              setShareFilename(fn);
              setShareSummary(sum);
              setIsShareOpen(true);
            }}
            projectId={props.projectId}
            structureName={activeStructureName}
            formula={props.formula ?? "Molecule"}
            atomCount={props.atomCount ?? 0}
            authority={props.authority ?? "USER_ENTERED · NOT OPTIMIZED"}
            structureVersionId={props.structureVersionId ?? undefined}
            isAvailable={capabilities.export_3d_pdf_available}
            unavailableReason={capabilities.export_3d_pdf_reason ?? undefined}
          />

          <ShareDialog
            isOpen={isShareOpen}
            onClose={() => setIsShareOpen(false)}
            title={activeStructureName}
            shareSummary={shareSummary}
            downloadFilename={shareFilename}
            onDownload={
              shareFilename
                ? () => {
                    void downloadProject3dPdf(props.projectId, props.structureVersionId ?? undefined).then((res) => {
                      saveBlob(res.blob, res.filename);
                    });
                  }
                : undefined
            }
            downloadLabel={shareFilename ? "Download 3D PDF" : undefined}
          />
        </>
      )}

      {props.context === "result" && (
        <ShareDialog
          isOpen={isShareOpen}
          onClose={() => setIsShareOpen(false)}
          title={activeStructureName}
          shareSummary={shareSummary}
        />
      )}

      <SnapshotDialog
        isOpen={isSnapshotOpen}
        onClose={() => setIsSnapshotOpen(false)}
        onDownload={handleDownloadSnapshot}
        structureName={activeStructureName}
      />
    </div>
  );
}
