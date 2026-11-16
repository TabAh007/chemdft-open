"use client";

import { plural } from "@/lib/overview-model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionButton, AppIcon } from "@chemdft/ui";
import { buildCandidatePreviewScene } from "@chemdft/scientific-scene";
import type { EntityReference, GeometryCandidateAcceptOutput, GeometryCandidateView } from "@chemdft/schemas";

import { acceptGeometryCandidate, generateGeometryCandidate } from "@/lib/structure-workspace-api";
import { normalizeDrawingMol as normalizeMol } from "@/lib/molecular-drawing-comparison";
import { DEFAULT_NEW_MOLECULE_NAME, describeTarget, lineageCompositionChange, type EditorTarget } from "@/lib/molecule-target";
import { MULTI_FRAGMENT_MESSAGE, molfileFormalCharge, plainGeometryError } from "@/lib/molecule-editor/geometry-errors";
import { describeMolecules, formatCharge, formulaRuns, parseGrossFormula, summarizeCheck, describeSelectedAtom, type CheckSummary, type GrossFormula } from "@/lib/molecule-editor/drawing-checks";
import { serializeKetcher } from "@/lib/molecule-editor/serial-ketcher";
import { readMolfile } from "@/lib/molecule-editor/read-molfile";
import { exportFilename } from "@/lib/molecule-editor/export-name";
import { CHECK_TYPES, type EditorKetcher } from "@/lib/molecule-editor/ketcher-types";
import { editorText } from "@/lib/molecule-editor/strings";
import { countMolfileAtoms, loadStructureIntoEditor } from "@/lib/molecule-editor/structure-input";
import { STRUCTURE_TEMPLATES } from "@/lib/molecule-editor/templates";
import { driveTool, resolveActiveItem, type ToolbarItem } from "@/lib/molecule-editor/toolbar";
import { KetcherHost, type KetcherApi } from "./ketcher-editor";
import { AtomsRail, EditorToolbar } from "./molecule-editor-toolbar";
import { PopMenu, Popover } from "./molecule-editor-menu";
import { AiDraftBanner, AiDrawPanel } from "./molecule-editor-ai-draw";
import { useAiDraw } from "./use-ai-draw";
import { CandidatePreviewPanel } from "./visualization/candidate-preview-panel";
import { ExportMenu } from "@/app/_components/export/export-menu";
import { ShareDialog } from "@/app/_components/export/share-dialog";
import { Export3dPdfDialog } from "@/app/_components/export/export-3d-pdf-dialog";
import { createDrawingPdf } from "@/lib/molecule-editor/pdf-drawing";
import { insertPngMetadata, insertSvgMetadata } from "@/lib/visualization/snapshot-processor";
import { downloadProjectArchive, downloadProjectHtml } from "@/lib/project-export-api";
import styles from "./molecule-editor.module.css";

export interface MoleculeEditorPaneProps {
  initialMolfile: string | null;
  mode: "new" | "edit";
  projectId: string;
  parentStructureVersion?: EntityReference | null;
  structureName?: string;
  /** Frozen save target (New molecule / New version). */
  target: EditorTarget;
  onSwitchToNewMolecule?: (molfile: string) => void;
  /** Back and Cancel: leave the editor without saving anything. */
  onCancel: () => void;
  onAccepted?: (output: GeometryCandidateAcceptOutput) => Promise<void> | void;
}

type DrawingReadout = {
  smiles: string;
  gross: GrossFormula | null;
  check: CheckSummary | null;
  /** True once Indigo answered for the current drawing. */
  settled: boolean;
};
const EMPTY_READOUT: DrawingReadout = { smiles: "", gross: null, check: null, settled: false };

type SelectionInfo =
  | { kind: "atom"; element: string; charge: number; valence: number | null }
  | { kind: "many"; atoms: number; bonds: number };

const FOCUS_KEY = "chemdft:molecule-editor-focus";

type LoadMessage = { kind: "error" | "ok"; text: string } | null;

