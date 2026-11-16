"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionButton, AppIcon, StatusTag } from "@chemdft/ui";
import { buildCandidatePreviewScene } from "@chemdft/scientific-scene";
import type {
  EntityReference,
  GeometryCandidateAcceptOutput,
  GeometryCandidateView,
} from "@chemdft/schemas";
import {
  acceptGeometryCandidate,
  generateGeometryCandidate,
} from "@/lib/structure-workspace-api";
import { CandidatePreviewPanel } from "./visualization/candidate-preview-panel";
import { normalizeDrawingMol as normalizeMol } from "@/lib/molecular-drawing-comparison";
import { DEFAULT_NEW_MOLECULE_NAME, describeTarget, lineageCompositionChange, type EditorTarget } from "@/lib/molecule-target";

export type KetcherApi = {
  getMolfile: (format?: string) => Promise<string>;
  setMolecule: (molfile: string) => Promise<void | undefined>;
  changeEvent?: {
    add: (handler: (action?: unknown) => void) => void;
    remove: (handler: (action?: unknown) => void) => void;
  };
};

const ELEMENT_NAMES: Record<string, { singular: string; plural: string }> = {
  H: { singular: "hydrogen", plural: "hydrogens" },
  C: { singular: "carbon", plural: "carbons" },
  O: { singular: "oxygen", plural: "oxygens" },
  N: { singular: "nitrogen", plural: "nitrogens" },
  S: { singular: "sulfur", plural: "sulfurs" },
  P: { singular: "phosphorus", plural: "phosphorus" },
  F: { singular: "fluorine", plural: "fluorines" },
  Cl: { singular: "chlorine", plural: "chlorines" },
  Br: { singular: "bromine", plural: "bromines" },
  I: { singular: "iodine", plural: "iodines" },
};

function formatElementCount(element: string, count: number): string {
  const info = ELEMENT_NAMES[element];
  const name =
    count === 1
      ? info?.singular ?? element.toLowerCase()
      : info?.plural ?? `${element.toLowerCase()}s`;
  return `${count} ${name}`;
}

type KetcherHostProps = {
  initialMolfile: string | null;
  onInit: (ketcher: KetcherApi) => void;
  onError?: (message: string) => void;
};

export const KetcherHost = dynamic<KetcherHostProps>(
  async () => {
    const [{ Editor }, { StandaloneStructServiceProvider }] = await Promise.all([
      import("ketcher-react"),
      import("ketcher-standalone"),
    ]);
    return function LazyKetcherHost({ initialMolfile, onInit, onError }: KetcherHostProps) {
      const structServiceProvider = useMemo(() => new StandaloneStructServiceProvider(), []);
      const initializedApis = useRef(new WeakSet<object>());
      const initialize = useCallback(async (ketcher: unknown) => {
        const api = ketcher as KetcherApi;
        // Ketcher reports the same molecule API again when its other editor finishes loading.
        // Seed each API once, including concurrent callbacks, so late readiness cannot erase edits.
        if (initializedApis.current.has(api)) return;
        initializedApis.current.add(api);
        try {
          if (initialMolfile) await api.setMolecule(initialMolfile);
        } catch (error: unknown) {
          onError?.(error instanceof Error ? error.message : "Unable to load molecular data in Ketcher.");
          return;
        }
        onInit(api);
        if (typeof window !== "undefined") {
          (window as unknown as { __ketcher?: KetcherApi }).__ketcher = api;
        }
      }, [initialMolfile, onInit, onError]);
      return (
        <Editor
          staticResourcesUrl="/"
          structServiceProvider={structServiceProvider}
          disableMacromoleculesEditor
          errorHandler={(message: string) => {
            onError?.(message);
            console.error(message);
          }}
          onInit={initialize}
        />
      );
    };
  },
  {
    ssr: false,
    loading: () => <div className="ketcher-loading">Loading Ketcher editor…</div>,
  },
);

export interface KetcherEditorPanelProps {
  initialMolfile: string | null;
  mode: "new" | "edit" | "candidate";
  projectId?: string;
  parentStructureVersion?: EntityReference | null;
  structureName?: string;
  /** Frozen save target (New molecule / New version); when present the editor states it explicitly. */
  target?: EditorTarget | null;
  /** Re-open the current drawing as a separate molecule instead of a new version of the lineage. */
  onSwitchToNewMolecule?: (molfile: string) => void;
  onCancel: () => void;
  onSave?: (molfile: string) => Promise<void>;
  onAccepted?: (output: GeometryCandidateAcceptOutput) => Promise<void> | void;
}