const ELEMENT_NAMES: Record<string, [string, string]> = {
  C: ["carbon", "carbons"], O: ["oxygen", "oxygens"], N: ["nitrogen", "nitrogens"], S: ["sulfur", "sulfurs"],
  P: ["phosphorus", "phosphorus"], F: ["fluorine", "fluorines"], Cl: ["chlorine", "chlorines"], Br: ["bromine", "bromines"],
  I: ["iodine", "iodines"], H: ["hydrogen", "hydrogens"],
};
function elementCount(element: string, count: number): string {
  const names = ELEMENT_NAMES[element];
  return `${count} ${names ? names[count === 1 ? 0 : 1] : `${element.toLowerCase()}s`}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export function MoleculeEditorPane({
  initialMolfile,
  mode,
  projectId,
  parentStructureVersion,
  structureName: initialStructureName = "",
  target,
  onSwitchToNewMolecule,
  onCancel,
  onAccepted,
}: MoleculeEditorPaneProps) {
  const [ketcher, setKetcher] = useState<KetcherApi | null>(null);
  const k = ketcher as unknown as EditorKetcher | null;
  // Ketcher's worker channel mixes up overlapping requests, so every async call goes through one queue (serial-ketcher.ts).
  const adoptKetcher = useCallback((api: KetcherApi) => setKetcher(serializeKetcher(api)), []);
  // The host publishes the raw API on window.__ketcher; replace it with the serialized one for tests and tooling.
  useEffect(() => {
    if (ketcher && typeof window !== "undefined") (window as unknown as { __ketcher?: KetcherApi }).__ketcher = ketcher;
  }, [ketcher]);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const ownTool = useRef<string | null>("select");
  const [activeItem, setActiveItem] = useState<string | null>("select");
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [readout, setReadout] = useState<DrawingReadout>(EMPTY_READOUT);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [loadText, setLoadText] = useState("");
  const [loadMessage, setLoadMessage] = useState<LoadMessage>(null);
  const [loading, setLoading] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "ai">("preview");
  const [status, setStatus] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [shareDrawingOpen, setShareDrawingOpen] = useState(false);
  const [export3dPdfOpen, setExport3dPdfOpen] = useState(false);
  // Focus mode hides the app header, project navigation and shelf (shell.css reads html[data-editor-focus]); per session only.
  const [focusMode, setFocusMode] = useState<boolean>(() => {
    try { return window.sessionStorage.getItem(FOCUS_KEY) === "1"; } catch { return false; }
  });

  const lineageNameFixed = target.kind === "new-version";
  const [structureName, setStructureName] = useState(
    target.kind === "new-version" ? target.parent.name : initialStructureName || (mode === "edit" ? "Edited molecule" : ""),
  );

  // 3D candidate state (the server's real ETKDGv3 step; nothing here simulates a coordinate).
  const [generating, setGenerating] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chargeText, setChargeText] = useState("");
  const [candidate, setCandidate] = useState<GeometryCandidateView | null>(null);
  const [candidateSourceMol, setCandidateSourceMol] = useState<string | null>(null);
  const [inspectedGeometry, setInspectedGeometry] = useState(false);
  const [understandsNotOptimized, setUnderstandsNotOptimized] = useState(false);
  const [acceptCompositionChange, setAcceptCompositionChange] = useState(false);
  const [showCoordinatesTable, setShowCoordinatesTable] = useState(false);
  const generationEpochRef = useRef(0);
  const refreshSeq = useRef(0);

  const invalidateCandidate = useCallback((reason = "The drawing changed, so the previous 3D structure was discarded. Press Generate 3D for the revised drawing.") => {
    generationEpochRef.current += 1;
    setGenerating(false);
    setCandidate((previous) => {
      if (previous !== null) setStatus(reason);
      return null;
    });
    setInspectedGeometry(false);
    setUnderstandsNotOptimized(false);
    setAcceptCompositionChange(false);
    setCandidateSourceMol(null);
    setError(null);
  }, []);

  useEffect(() => () => { generationEpochRef.current += 1; }, []);

  const toggleFocus = useCallback((next?: boolean) => {
    setFocusMode((current) => {
      const value = next ?? !current;
      try { window.sessionStorage.setItem(FOCUS_KEY, value ? "1" : "0"); } catch { /* session memory is optional */ }
      setStatus(value ? editorText.focusOn : editorText.focusOff);
      return value;
    });
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (focusMode) root.setAttribute("data-editor-focus", "on"); else root.removeAttribute("data-editor-focus");
    return () => root.removeAttribute("data-editor-focus");
  }, [focusMode]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && focusMode && !event.defaultPrevented && !document.querySelector("[data-editor-popover-open]")) {
        toggleFocus(false);
      } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        toggleFocus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focusMode, toggleFocus]);

  // ---- reading the drawing (Ketcher/Indigo only) ----
  const refreshHistory = useCallback(() => {
    if (!k) return;
    try { setHistory(k.editor.historySize()); } catch { /* history is cosmetic */ }
  }, [k]);

  const refreshSelection = useCallback(() => {
    if (!k) return;
    try {
      const selected = k.editor.selection();
      const atoms = selected?.atoms ?? [];
      const bonds = selected?.bonds ?? [];
      if (atoms.length === 0) { setSelection(null); return; }
      if (atoms.length === 1 && bonds.length === 0) {
        const info = describeSelectedAtom(k.editor.struct().atoms.get(atoms[0] as number));
        setSelection(info ? { kind: "atom", ...info } : null);
        return;
      }
      setSelection({ kind: "many", atoms: atoms.length, bonds: bonds.length });
    } catch {
      setSelection(null);
    }
  }, [k]);

  const refreshReadout = useCallback(async () => {
    if (!k) return;
    const seq = ++refreshSeq.current;
    try {
      const molfile = await readMolfile(k);
      const smiles = countMolfileAtoms(molfile) === 0 ? "" : (await k.getSmiles()).trim();
      if (seq !== refreshSeq.current) return;
      if (!smiles) { setReadout({ smiles: "", gross: null, check: null, settled: true }); return; }
      const [calc, check] = await Promise.allSettled([k.calculate(), k.indigo.check(molfile, { types: [...CHECK_TYPES] })]);
      if (seq !== refreshSeq.current) return;
      setReadout({
        smiles,
        gross: calc.status === "fulfilled" ? parseGrossFormula(calc.value["gross"]) : null,
        check: check.status === "fulfilled" ? summarizeCheck(check.value) : null,
        settled: true,
      });
    } catch {
      if (seq === refreshSeq.current) setReadout({ ...EMPTY_READOUT, settled: true });
    }
  }, [k]);

  useEffect(() => {
    if (!k || !k.changeEvent) return;
    let timer: number | undefined;
    const onChange = () => {
      invalidateCandidate();
      refreshHistory();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void refreshReadout(); refreshSelection(); }, 150);
    };
    k.changeEvent.add(onChange);
    // Initial read of the drawing, scheduled so no state is set synchronously inside the effect.
    timer = window.setTimeout(() => { void refreshReadout(); refreshHistory(); }, 0);
    return () => {
      window.clearTimeout(timer);
      k.changeEvent?.remove?.(onChange);
    };
  }, [k, invalidateCandidate, refreshHistory, refreshReadout, refreshSelection]);

  // Ketcher announces selection changes itself, but it can announce before the selection is final (select-all, delete),
  // so the card is also re-read after the pointer or keyboard has settled.
  useEffect(() => {
    if (!k) return;
    let timer: number | undefined;
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(refreshSelection, 40); };
    const subscription = k.editor.event?.selectionChange;
    subscription?.add(schedule);
    document.addEventListener("keyup", schedule);
    document.addEventListener("mouseup", schedule);
    return () => {
      window.clearTimeout(timer);
      subscription?.remove?.(schedule);
      document.removeEventListener("keyup", schedule);
      document.removeEventListener("mouseup", schedule);
    };
  }, [k, refreshSelection]);

  useEffect(() => {
    if (k && initialMolfile) void k.setMolecule(initialMolfile);
  }, [initialMolfile, k]);

  // ---- toolbar state: follow Ketcher's own `active` class so shortcuts keep the highlight honest ----
  const kRoot = useCallback(() => frameRef.current?.querySelector<HTMLElement>('[class~="Ketcher-root"]') ?? null, []);
  const clickNative = useCallback((testId: string): boolean => {
    const element = kRoot()?.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (!element) return false;
    element.click();
    return true;
  }, [kRoot]);

  useEffect(() => {
    const root = kRoot();
    if (!k || !root) return;
    let frame = 0;
    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const active = Array.from(root.querySelectorAll<HTMLElement>(".active[data-testid]")).map((element) => element.getAttribute("data-testid") ?? "");
        const next = resolveActiveItem(ownTool.current, active);
        ownTool.current = next;
        setActiveItem(next);
      });
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, subtree: true, attributeFilter: ["class"] });
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); };
  }, [k, kRoot]);

  const activate = useCallback(async (item: ToolbarItem) => {
    if (!k) return;
    if (item.sticky) { ownTool.current = item.id; setActiveItem(item.id); }
    const ok = await driveTool(k, item.driver, clickNative);
    if (!ok) setStatus(`${item.label} is not available in this editor build.`);
    refreshHistory();
  }, [k, clickNative, refreshHistory]);

  // AI Scientist "Draw": typed, server-validated edits applied to Ketcher one step at a time.
  const ai = useAiDraw({ k, projectId, onStatus: setStatus });

  const activateAtom = useCallback((id: string, testId: string) => {
    ownTool.current = id;
    setActiveItem(id);
    clickNative(testId);
  }, [clickNative]);

  const activateGroup = useCallback(async (id: string, molfile: string) => {
    if (!k) return;
    ownTool.current = id;
    setActiveItem(id);
    await driveTool(k, { kind: "stamp", molfile }, clickNative);
  }, [k, clickNative]);

  // ---- start faster ----
  async function loadInto(text: string, source: "paste" | "template") {
    if (!k || loading) return;
    setLoading(true);
    setLoadMessage(null);
    const result = await loadStructureIntoEditor(k, text);
    setLoading(false);
    if (!result.ok) {
      setLoadMessage({ kind: "error", text: source === "template" ? `${editorText.startFromTemplateError} ${result.error}` : result.error });
      return;
    }
    setLoadMessage({ kind: "ok", text: result.kind === "smiles" ? editorText.loadedSmiles : editorText.loadedMol });
    setImportOpen(false);
    window.setTimeout(() => setLoadMessage((current) => (current?.kind === "ok" ? null : current)), 4000);
    setStatus(result.kind === "smiles" ? editorText.loadedSmiles : editorText.loadedMol);
    if (source === "paste") setLoadText("");
  }

  // ---- 3D generation (server) ----
  async function handleGenerate3D() {
    if (!k) return;
    const epoch = ++generationEpochRef.current;
    setError(null);
    setGenerating(true);
    setCandidate(null);
    setInspectedGeometry(false);
    setUnderstandsNotOptimized(false);
    setAcceptCompositionChange(false);
    setCandidateSourceMol(null);
    setTab("preview");
    setStatus("Reading the drawing…");
    try {
      const molfile = await readMolfile(k);
      if (epoch !== generationEpochRef.current) return;
      if (!molfile || !molfile.trim() || !molfile.includes("M  END") || countMolfileAtoms(molfile) === 0) {
        throw new Error("Draw a complete molecular structure in Ketcher before generating 3D coordinates.");
      }
      if (readout.gross && readout.gross.molecules.length > 0) throw new Error(`GEOMETRY_UNSUPPORTED: ${MULTI_FRAGMENT_MESSAGE}`);
      setStatus("Generating the 3D structure on the server (RDKit ETKDGv3)…");
      const result = await generateGeometryCandidate({
        projectId,
        payload: {
          mol_block: molfile,
          name: structureName.trim() || DEFAULT_NEW_MOLECULE_NAME,
          expected_charge: /^-?\d+$/.test(chargeText.trim()) ? Number(chargeText.trim()) : molfileFormalCharge(molfile),
          multiplicity: 1,
          parent_structure_version: parentStructureVersion ?? null,
        },
      });
      if (epoch !== generationEpochRef.current) return;
      const currentMol = await readMolfile(k);
      if (epoch !== generationEpochRef.current || normalizeMol(currentMol) !== normalizeMol(molfile)) {
        setStatus("The drawing changed while the server was working. Press Generate 3D again.");
        return;
      }
      setCandidateSourceMol(molfile);
      setCandidate(result);
      setStatus(`3D structure generated: ${result.manifest.formula}. Inspect it, then accept the geometry.`);
    } catch (err) {
      if (epoch !== generationEpochRef.current) return;
      const raw = err instanceof Error ? err.message : "3D conformer generation failed.";
      const plain = plainGeometryError(raw);
      const message = plain.detail ? `${plain.text} (${plain.detail})` : plain.text;
      setError(message);
      setStatus(message);
    } finally {
      if (epoch === generationEpochRef.current) setGenerating(false);
    }
  }

  async function handleAccept() {
    if (!candidate || !k) return;
    const currentMol = await readMolfile(k);
    if (!candidateSourceMol || normalizeMol(currentMol) !== normalizeMol(candidateSourceMol)) {
      invalidateCandidate("Cannot accept: the drawing was modified after the 3D structure was generated. Press Generate 3D again.");
      setError("Cannot accept: the drawing was modified after the 3D structure was generated. Please generate a new one.");
      return;
    }
    if (!inspectedGeometry || !understandsNotOptimized) {
      setError("Both acknowledgments are required before geometry acceptance.");
      return;
    }
    if (compositionChange && !acceptCompositionChange) {
      setError(`The drawing (${compositionChange.candidate}) differs from the ${target.kind === "new-version" ? target.parent.name : "parent"} lineage (${compositionChange.parent}). Confirm the new version or save it as a new molecule.`);
      return;
    }
    setAccepting(true);
    setError(null);
    setStatus("Accepting the geometry and committing an immutable structure version…");
    try {
      const output = await acceptGeometryCandidate({
        projectId,
        candidateId: candidate.id,
        payload: { candidate_sha256: candidate.candidate_artifact.sha256, inspected_geometry: true, understands_not_optimized: true },
      });
      setStatus(`Committed ${output.structure.name} V${output.version.revision} (${output.version.coordinates?.atoms.length ?? 0} atoms).`);
      if (onAccepted) await onAccepted(output);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Geometry acceptance failed.";
      setError(message);
      setStatus(message);
    } finally {
      setAccepting(false);
    }
  }

  // ---- identifiers and export ----
  async function copySmiles() {
    if (!readout.smiles) return;
    const ok = await copyText(readout.smiles);
    setCopyState(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 1800);
  }

  async function exportImage(format: "svg" | "png") {
    if (!k) return;
    setExportError(null);
    try {
      const molfile = await readMolfile(k);
      if (countMolfileAtoms(molfile) === 0) { setExportError(editorText.exportEmpty); return; }
      const blob = await k.generateImage(molfile, { outputFormat: format });
      let finalBlob = blob;
      if (format === "png") {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const withMeta = insertPngMetadata(buf);
        finalBlob = new Blob([withMeta.buffer as ArrayBuffer], { type: "image/png" });
      } else if (format === "svg") {
        const text = await blob.text();
        const withMeta = insertSvgMetadata(text);
        finalBlob = new Blob([withMeta], { type: "image/svg+xml" });
      }
      downloadBlob(finalBlob, exportFilename(structureName, format));
    } catch {
      setExportError(editorText.exportFailed);
    }
  }

  async function exportPdfDrawing() {
    if (!k) return;
    setExportError(null);
    try {
      const molfile = await readMolfile(k);
      if (countMolfileAtoms(molfile) === 0) { setExportError(editorText.exportEmpty); return; }
      const pngBlob = await k.generateImage(molfile, { outputFormat: "png" });
      const formulaStr = readout.gross ? formulaRuns(readout.gross.formula).map((r) => r.text).join("") : "";
      const pdfBlob = await createDrawingPdf(pngBlob, structureName || "Chemical Drawing", formulaStr);
      downloadBlob(pdfBlob, exportFilename(structureName, "pdf"));
    } catch {
      setExportError(editorText.exportFailed);
    }
  }

  async function exportStructureFile(format: "mol" | "sdf" | "smi") {
    if (!k) return;
    setExportError(null);
    try {
      const molfile = await readMolfile(k);
      if (countMolfileAtoms(molfile) === 0) { setExportError(editorText.exportEmpty); return; }
      if (format === "mol") {
        downloadBlob(new Blob([molfile], { type: "chemical/x-mdl-molfile" }), exportFilename(structureName, "mol"));
      } else if (format === "sdf") {
        downloadBlob(new Blob([`${molfile}$$$$\n`], { type: "chemical/x-mdl-sdfile" }), exportFilename(structureName, "sdf"));
      } else if (format === "smi") {
        if (!readout.smiles) { setExportError("SMILES string not available for this drawing."); return; }
        downloadBlob(new Blob([`${readout.smiles}\n`], { type: "chemical/x-daylight-smiles" }), exportFilename(structureName, "smi"));
      }
    } catch {
      setExportError(editorText.exportFailed);
    }
  }

  async function exportHtml() {
    setExportError(null);
    try {
      const res = await downloadProjectHtml(projectId);
      downloadBlob(res.blob, res.filename);
    } catch {
      setExportError("Interactive HTML export requires a saved structure in the project.");
    }
  }

  async function exportArchive() {
    setExportError(null);
    try {
      const res = await downloadProjectArchive(projectId);
      downloadBlob(res.blob, res.filename);
    } catch {
      setExportError("Project archive export failed.");
    }
  }

  function exportXyz() {
    if (!candidate) {
      setExportError("Generate 3D coordinates first to export XYZ.");
      return;
    }
    const candAtoms = candidate.manifest.coordinate_representation.coordinates.atoms;
    const lines = [
      `${candAtoms.length}`,
      `${structureName || "Molecule"} · ChemDFT candidate [USER_ENTERED · NOT OPTIMIZED]`,
    ];
    for (const a of candAtoms) {
      lines.push(`${a.element} ${a.x.toFixed(6)} ${a.y.toFixed(6)} ${a.z.toFixed(6)}`);
    }
    downloadBlob(new Blob([lines.join("\n") + "\n"], { type: "chemical/x-xyz" }), exportFilename(structureName, "xyz"));
  }

  // ---- derived display ----
  const atoms = useMemo(() => candidate?.manifest.coordinate_representation.coordinates.atoms ?? [], [candidate]);
  const bonds = useMemo(() => candidate?.manifest.coordinate_representation.coordinates.bonds ?? [], [candidate]);
  const previewScene = useMemo(() => {
    if (!candidate) return null;
    return buildCandidatePreviewScene({
      candidateId: candidate.id,
      representationId: candidate.candidate_artifact.artifact_id,
      representationRevision: 1,
      representation: candidate.manifest.coordinate_representation,
    });
  }, [candidate]);
  const compositionChange = candidate ? lineageCompositionChange(target, atoms.map((atom) => atom.element)) : null;
  const commitAs = candidate ? describeTarget(target, candidate.manifest.coordinate_representation.name ?? structureName).commitAs : null;
  const elementCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const atom of atoms) counts[atom.element] = (counts[atom.element] ?? 0) + 1;
    return counts;
  }, [atoms]);
  const heavyElements = useMemo(
    () => Object.keys(elementCounts).filter((element) => element !== "H").sort((a, b) => (a === "C" ? -1 : b === "C" ? 1 : a.localeCompare(b))),
    [elementCounts],
  );
  const heavyAtomsDescription = useMemo(
    () => (heavyElements.length ? heavyElements.map((element) => elementCount(element, elementCounts[element] ?? 0)).join(", ") : "0 heavy atoms"),
    [elementCounts, heavyElements],
  );
  const compositionDescription = useMemo(() => {
    const parts = heavyElements.map((element) => elementCount(element, elementCounts[element] ?? 0));
    if (elementCounts["H"]) parts.push(elementCount("H", elementCounts["H"]));
    return parts.length ? parts.join(" + ") : plural(atoms.length, "atom");
  }, [elementCounts, heavyElements, atoms.length]);

  const title = target.kind === "new-version" ? `New version of “${target.parent.name}”` : editorText.newMoleculeTitle;
  const subtitle = target.kind === "new-version"
    ? `Saves as ${target.parent.name} · V${target.parent.nextRevision} · earlier versions are not changed`
    : editorText.newMoleculeSubtitle;
  const ready = Boolean(k);
  const drawingEmpty = readout.settled && !readout.smiles;

  return (
    <section className={styles.root} aria-label="Molecule editor" data-testid="ketcher-editor-panel" data-target-kind={target.kind}>
      <div className={styles.srOnly} role="status" aria-live="polite" data-testid="editor-status">{status}</div>

      <header className={styles.actionBar} data-testid="editor-action-bar">
        <ActionButton
          className={`${styles.backButton}`}
          icon="chevron-left"
          text={editorText.back}
          aria-label={editorText.backLabel}
          onClick={onCancel}
          data-testid="editor-back"
        />
        <div className={styles.titleBlock}>
          <h1 className={styles.title} data-testid="editor-title">{title}</h1>
          <span className={styles.badge} data-testid="editor-schematic-badge">{editorText.schematicBadge}</span>
          <Popover label={editorText.aboutLabel} iconOnly testId="editor-info" panelTestId="editor-info-panel">
            <p className={styles.infoText} data-testid="editor-subtitle">{subtitle}</p>
            <p className={styles.infoText}>{editorText.schematicNote}</p>
          </Popover>
        </div>
        {lineageNameFixed && target.kind === "new-version" ? (
          <div className={styles.lineageName} data-testid="editor-lineage-name">
            <span>Lineage:</span>
            <strong title={target.parent.name}>{target.parent.name}</strong>
            {onSwitchToNewMolecule ? (
              <ActionButton
                minimal
                small
                icon="add"
                text="Save as new molecule instead"
                disabled={!ready}
                onClick={() => { if (k) void readMolfile(k).then(onSwitchToNewMolecule); }}
                data-testid="editor-switch-to-new-molecule"
              />
            ) : null}
          </div>
        ) : (
          <div className={styles.nameField}>
            <label htmlFor="ketcher-mol-name">{editorText.nameLabel}</label>
            <input
              id="ketcher-mol-name"
              className="bp6-input"
              value={structureName}
              onChange={(event) => {
                setStructureName(event.target.value);
                invalidateCandidate("The molecule name changed. Press Generate 3D to regenerate under the new name.");
              }}
              placeholder={editorText.namePlaceholder}
              aria-describedby="ketcher-mol-name-hint"
              data-testid="molecule-name-input"
            />
            <span id="ketcher-mol-name-hint" className={styles.srOnly}>
              {structureName.trim() ? "" : `Unnamed molecules are saved as “${DEFAULT_NEW_MOLECULE_NAME}”.`}
            </span>
          </div>
        )}
        <Popover
          label={editorText.importLabel}
          testId="editor-import"
          panelTestId="editor-start-row"
          panelLabel={editorText.startFaster}
          wide
          disabled={!ready}
          open={importOpen}
          onOpenChange={setImportOpen}
        >
          <label className={styles.startLabel} htmlFor="editor-load-input">{editorText.loadLabel}</label>
          <div className={styles.loadLine}>
            <textarea
              id="editor-load-input"
              className={`bp6-input ${styles.loadInput}${loadMessage?.kind === "error" ? ` ${styles.loadInputInvalid}` : ""}`}
              rows={2}
              value={loadText}
              placeholder={editorText.loadPlaceholder}
              aria-invalid={loadMessage?.kind === "error"}
              aria-describedby="editor-load-message"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => { setLoadText(event.target.value); if (loadMessage) setLoadMessage(null); }}
              onKeyDown={(event) => {
                // One line submits on Enter; a pasted MOL block keeps its line breaks, so it needs Ctrl/Cmd+Enter.
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey || !loadText.includes("\n"))) { event.preventDefault(); void loadInto(loadText, "paste"); }
              }}
              data-testid="editor-load-input"
            />
            <button type="button" className={`${styles.textButton} ${styles.loadButton}`} disabled={!ready || loading || !loadText.trim()} onClick={() => void loadInto(loadText, "paste")} data-testid="editor-load-button">
              {editorText.load}
            </button>
          </div>
          <div className={styles.chipGroup} role="group" aria-label={editorText.templates}>
            <span className={styles.chipLabel}>{editorText.templates}</span>
            {STRUCTURE_TEMPLATES.filter((template) => template.featured).map((template) => (
              <button key={template.id} type="button" className={styles.chip} disabled={!ready || loading} onClick={() => void loadInto(template.smiles, "template")} data-testid={`template-${template.id}`}>
                {template.label}
              </button>
            ))}
            <PopMenu
              label={editorText.moreTemplates}
              disabled={!ready || loading}
              testId="template-more"
              items={STRUCTURE_TEMPLATES.filter((template) => !template.featured).map((template) => ({ id: template.id, label: template.label, onSelect: () => void loadInto(template.smiles, "template") }))}
            />
          </div>
          <p id="editor-load-message" className={`${styles.loadMessage}${loadMessage?.kind === "error" ? ` ${styles.loadError}` : loadMessage ? ` ${styles.loadOk}` : ""}`} role={loadMessage?.kind === "error" ? "alert" : undefined} data-testid="editor-load-message" hidden={!loadMessage}>
            {loadMessage?.text}
          </p>
        </Popover>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.textButton} ${styles.focusButton}`}
            aria-pressed={focusMode}
            title={`${focusMode ? editorText.focusExit : editorText.focus} (Esc to exit · Ctrl/Cmd+Shift+F)`}
            onClick={() => toggleFocus()}
            data-testid="editor-focus"
          >
            {focusMode ? editorText.focusExit : editorText.focus}
          </button>
          <ActionButton text={editorText.cancel} type="button" onClick={onCancel} data-testid="editor-cancel" />
          <ActionButton
            className={`${styles.generateButton}`}
            intent="primary"
            icon="cube"
            text={generating ? editorText.generating : editorText.generate3d}
            type="button"
            disabled={!ready || generating}
            onClick={() => void handleGenerate3D()}
            data-testid="generate-3d-btn"
          />
        </div>
      </header>
      {!importOpen && loadMessage ? (
        <p className={`${styles.loadStrip}${loadMessage.kind === "ok" ? ` ${styles.loadStripOk}` : ""}`} role={loadMessage.kind === "error" ? "alert" : "status"} data-testid="editor-load-message">{loadMessage.text}</p>
      ) : null}

      <div className={styles.body}>
        <EditorToolbar
          activeItem={activeItem}
          ready={ready}
          canUndo={history.undo > 0}
          canRedo={history.redo > 0}
          onActivate={(item) => void activate(item)}
          onNative={(testId) => { clickNative(testId); }}
        />
        <div className={styles.main}>
          <div className={styles.canvasWrap}>
            <div
              className={styles.frame}
              ref={frameRef}
              role="group"
              aria-label={editorText.canvasLabel}
              data-testid="editor-canvas-frame"
            >
              <KetcherHost initialMolfile={initialMolfile} onInit={adoptKetcher} onError={(message) => setStatus(message)} />
            </div>
            <AiDraftBanner ai={ai} />
            {selection ? (
              <div className={styles.selectionCard} data-testid="editor-selection-card" aria-live="polite">
                <strong>{editorText.selectionTitle}</strong>
                {selection.kind === "atom" ? (
                  <dl>
                    <dt>{editorText.selectionElement}</dt><dd>{selection.element}</dd>
                    <dt>{editorText.selectionCharge}</dt><dd>{formatCharge(selection.charge)}</dd>
                    {selection.valence !== null ? (<><dt>{editorText.selectionValence}</dt><dd>{selection.valence}</dd></>) : null}
                    <dt>{editorText.selectionValenceStatus}</dt>
                    <dd className={readout.check?.valence.ok === false ? styles.warn : styles.good}>{readout.check ? (readout.check.valence.ok ? editorText.valenceOk : readout.check.valence.text) : editorText.checksUnavailable}</dd>
                  </dl>
                ) : (
                  <p style={{ margin: "2px 0 0" }}>{selection.atoms} atoms, {selection.bonds} bonds selected</p>
                )}
              </div>
            ) : null}
            <div className={styles.hintStrip}>{editorText.canvasHint}</div>
          </div>
          <div className={styles.identifier} data-testid="editor-identifier-bar">
            <span className={styles.identifierLabel}>{editorText.smilesLabel}</span>
            <code className={`${styles.smiles}${readout.smiles ? "" : ` ${styles.smilesEmpty}`}`} data-testid="editor-smiles">
              {readout.smiles || (readout.settled ? editorText.smilesEmpty : "…")}
            </code>
            <button type="button" className={styles.copyButton} disabled={!readout.smiles} onClick={() => void copySmiles()} data-testid="editor-copy-smiles">
              {copyState === "copied" ? editorText.copied : copyState === "failed" ? editorText.copyFailed : editorText.copy}
            </button>
            {exportError ? <span className={styles.loadError} role="alert">{exportError}</span> : null}
            <span className={styles.identifierNote} title={editorText.identifierNote} data-testid="editor-identifier-note">{editorText.identifierNoteShort}</span>
            <ExportMenu
              context="drawing"
              hasCandidate={Boolean(candidate)}
              drawingEmpty={drawingEmpty}
              ready={ready}
              structureName={structureName}
              onExportHtml={exportHtml}
              onExportPdf={exportPdfDrawing}
              onExport3dPdf={() => setExport3dPdfOpen(true)}
              onExportXyz={exportXyz}
              onExportStructureFile={exportStructureFile}
              onExportArchive={exportArchive}
              onExportImage={exportImage}
              onShare={() => setShareDrawingOpen(true)}
              buttonTestId="editor-export"
              shareTestId="editor-share-drawing"
              disabled={!ready || drawingEmpty}
              disabledReason="Nothing drawn yet to export"
            />
          </div>
        </div>

        <AtomsRail activeItem={activeItem} ready={ready} onAtom={activateAtom} onGroup={(id, molfile) => void activateGroup(id, molfile)} onNative={(testId) => { clickNative(testId); }} />

        <aside className={styles.side} aria-label="Preview and checks">
          <div className={styles.card}>
            <div className={styles.tabs} role="tablist" aria-label="Side panel">
              <button type="button" role="tab" id="editor-tab-preview" aria-selected={tab === "preview"} aria-controls="editor-panel-preview" className={`${styles.tab}${tab === "preview" ? ` ${styles.tabActive}` : ""}`} onClick={() => setTab("preview")} data-testid="editor-tab-preview">
                {editorText.tabPreview}
              </button>
              <button type="button" role="tab" id="editor-tab-ai" aria-selected={tab === "ai"} aria-controls="editor-panel-ai" className={`${styles.tab}${tab === "ai" ? ` ${styles.tabActive}` : ""}`} onClick={() => setTab("ai")} data-testid="editor-tab-ai">
                {editorText.tabAi}
              </button>
              <span className={styles.tabNote}>{tab === "preview" ? (candidate ? "server-generated" : "not generated") : "RDKit-checked"}</span>
            </div>
            {tab === "ai" ? (
              <div className={styles.tabPanel} role="tabpanel" id="editor-panel-ai" aria-labelledby="editor-tab-ai" data-testid="editor-ai-slot">
                <AiDrawPanel ai={ai} ready={ready} />
              </div>
            ) : (
              <div className={styles.tabPanel} role="tabpanel" id="editor-panel-preview" aria-labelledby="editor-tab-preview" data-testid="editor-preview-panel">
                {error ? (
                  <div className={styles.errorBox} role="alert" data-testid="geometry-error-box">
                    <AppIcon icon="warning-sign" /> <strong>Error:</strong> {error}
                  </div>
                ) : null}
                {generating ? (
                  <div className={styles.emptyPreview} role="status" data-testid="editor-preview-busy">
                    <AppIcon icon="refresh" />
                    <p>{editorText.previewBusy}</p>
                  </div>
                ) : candidate && previewScene ? (
                  <div className={styles.review} data-testid="candidate-preview-container">
                    <div className={styles.reviewNotice} role="note">
                      <strong>GENERATED CONFORMER (NOT OPTIMIZED):</strong> RDKit ETKDGv3 generated 3D Cartesian coordinates with explicit hydrogen placement. They are not DFT optimized.
                    </div>
                    <div className={styles.metrics} data-testid="candidate-metrics-card">
                      <div><span>Chemical formula</span><strong>{candidate.manifest.formula}</strong></div>
                      <div><span>Total atoms</span><strong>{plural(atoms.length, "atom")}</strong></div>
                      <div><span>Heavy atoms</span><strong>{heavyAtomsDescription}</strong></div>
                      <div><span>Explicit hydrogens</span><strong>{candidate.manifest.explicit_hydrogen_count} hydrogens</strong></div>
                      <div><span>Bonds</span><strong>{plural(bonds.length, "bond")}</strong></div>
                      <div><span>Method</span><strong>{candidate.manifest.generation_method}</strong></div>
                    </div>
                    {candidate.manifest.canonical_smiles ? (
                      <div role="note" aria-label="Generated stereochemical identity">
                        <span>Canonical isomeric SMILES: </span><code>{candidate.manifest.canonical_smiles}</code>
                      </div>
                    ) : null}
                    <CandidatePreviewPanel
                      scene={previewScene}
                      title={`${candidate.manifest.formula || "Candidate"} (RDKit ETKDGv3)`}
                      subtitle={`Candidate ${candidate.id.slice(0, 8)} · ${plural(atoms.length, "atom")} · ${plural(bonds.length, "bond")}`}
                      warningText="GENERATED CONFORMER (NOT OPTIMIZED): real 3D coordinates generated server-side."
                      statusTagText="3D Candidate"
                    />
                    <details open={showCoordinatesTable} onToggle={(event) => setShowCoordinatesTable(event.currentTarget.open)}>
                      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Inspect Atomic Coordinates ({atoms.length} atoms in Ångström)</summary>
                      <div style={{ marginTop: 8, maxHeight: 220, overflow: "auto" }}>
                        <table className="structure-table" style={{ width: "100%", fontSize: 11 }}>
                          <thead><tr><th>#</th><th>El.</th><th>X</th><th>Y</th><th>Z</th></tr></thead>
                          <tbody>
                            {atoms.map((atom) => (
                              <tr key={atom.index}><td>{atom.index + 1}</td><td><strong>{atom.element}</strong></td><td>{atom.x.toFixed(4)}</td><td>{atom.y.toFixed(4)}</td><td>{atom.z.toFixed(4)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                    <div className={styles.acks} data-testid="candidate-acknowledgments">
                      <strong>Explicit human geometry review required</strong>
                      <label>
                        <input type="checkbox" checked={inspectedGeometry} onChange={(event) => setInspectedGeometry(event.target.checked)} data-testid="ack-inspected-geometry" />
                        <span><strong>I have inspected this 3D geometry</strong> and verified that its atoms ({atoms.length} total: {compositionDescription}) and connectivity are chemically plausible.</span>
                      </label>
                      <label>
                        <input type="checkbox" checked={understandsNotOptimized} onChange={(event) => setUnderstandsNotOptimized(event.target.checked)} data-testid="ack-understands-not-optimized" />
                        <span><strong>I understand these coordinates are an unoptimized ETKDG conformer</strong>, not a quantum-chemical minimum or experimental measurement.</span>
                      </label>
                    </div>
                    {commitAs ? (
                      <div className="editor-commit-summary" data-testid="editor-commit-summary">
                        <span>Accepting commits</span> <strong>{commitAs}</strong>
                        <span className="workspace-muted"> · {target.kind === "new-version" ? "new version of an existing structure" : "new, separate molecule"}</span>
                      </div>
                    ) : null}
                    {compositionChange && target.kind === "new-version" ? (
                      <div className="editor-composition-warning" role="alert" data-testid="editor-composition-warning">
                        <strong>Different molecule?</strong>
                        <span>The drawing is {compositionChange.candidate}, but “{target.parent.name}” V{target.parent.revision} is {compositionChange.parent}. A new version keeps the “{target.parent.name}” identity, and results of earlier versions stay attached to them.</span>
                        <label>
                          <input type="checkbox" checked={acceptCompositionChange} onChange={(event) => setAcceptCompositionChange(event.target.checked)} data-testid="ack-lineage-composition" />
                          <span>Keep it as V{target.parent.nextRevision} of “{target.parent.name}” (the composition change is intended)</span>
                        </label>
                        {onSwitchToNewMolecule ? (
                          <ActionButton small icon="add" text="Save as a new molecule instead" disabled={!ready} onClick={() => { if (k) void readMolfile(k).then(onSwitchToNewMolecule); }} data-testid="editor-composition-switch" />
                        ) : null}
                      </div>
                    ) : null}
                    <div className={styles.reviewActions}>
                      <ActionButton
                        intent="primary"
                        icon="tick"
                        text={accepting ? "Accepting geometry…" : "Accept 3D geometry"}
                        type="button"
                        disabled={!inspectedGeometry || !understandsNotOptimized || accepting || Boolean(compositionChange && !acceptCompositionChange)}
                        onClick={() => void handleAccept()}
                        data-testid="accept-geometry-btn"
                      />
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyPreview} data-testid="editor-preview-empty">
                    <AppIcon icon="cube" />
                    <strong>{editorText.previewEmptyTitle}</strong>
                    <p>{editorText.previewEmptyBody}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={`${styles.card} ${styles.checks}`} data-testid="editor-drawing-checks">
            <h2 className={styles.checksTitle}>{editorText.checksTitle} <span>· {editorText.checksSource}</span></h2>
            <dl className={styles.checksGrid}>
              <dt>{editorText.formula}</dt>
              <dd data-testid="check-formula">
                {readout.gross ? formulaRuns(readout.gross.formula).map((run, index) => (run.sub ? <sub key={index} className={styles.sub}>{run.text}</sub> : <span key={index}>{run.text}</span>)) : drawingEmpty ? "—" : readout.settled ? editorText.checksUnavailable : editorText.checksPending}
              </dd>
              {readout.gross && readout.gross.molecules.length > 0 ? (<>
                <dt>{editorText.molecules}</dt>
                <dd data-testid="check-molecules">{describeMolecules(readout.gross.molecules)}</dd>
              </>) : null}
              <dt>Total charge</dt>
              <dd data-testid="check-charge">
                <input type="number" step={1} className="bp6-input" style={{ width: 72 }} aria-label="Total charge of the species" placeholder="auto" value={chargeText} onChange={(event) => setChargeText(event.target.value)} />
                <span> {chargeText.trim() === "" ? "from the drawn charges (default)" : "set by you; must equal the sum of the drawn charges"}. Multiplicity 1 (closed shell).</span>
              </dd>
              <dt>{editorText.heavyAtoms}</dt>
              <dd data-testid="check-heavy-atoms">{readout.gross ? readout.gross.heavyAtoms : drawingEmpty ? "—" : readout.settled ? editorText.checksUnavailable : editorText.checksPending}</dd>
              <dt>{editorText.valence}</dt>
              <dd className={readout.check ? (readout.check.valence.ok ? styles.good : styles.warn) : undefined} data-testid="check-valence">
                {readout.check ? (readout.check.valence.ok ? editorText.valenceOk : readout.check.valence.text) : drawingEmpty ? "—" : readout.settled ? editorText.checksUnavailable : editorText.checksPending}
              </dd>
              <dt>{editorText.stereo}</dt>
              <dd data-testid="check-stereo">{readout.check ? (readout.check.stereo.none ? editorText.stereoNone : readout.check.stereo.text) : drawingEmpty ? "—" : readout.settled ? editorText.checksUnavailable : editorText.checksPending}</dd>
              {readout.check?.other.map((finding) => (
                <div key={finding.id} style={{ display: "contents" }}>
                  <dt>{finding.id.replace(/_/g, " ")}</dt>
                  <dd className={styles.warn}>{finding.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>

      <ShareDialog
        isOpen={shareDrawingOpen}
        onClose={() => setShareDrawingOpen(false)}
        title={structureName || "Chemical Drawing"}
        subtitle="Phase 1: Share 2D drawing or export files. No public link hosting."
        shareSummary={`ChemDFT Chemical Drawing: ${structureName || "Untitled"} · SMILES: ${readout.smiles || "N/A"} · Gross formula: ${
          readout.gross ? formulaRuns(readout.gross.formula).map((r) => r.text).join("") : "N/A"
        }. Created in ChemDFT Molecule Editor.`}
        onDownload={() => void exportImage("svg")}
        downloadLabel="Download SVG Drawing"
        downloadFilename={exportFilename(structureName, "svg")}
      />

      {candidate ? (
        <Export3dPdfDialog
          isOpen={export3dPdfOpen}
          onClose={() => setExport3dPdfOpen(false)}
          onOpenShare={() => {
            setExport3dPdfOpen(false);
            setShareDrawingOpen(true);
          }}
          projectId={projectId}
          structureName={structureName || "Chemical Structure"}
          formula={readout.gross ? formulaRuns(readout.gross.formula).map((r) => r.text).join("") : "Formula"}
          atomCount={candidate.manifest.coordinate_representation.coordinates.atoms.length}
          authority="USER_ENTERED · NOT OPTIMIZED"
        />
      ) : null}
    </section>
  );
}