export function KetcherEditorPanel({
  initialMolfile,
  mode,
  projectId,
  parentStructureVersion,
  structureName: initialStructureName = "",
  target = null,
  onSwitchToNewMolecule,
  onCancel,
  onSave,
  onAccepted,
}: KetcherEditorPanelProps) {
  const [ketcher, setKetcher] = useState<KetcherApi | null>(null);
  const [structureName, setStructureName] = useState(
    target?.kind === "new-version"
      ? target.parent.name
      : initialStructureName || (mode === "edit" && !target ? "Edited molecule" : ""),
  );
  // A new version keeps its lineage's name; the server ignores a name sent with a parent version.
  const lineageNameFixed = target?.kind === "new-version";
  const [acceptCompositionChange, setAcceptCompositionChange] = useState(false);
  const [status, setStatus] = useState(
    projectId
      ? "2D Drawing: Ketcher editor. Click 'Generate 3D' to run server-side RDKit ETKDGv3 conformer generation with explicit hydrogens."
      : mode === "candidate"
      ? "Candidate draft only. ChemDFT will validate the MOL output and keep any preview unverified."
      : "Ketcher is the editor adapter; ChemDFT validates saved chemistry server-side.",
  );
  const [generating, setGenerating] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [savingLegacy, setSavingLegacy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 3D Candidate state
  const [candidate, setCandidate] = useState<GeometryCandidateView | null>(null);
  const [candidateSourceMol, setCandidateSourceMol] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [inspectedGeometry, setInspectedGeometry] = useState(false);
  const [understandsNotOptimized, setUnderstandsNotOptimized] = useState(false);
  const [showCoordinatesTable, setShowCoordinatesTable] = useState(false);
  const generationEpochRef = useRef(0);

  const invalidateCandidate = useCallback(
    (
      reason = "Drawing modified. Previous 3D candidate invalidated. Click 'Generate 3D' to generate coordinates for the revised drawing.",
    ) => {
      generationEpochRef.current += 1;
      // The edited drawing owns the next request; the invalidated request's
      // guarded finally must not clear a newer request's loading state.
      setGenerating(false);
      setCandidate((prev) => {
        if (prev !== null) {
          setStatus(reason);
        }
        return null;
      });
      setShowPreview(false);
      setInspectedGeometry(false);
      setUnderstandsNotOptimized(false);
      setAcceptCompositionChange(false);
      setCandidateSourceMol(null);
      setError(null);
    },
    [],
  );

  useEffect(() => () => {
    // Ignore pending generation results after this editor has been closed.
    generationEpochRef.current += 1;
  }, []);

  useEffect(() => {
    if (!ketcher || !ketcher.changeEvent) return;
    const onChange = () => {
      invalidateCandidate();
    };
    ketcher.changeEvent.add(onChange);
    return () => {
      ketcher.changeEvent?.remove(onChange);
    };
  }, [ketcher, invalidateCandidate]);

  useEffect(() => {
    if (ketcher && initialMolfile) void ketcher.setMolecule(initialMolfile);
  }, [initialMolfile, ketcher]);

  // Build 3D PreviewScene for the current candidate
  const previewScene = useMemo(() => {
    if (!candidate) return null;
    return buildCandidatePreviewScene({
      candidateId: candidate.id,
      representationId: candidate.candidate_artifact.artifact_id,
      representationRevision: 1,
      representation: candidate.manifest.coordinate_representation,
    });
  }, [candidate]);

  async function handleGenerate3D() {
    if (!ketcher || !projectId) return;
    const thisEpoch = ++generationEpochRef.current;
    setError(null);
    setGenerating(true);
    setCandidate(null);
    setShowPreview(false);
    setInspectedGeometry(false);
    setUnderstandsNotOptimized(false);
    setAcceptCompositionChange(false);
    setCandidateSourceMol(null);
    setStatus("Extracting MOL representation from Ketcher…");
    try {
      const molfile = await ketcher.getMolfile();
      if (thisEpoch !== generationEpochRef.current) return;
      if (!molfile || !molfile.trim() || !molfile.includes("M  END")) {
        throw new Error(
          "Draw a complete molecular structure in Ketcher before generating 3D coordinates.",
        );
      }
      setStatus("Generating 3D conformer via RDKit ETKDGv3 and placing explicit hydrogens…");
      const name = structureName.trim() || DEFAULT_NEW_MOLECULE_NAME;
      const result = await generateGeometryCandidate({
        projectId,
        payload: {
          mol_block: molfile,
          name,
          expected_charge: 0,
          multiplicity: 1,
          parent_structure_version: parentStructureVersion ?? null,
        },
      });
      if (thisEpoch !== generationEpochRef.current) return;
      const currentMol = await ketcher.getMolfile();
      if (
        thisEpoch !== generationEpochRef.current ||
        normalizeMol(currentMol) !== normalizeMol(molfile)
      ) {
        setStatus(
          "Drawing was modified during 3D generation. Discarded stale candidate. Click 'Generate 3D' to regenerate.",
        );
        return;
      }
      setCandidateSourceMol(molfile);
      setCandidate(result);
      setShowPreview(true);
      setInspectedGeometry(false);
      setUnderstandsNotOptimized(false);
      setStatus(
        `3D candidate generated: ${result.manifest.formula} with ${result.manifest.coordinate_representation.coordinates.atoms.length} atoms (${result.manifest.source_atom_count} heavy, ${result.manifest.explicit_hydrogen_count} explicit H). Inspect preview and explicitly accept geometry.`,
      );
    } catch (err) {
      if (thisEpoch !== generationEpochRef.current) return;
      const message = err instanceof Error ? err.message : "3D conformer generation failed.";
      setError(message);
      setStatus(message);
    } finally {
      if (thisEpoch === generationEpochRef.current) {
        setGenerating(false);
      }
    }
  }

  async function handleViewCandidate() {
    if (!candidate || !ketcher) return;
    const currentMol = await ketcher.getMolfile();
    if (!candidateSourceMol || normalizeMol(currentMol) !== normalizeMol(candidateSourceMol)) {
      invalidateCandidate(
        "Previous 3D candidate is stale because drawing changed. Click 'Generate 3D' to regenerate.",
      );
      return;
    }
    setShowPreview(true);
  }

  async function handleAccept() {
    if (!candidate || !projectId || !ketcher) return;
    const currentMol = await ketcher.getMolfile();
    if (!candidateSourceMol || normalizeMol(currentMol) !== normalizeMol(candidateSourceMol)) {
      invalidateCandidate(
        "Cannot accept: Ketcher drawing was modified after candidate generation. Click 'Generate 3D' to regenerate.",
      );
      setError(
        "Cannot accept: Ketcher drawing was modified after candidate generation. Please generate a new 3D candidate.",
      );
      return;
    }
    if (!inspectedGeometry || !understandsNotOptimized) {
      setError("Both acknowledgments are required before geometry acceptance.");
      return;
    }
    if (compositionChange && !acceptCompositionChange) {
      setError(`The drawing (${compositionChange.candidate}) differs from the ${target?.kind === "new-version" ? target.parent.name : "parent"} lineage (${compositionChange.parent}). Confirm the new version or save it as a new molecule.`);
      return;
    }
    setAccepting(true);
    setError(null);
    setStatus("Accepting geometry and committing immutable StructureVersion…");
    try {
      const output = await acceptGeometryCandidate({
        projectId,
        candidateId: candidate.id,
        payload: {
          candidate_sha256: candidate.candidate_artifact.sha256,
          inspected_geometry: true,
          understands_not_optimized: true,
        },
      });
      setStatus(
        `Immutable StructureVersion committed: ${output.structure.name} V${output.version.revision} (${output.version.coordinates?.atoms.length ?? 0} atoms). Ready for calculations.`,
      );
      if (onAccepted) {
        await onAccepted(output);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Geometry acceptance failed.";
      setError(message);
      setStatus(message);
    } finally {
      setAccepting(false);
    }
  }

  async function saveLegacyMolfile() {
    if (!ketcher || !onSave) return;
    setSavingLegacy(true);
    setError(null);
    setStatus("Reading MOL output from Ketcher…");
    try {
      const molfile = await ketcher.getMolfile();
      setStatus("Submitting MOL output for validation…");
      await onSave(molfile);
      setStatus(
        mode === "candidate"
          ? "Candidate representation saved; no structure version was created."
          : "Committed immutable structure version.",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ketcher save failed.";
      setError(message);
      setStatus(message);
    } finally {
      setSavingLegacy(false);
    }
  }

  const atoms = useMemo(
    () => candidate?.manifest.coordinate_representation.coordinates.atoms ?? [],
    [candidate],
  );
  const bonds = useMemo(
    () => candidate?.manifest.coordinate_representation.coordinates.bonds ?? [],
    [candidate],
  );
  const totalAtoms = atoms.length;
  const compositionChange = target && candidate ? lineageCompositionChange(target, atoms.map((atom) => atom.element)) : null;
  const targetSummary = target ? describeTarget(target, structureName) : null;
  // What the accepted candidate will be committed as: the name it was generated with (new molecule)
  // or the lineage name (new version).
  const commitAs = target && candidate
    ? describeTarget(target, candidate.manifest.coordinate_representation.name ?? structureName).commitAs
    : null;
  const explicitH = candidate?.manifest.explicit_hydrogen_count ?? 0;
  const formula = candidate?.manifest.formula ?? "";

  const elementCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const atom of atoms) {
      counts[atom.element] = (counts[atom.element] ?? 0) + 1;
    }
    return counts;
  }, [atoms]);

  const heavyElements = useMemo(() => {
    const els = Object.keys(elementCounts).filter((el) => el !== "H");
    return els.sort((a, b) => {
      if (a === "C") return -1;
      if (b === "C") return 1;
      return a.localeCompare(b);
    });
  }, [elementCounts]);

  const heavyAtomsDescription = useMemo(() => {
    if (heavyElements.length === 0) return "0 heavy atoms";
    return heavyElements.map((el) => formatElementCount(el, elementCounts[el] ?? 0)).join(", ");
  }, [elementCounts, heavyElements]);

  const compositionDescription = useMemo(() => {
    const parts: string[] = [];
    if (elementCounts["C"]) {
      parts.push(formatElementCount("C", elementCounts["C"] ?? 0));
    }
    for (const el of heavyElements) {
      if (el !== "C") {
        parts.push(formatElementCount(el, elementCounts[el] ?? 0));
      }
    }
    if (elementCounts["H"]) {
      parts.push(formatElementCount("H", elementCounts["H"] ?? 0));
    }
    return parts.length > 0 ? parts.join(" + ") : `${totalAtoms} atoms`;
  }, [elementCounts, heavyElements, totalAtoms]);

  return (
    <section
      className="structure-pane ketcher-panel"
      aria-label="Ketcher molecule editor and 3D preview"
      data-testid="ketcher-editor-panel"
    >
      {targetSummary ? (
        <div className="editor-save-target" role="note" data-testid="editor-save-target" data-target-kind={target?.kind}>
          <strong className="editor-save-target-action">{targetSummary.action}</strong>
          <span>Saves as <strong data-testid="editor-save-target-commit">{targetSummary.commitAs}</strong></span>
          <span className="editor-save-target-detail">{targetSummary.detail}</span>
        </div>
      ) : null}
      {/* 2D Ketcher Editor Container - Preserved in DOM so canvas is never lost */}
      <div style={{ display: showPreview ? "none" : "block" }}>
        <div className="pane-heading">
          <div>
            <h2>
              {mode === "candidate"
                ? "Draw candidate representation"
                : mode === "new"
                ? "Draw molecule in Ketcher"
                : "Edit molecule drawing"}
            </h2>
            <p>
              Editor state is schematic 2D. Real 3D computational coordinates and explicit hydrogens
              must be generated server-side using RDKit ETKDGv3.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {candidate ? (
              <ActionButton
                minimal
                small
                icon="cube"
                text="View 3D Candidate →"
                onClick={() => void handleViewCandidate()}
              />
            ) : null}
            <StatusTag intent="success">2D Editor · Ketcher</StatusTag>
          </div>
        </div>

        {projectId && lineageNameFixed && target?.kind === "new-version" ? (
          <div className="editor-name-row" data-testid="editor-lineage-name">
            <span className="editor-name-label">Structure lineage:</span>
            <strong>{target.parent.name}</strong>
            <span className="workspace-muted">
              V{target.parent.revision} → V{target.parent.nextRevision}. To give the drawing its own name and history, use New molecule instead.
            </span>
            {onSwitchToNewMolecule ? (
              <ActionButton
                minimal
                small
                icon="add"
                text="Save as new molecule instead"
                disabled={!ketcher}
                onClick={() => { if (ketcher) void ketcher.getMolfile().then(onSwitchToNewMolecule); }}
                data-testid="editor-switch-to-new-molecule"
              />
            ) : null}
          </div>
        ) : projectId ? (
          <div className="editor-name-row">
            <label htmlFor="ketcher-mol-name" className="editor-name-label">
              Molecule name:
            </label>
            <input
              id="ketcher-mol-name"
              className="bp6-input bp6-small"
              style={{ width: "240px" }}
              value={structureName}
              onChange={(e) => {
                setStructureName(e.target.value);
                // The candidate carries the name it was generated with; a different name needs a new candidate.
                invalidateCandidate("Molecule name changed. Click 'Generate 3D' to regenerate the candidate under the new name.");
              }}
              placeholder="e.g. n-Hexane or Ethanol"
              aria-describedby="ketcher-mol-name-hint"
              data-testid="molecule-name-input"
            />
            <span id="ketcher-mol-name-hint" className="workspace-muted">
              {structureName.trim() ? "" : `Unnamed molecules are saved as “${DEFAULT_NEW_MOLECULE_NAME}”.`}
            </span>
          </div>
        ) : null}

        <div className="ketcher-frame">
          <KetcherHost initialMolfile={initialMolfile} onInit={setKetcher} />
        </div>

        {error ? (
          <div
            style={{
              padding: "10px 14px",
              backgroundColor: "#fee2e2",
              borderLeft: "4px solid #ef4444",
              color: "#991b1b",
              fontSize: "12px",
              fontWeight: 500,
            }}
            role="alert"
            data-testid="geometry-error-box"
          >
            <AppIcon icon="warning-sign" /> <strong style={{ marginLeft: "4px" }}>Scientific Validation Error:</strong> {error}
          </div>
        ) : null}

        <div className="editor-status">
          <span>{status}</span>
        </div>

        <div className="structure-actions">
          <ActionButton text="Cancel" type="button" onClick={onCancel} />
          {candidate ? (
            <ActionButton
              icon="cube"
              text="View Generated 3D Candidate"
              type="button"
              onClick={() => void handleViewCandidate()}
            />
          ) : null}
          {projectId ? (
            <ActionButton
              intent="primary"
              icon="cube"
              text={generating ? "Generating 3D conformer with RDKit…" : "Generate 3D"}
              type="button"
              disabled={!ketcher || generating}
              onClick={() => void handleGenerate3D()}
              data-testid="generate-3d-btn"
            />
          ) : (
            <ActionButton
              intent="primary"
              text={savingLegacy ? "Saving…" : "Save candidate draft"}
              type="button"
              disabled={!ketcher || savingLegacy}
              onClick={() => void saveLegacyMolfile()}
            />
          )}
        </div>
      </div>

      {/* 3D Candidate Preview & Explicit Acceptance */}
      {showPreview && candidate && previewScene ? (
        <div data-testid="candidate-preview-container" style={{ display: "grid", gap: "12px" }}>
          <div className="pane-heading">
            <div>
              <h2>
                3D Candidate Preview · {formula || "Molecule"} ({totalAtoms} atoms)
              </h2>
              <p>
                RDKit ETKDGv3 generated real 3D coordinates. Mouse drag to rotate, scroll to zoom, click
                atoms to inspect. Acceptance creates an immutable StructureVersion.
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <ActionButton
                minimal
                small
                icon="edit"
                text="← Back to 2D Editor"
                onClick={() => setShowPreview(false)}
                data-testid="back-to-editor-btn"
              />
              <StatusTag intent="warning">3D Candidate · Pending Review</StatusTag>
            </div>
          </div>

          {/* Scientific Notice */}
          <div
            style={{
              padding: "10px 14px",
              backgroundColor: "#fffbeb",
              border: "1px solid #f59e0b",
              borderRadius: "4px",
              color: "#92400e",
              fontSize: "12px",
              lineHeight: 1.5,
            }}
            role="note"
          >
            <strong>GENERATED CONFORMER (NOT OPTIMIZED):</strong> RDKit ETKDGv3 generated 3D Cartesian coordinates with explicit hydrogen placement. These are reviewed computational coordinates for subsequent quantum-chemical calculations; they are not yet DFT optimized.
          </div>

          {/* Candidate Metrics Card */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "8px",
              padding: "10px 14px",
              backgroundColor: "#f8fafc",
              border: "1px solid var(--cdf-line)",
              borderRadius: "4px",
              fontSize: "12px",
            }}
            data-testid="candidate-metrics-card"
          >
            <div>
              <span style={{ color: "var(--cdf-ink-muted)", display: "block" }}>Chemical Formula</span>
              <strong style={{ fontSize: "14px", color: "var(--cdf-ink)" }}>{formula}</strong>
            </div>
            <div>
              <span style={{ color: "var(--cdf-ink-muted)", display: "block" }}>Total Atoms</span>
              <strong style={{ fontSize: "14px", color: "var(--cdf-ink)" }}>
                {totalAtoms} atoms
              </strong>
            </div>
            <div>
              <span style={{ color: "var(--cdf-ink-muted)", display: "block" }}>Heavy Atoms</span>
              <strong style={{ fontSize: "14px", color: "var(--cdf-ink)" }}>
                {heavyAtomsDescription}
              </strong>
            </div>
            <div>
              <span style={{ color: "var(--cdf-ink-muted)", display: "block" }}>Explicit Hydrogens</span>
              <strong style={{ fontSize: "14px", color: "var(--cdf-ink)" }}>
                {explicitH} hydrogens
              </strong>
            </div>
            <div>
              <span style={{ color: "var(--cdf-ink-muted)", display: "block" }}>Bonds</span>
              <strong style={{ fontSize: "14px", color: "var(--cdf-ink)" }}>
                {bonds.length} bonds
              </strong>
            </div>
            <div>
              <span style={{ color: "var(--cdf-ink-muted)", display: "block" }}>Generation Method</span>
              <strong style={{ fontSize: "13px", color: "var(--cdf-ink)" }}>
                {candidate.manifest.generation_method}
              </strong>
            </div>
            <div>
              <span style={{ color: "var(--cdf-ink-muted)", display: "block" }}>Candidate Hash</span>
              <code style={{ fontSize: "11px", color: "#475569" }}>
                {candidate.candidate_artifact.sha256.slice(0, 16)}…
              </code>
            </div>
          </div>

          {/* Interactive 3D WebGL Viewport */}
          {candidate.manifest.canonical_smiles ? (
            <div role="note" aria-label="Generated stereochemical identity">
              <span>Canonical isomeric SMILES: </span>
              <code>{candidate.manifest.canonical_smiles}</code>
              <p className="workspace-muted">
                The generated conformer preserves this displayed stereochemical identity.
                It is not an optimized minimum.
              </p>
            </div>
          ) : null}
          <CandidatePreviewPanel
            scene={previewScene}
            title={`${formula || "Candidate"} (RDKit ETKDGv3)`}
            subtitle={`Candidate ${candidate.id.slice(0, 8)} · ${totalAtoms} atoms · ${bonds.length} bonds`}
            warningText="GENERATED CONFORMER (NOT OPTIMIZED) — Real 3D coordinates generated server-side. Drag to rotate, scroll to zoom, select atoms to measure distance."
            statusTagText="3D Candidate"
          />

          {/* Inspect Coordinates Table */}
          <details
            style={{
              padding: "8px 12px",
              border: "1px solid var(--cdf-line)",
              borderRadius: "4px",
              backgroundColor: "#fafafa",
              fontSize: "12px",
            }}
            open={showCoordinatesTable}
            onToggle={(e) => setShowCoordinatesTable(e.currentTarget.open)}
          >
            <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cdf-ink)" }}>
              Inspect Atomic Coordinates ({totalAtoms} atoms in Ångström)
            </summary>
            <div style={{ marginTop: "10px", maxHeight: "240px", overflowY: "auto" }}>
              <table className="structure-table" style={{ width: "100%", fontSize: "11px" }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Element</th>
                    <th>X (Å)</th>
                    <th>Y (Å)</th>
                    <th>Z (Å)</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {atoms.map((atom) => (
                    <tr key={atom.index}>
                      <td>{atom.index + 1}</td>
                      <td><strong>{atom.element}</strong></td>
                      <td>{atom.x.toFixed(4)}</td>
                      <td>{atom.y.toFixed(4)}</td>
                      <td>{atom.z.toFixed(4)}</td>
                      <td>{atom.element === "H" ? "Explicit Hydrogen" : "Heavy Atom"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {/* Explicit Human Acceptance Acknowledgments */}
          <div
            style={{
              display: "grid",
              gap: "8px",
              padding: "12px 14px",
              backgroundColor: "#f0fdf4",
              border: "1px solid #86efac",
              borderRadius: "4px",
            }}
            data-testid="candidate-acknowledgments"
          >
            <strong style={{ fontSize: "13px", color: "#166534" }}>
              Explicit Human Geometry Review Required
            </strong>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                cursor: "pointer",
                fontSize: "12px",
                color: "#14532d",
              }}
            >
              <input
                type="checkbox"
                checked={inspectedGeometry}
                onChange={(e) => setInspectedGeometry(e.target.checked)}
                data-testid="ack-inspected-geometry"
                style={{ marginTop: "2px" }}
              />
              <span>
                <strong>I have inspected this 3D geometry</strong> and verified that its atoms ({totalAtoms} total: {compositionDescription}) and connectivity are chemically plausible.
              </span>
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                cursor: "pointer",
                fontSize: "12px",
                color: "#14532d",
              }}
            >
              <input
                type="checkbox"
                checked={understandsNotOptimized}
                onChange={(e) => setUnderstandsNotOptimized(e.target.checked)}
                data-testid="ack-understands-not-optimized"
                style={{ marginTop: "2px" }}
              />
              <span>
                <strong>I understand these coordinates are an unoptimized ETKDG conformer</strong>, not a quantum-chemical minimum or experimental measurement.
              </span>
            </label>
          </div>

          {commitAs ? (
            <div className="editor-commit-summary" data-testid="editor-commit-summary">
              <span>Accepting commits</span> <strong>{commitAs}</strong>
              <span className="workspace-muted"> · {target?.kind === "new-version" ? "new version of an existing structure" : "new, separate molecule"}</span>
            </div>
          ) : null}

          {compositionChange && target?.kind === "new-version" ? (
            <div className="editor-composition-warning" role="alert" data-testid="editor-composition-warning">
              <strong>Different molecule?</strong>
              <span>
                The drawing is {compositionChange.candidate}, but “{target.parent.name}” V{target.parent.revision} is {compositionChange.parent}.
                A new version keeps the “{target.parent.name}” identity, and results of earlier versions stay attached to them.
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={acceptCompositionChange}
                  onChange={(e) => setAcceptCompositionChange(e.target.checked)}
                  data-testid="ack-lineage-composition"
                />
                <span>Keep it as V{target.parent.nextRevision} of “{target.parent.name}” (the composition change is intended)</span>
              </label>
              {onSwitchToNewMolecule ? (
                <ActionButton
                  small
                  icon="add"
                  text="Save as a new molecule instead"
                  disabled={!ketcher}
                  onClick={() => { if (ketcher) void ketcher.getMolfile().then(onSwitchToNewMolecule); }}
                  data-testid="editor-composition-switch"
                />
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div
              style={{
                padding: "10px 14px",
                backgroundColor: "#fee2e2",
                borderLeft: "4px solid #ef4444",
                color: "#991b1b",
                fontSize: "12px",
                fontWeight: 500,
              }}
              role="alert"
              data-testid="geometry-error-box"
            >
              <AppIcon icon="warning-sign" /> <strong style={{ marginLeft: "4px" }}>Acceptance Error:</strong> {error}
            </div>
          ) : null}

          {/* Action buttons */}
          <div className="structure-actions">
            <ActionButton
              text="← Edit 2D Drawing"
              type="button"
              onClick={() => setShowPreview(false)}
              data-testid="back-to-editor-btn"
            />
            <ActionButton text="Cancel" type="button" onClick={onCancel} />
            <ActionButton
              intent="primary"
              icon="tick"
              text={accepting ? "Accepting Geometry…" : "Accept 3D Geometry"}
              type="button"
              disabled={!inspectedGeometry || !understandsNotOptimized || accepting || Boolean(compositionChange && !acceptCompositionChange)}
              onClick={() => void handleAccept()}
              data-testid="accept-geometry-btn"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
