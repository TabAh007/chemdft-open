"use client";

import { HelpTip } from "@/app/_components/help/help-tip";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type {
  MolecularOrbital,
  MolecularOrbitalAnalysis,
  StructureVersionDetail,
  VolumetricFieldOutput,
} from "@chemdft/schemas";
import { ActionButton, AppIcon } from "@chemdft/ui";
import { isovalueBounds, type VolumetricField } from "@chemdft/scientific-scene";
import { IsovalueControl } from "@/app/_components/isovalue-control";
import { getStructureVersion, getVolumetricFieldGrid } from "@/lib/structure-workspace-api";
import type { FieldMode } from "@/lib/electronic-workbench";
import {
  formatOrbitalLabel,
  formatOrbitalNumber,
  hartreeToEv,
} from "@/lib/scientific-format";
import {
  GuidedDisclosure,
  GuidedMetric,
  GuidedResultTab,
  GuidedStatus,
} from "./guided-primitives";

const OrbitalViewport = dynamic(
  () =>
    import(
      "../../[locale]/projects/[projectId]/workspace/visualization/orbital-isosurface-viewport"
    ),
  {
    ssr: false,
    loading: () => (
      <div className="mo-viewport-fallback" role="status">
        <span className="guided-spinner" aria-hidden="true" />
        <p>Loading 3D volumetric field renderer…</p>
      </div>
    ),
  },
);

const DEFAULT_ISOVALUE = 0.035;

export interface GuidedResultViewProps {
  projectId: string;
  calculationId: string;
  resultId: string;
  result: MolecularOrbitalAnalysis;
  initialTab?: FieldMode;
  onOptimizeGeometry: () => void;
  /** Recorded state: true when a converged optimization already exists, false when none does, undefined when unknown (then no optimization is suggested). */
  hasOptimizedGeometry?: boolean | undefined;
  onOpenAiScientist: () => void;
  onNavigateStructure: () => void;
  onNavigateHome: () => void;
  onSwitchToAdvanced: () => void;
}

export function GuidedResultView({
  projectId,
  calculationId,
  resultId,
  result,
  initialTab = "MO",
  onOptimizeGeometry,
  hasOptimizedGeometry,
  onOpenAiScientist,
  onNavigateStructure,
  onNavigateHome,
}: GuidedResultViewProps) {
  const [mode, setMode] = useState<FieldMode>(initialTab);
  const [structure, setStructure] = useState<StructureVersionDetail | null>(null);
  const [grid, setGrid] = useState<VolumetricFieldOutput | null>(null);
  const [potential, setPotential] = useState<VolumetricFieldOutput | undefined>();
  const [gridState, setGridState] = useState<"READY" | "GENERATING" | "FAILED" | "NOT_GENERATED">("NOT_GENERATED");
  const [isovalue, setIsovalue] = useState(DEFAULT_ISOVALUE);
  const [densityIso, setDensityIso] = useState(0.001);
  const [opacity] = useState(0.58);
  const [fitToken, setFitToken] = useState(0);
  // Colour scale of the ESP surface exactly as rendered (symmetric about zero), reported by the viewport.
  const [espScale, setEspScale] = useState<number | null>(null);

  const defaultFrontier = result.frontier_by_spin[0]!;
  const homoOrbital = result.orbitals.find(
    (o) => o.index === defaultFrontier.homo_index && o.spin_channel === defaultFrontier.spin_channel,
  )!;
  const lumoOrbital = result.orbitals.find(
    (o) => o.index === defaultFrontier.lumo_index && o.spin_channel === defaultFrontier.spin_channel,
  )!;

  const [selectedOrbital, setSelectedOrbital] = useState<MolecularOrbital>(homoOrbital);

  // Load structure coordinates once
  useEffect(() => {
    let alive = true;
    void getStructureVersion({
      projectId,
      structureId: result.input_structure_id,
      versionId: result.input_structure_version_id,
    })
      .then((detail) => {
        if (alive) setStructure(detail);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, result.input_structure_id, result.input_structure_version_id]);

  // Load volumetric grid deterministically from saved result
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (alive) setGridState("GENERATING");
    });

    const slowTimer = setTimeout(() => {
      if (alive) setGridState((current) => (current === "GENERATING" ? "FAILED" : current));
    }, 120_000);
    async function loadGrid() {
      try {
        if (mode === "MO") {
          const loaded = await getVolumetricFieldGrid({
            projectId,
            calculationId,
            request: {
              field_kind: "MO_AMPLITUDE",
              grid_profile: "STANDARD",
              orbital_index: selectedOrbital.index,
              spin_channel: selectedOrbital.spin_channel,
            },
          });
          if (alive) {
            setGrid(loaded);
            setPotential(undefined);
            setGridState("READY");
          }
        } else if (mode === "Density") {
          const loaded = await getVolumetricFieldGrid({
            projectId,
            calculationId,
            request: {
              field_kind: "ELECTRON_DENSITY",
              grid_profile: "STANDARD",
            },
          });
          if (alive) {
            setGrid(loaded);
            setPotential(undefined);
            setGridState("READY");
          }
        } else if (mode === "ESP") {
          const [densGrid, espGrid] = await Promise.all([
            getVolumetricFieldGrid({
              projectId,
              calculationId,
              request: {
                field_kind: "ELECTRON_DENSITY",
                grid_profile: "STANDARD",
              },
            }),
            getVolumetricFieldGrid({
              projectId,
              calculationId,
              request: {
                field_kind: "ELECTROSTATIC_POTENTIAL",
                grid_profile: "STANDARD",
              },
            }),
          ]);
          if (alive) {
            setGrid(densGrid);
            setPotential(espGrid);
            setGridState("READY");
          }
        }
      } catch {
        if (alive) setGridState("FAILED");
      }
    }

    void loadGrid();

    return () => {
      alive = false;
      clearTimeout(slowTimer);
    };
  }, [mode, selectedOrbital, projectId, calculationId]);

  // Sync workspace selection context for AI Scientist
  useEffect(() => {
    const structureName = structure?.structure?.name ?? "Input structure";
    const revision = structure?.version?.revision ?? 1;
    const base = `${structureName} V${revision} → Electronic structure`;
    let viewLabel = `${base} → HOMO`;
    if (mode === "Density") {
      viewLabel = `${base} → Electron density`;
    } else if (mode === "ESP") {
      viewLabel = `${base} → Electrostatic potential`;
    } else if (mode === "MO") {
      const isHomo = selectedOrbital.index === homoOrbital.index;
      const isLumo = selectedOrbital.index === lumoOrbital.index;
      const tag = isHomo ? "HOMO" : isLumo ? "LUMO" : `MO ${formatOrbitalNumber(selectedOrbital.index)}`;
      viewLabel = `${base} → ${tag}`;
    }
    window.dispatchEvent(
      new CustomEvent("chemdft:workspace-selection", {
        detail: {
          projectId,
          structureName,
          structureVersionRevision: revision,
          currentView: viewLabel,
        },
      }),
    );
  }, [structure, mode, selectedOrbital, homoOrbital.index, lumoOrbital.index, projectId]);

  const currentIso = mode === "Density" ? densityIso : isovalue;
  const setCurrentIso = mode === "Density" ? setDensityIso : setIsovalue;

  const bounds = useMemo(
    () =>
      grid
        ? isovalueBounds(grid as unknown as VolumetricField, mode !== "MO")
        : { minimum: 0.0001, maximum: 0.1, defaultValue: mode === "MO" ? 0.02 : 0.001 },
    [grid, mode]
  );

  // Scientific metrics
  const totalEnergy = result.total_energy_hartree;
  const totalEnergyEv = hartreeToEv(totalEnergy).toFixed(2);
  const gapEh = lumoOrbital.energy_hartree - homoOrbital.energy_hartree;
  const gapEv = hartreeToEv(gapEh).toFixed(2);

  // Accessible selection of surrounding orbitals
  const nearbyOrbitals = useMemo(() => {
    const homoIdx = homoOrbital.index;
    return result.orbitals
      .filter((o) => Math.abs(o.index - homoIdx) <= 2)
      .sort((a, b) => a.index - b.index);
  }, [result.orbitals, homoOrbital.index]);

  return (
    <div className="guided-result-view" data-testid="guided-result-view">
      {/* 1. Header Bar */}
      <div className="guided-view-header">
        <div className="guided-breadcrumb">
          <button type="button" className="guided-breadcrumb-link" onClick={onNavigateHome}>
            Project Home
          </button>
          <span className="breadcrumb-separator">/</span>
          <button type="button" className="guided-breadcrumb-link" onClick={onNavigateStructure}>
            Structure
          </button>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">
            <strong>Electronic Structure</strong>
            <span className="breadcrumb-meta">{result.method.toUpperCase()} / {result.basis.toUpperCase()} · Calculation complete</span>
          </span>
        </div>
      </div>

      {/* 2. Top Summary & Result Tabs */}
      <div className="guided-result-top-summary">
        <div className="summary-left">
          <div className="summary-headline-row">
            <h2>Electronic structure <HelpTip topic="electronic.homo_lumo" /></h2>
            <GuidedStatus intent="success">Electronic structure ready</GuidedStatus>
            <span className="method-pill">{result.method.toUpperCase()} / {result.basis.toUpperCase()}</span>
          </div>
          <p className="summary-plain-desc">
            ChemDFT calculated the electronic ground state using {result.method.toUpperCase()} with the {result.basis.toUpperCase()} basis.
          </p>
        </div>
        <div className="summary-right">
          <GuidedResultTab activeTab={mode} onChange={setMode} disabledReason={gridState === "FAILED" ? "The 3D surface is not available on the hosted beta yet, so this view cannot be shown. The orbital energies below are real calculated values." : undefined} />
        </div>
      </div>

      {/* 3. Main Scientific Layout: Dominant 3D Visualization + Right Sidebar Metrics */}
      <div className="guided-result-layout">
        <div className="guided-result-viewport-container">
          {/* Sub-header Context Bar for active mode */}
          <div className="guided-viewport-controls-bar">
            {mode === "MO" ? (
              <div className="orbital-picker-strip">
                <span className="picker-label">Frontier Orbitals:</span>
                <div className="orbital-buttons-group">
                  {nearbyOrbitals.map((orb) => {
                    const isHomo = orb.index === homoOrbital.index;
                    const isLumo = orb.index === lumoOrbital.index;
                    const isSelected = orb.index === selectedOrbital.index;
                    const tag = isHomo ? "HOMO" : isLumo ? "LUMO" : `MO ${formatOrbitalNumber(orb.index)}`;
                    return (
                      <button
                        key={orb.index}
                        type="button"
                        className={`orbital-choice-chip ${isSelected ? "active" : ""} ${isHomo ? "chip-homo" : ""} ${isLumo ? "chip-lumo" : ""}`}
                        onClick={() => setSelectedOrbital(orb)}
                      >
                        <span className="chip-tag">{tag}</span>
                        <span className="chip-energy">{orb.energy_hartree.toFixed(4)} Eh</span>
                      </button>
                    );
                  })}
                </div>
                <div className="guided-mo-phase-legend" role="note" aria-label="Molecular orbital phase legend" hidden={gridState === "FAILED"}>
                  <span className="mo-phase-chip"><i className="mo-phase-dot mo-phase-positive" />Blue (+ phase)</span>
                  <span className="mo-phase-chip"><i className="mo-phase-dot mo-phase-negative" />Orange (− phase)</span>
                  <span className="mo-phase-disclaimer">Orbital phase — not electric charge</span>
                </div>
              </div>
            ) : mode === "Density" ? (
              <div className="field-info-strip">
                <span className="field-info-title">Electron Density</span>
                <span className="field-info-desc">
                  Shows where electron density is distributed around the nuclei. Valence electron distribution at ρ = {densityIso} e/a₀³
                </span>
              </div>
            ) : (
              <div className="field-info-strip">
                <span className="field-info-title">Electrostatic Potential (ESP)</span>
                <span className="field-info-desc">
                  Shows the electrostatic potential mapped onto the molecular electron density surface.
                </span>
                <div className="esp-legend-bar" data-testid="esp-legend">
                  <span className="legend-label neg">
                    − (Electron-rich){espScale !== null ? ` ${(-espScale).toPrecision(3)} a.u.` : ""}
                  </span>
                  <div className="legend-gradient" />
                  <span className="legend-label pos">
                    {espScale !== null ? `+${espScale.toPrecision(3)} a.u. ` : ""}+ (Electron-poor)
                  </span>
                </div>
                <span className="field-info-desc" data-testid="esp-scale-note">
                  {espScale !== null
                    ? `Colour scale ±${espScale.toPrecision(3)} a.u. (Eh/e), symmetric about 0, sampled on the ρ = ${currentIso} e/a₀³ density surface.`
                    : "Colour scale is computed from the rendered surface."}
                </span>
              </div>
            )}

            <div className="viewport-actions-right">
              <button
                type="button"
                className="guided-tool-btn"
                onClick={() => setFitToken((n) => n + 1)}
                data-testid="guided-reset-field-view-btn"
                title="Center and fit in view"
              >
                <AppIcon icon="zoom-to-fit" />
                <span>Reset View</span>
              </button>
            </div>
          </div>

          {/* LARGE 3D Canvas Area */}
          <div className={`guided-3d-canvas-wrap${gridState === "FAILED" ? " is-unavailable" : ""}`}>
            {structure && grid && gridState === "READY" ? (
              <OrbitalViewport
                structure={structure}
                grid={grid as unknown as VolumetricField}
                potential={potential ? (potential as unknown as VolumetricField) : undefined}
                isovalue={currentIso}
                opacity={opacity}
                showMolecule={true}
                showPositive={true}
                showNegative={true}
                fitToken={fitToken}
                fitTarget="surface"
                active={true}
                cameraKey={resultId}
                onSurface={(surface) => {
                  const range = surface.minimum != null && surface.maximum != null
                    ? Math.max(Math.abs(surface.minimum), Math.abs(surface.maximum)) : null;
                  setEspScale((previous) => (previous === range ? previous : range));
                }}
              />
            ) : (
              gridState === "FAILED" ? (
                <div className="viewport-fallback" role="alert" data-testid="guided-surface-unavailable">
                  <p><strong>The 3D orbital surface is not available on the hosted beta yet.</strong> The server could not produce this {mode === "MO" ? "orbital" : mode === "Density" ? "electron density" : "electrostatic potential"} surface (surface cubes are not generated on the hosted beta yet). The orbital energies, HOMO/LUMO and gap shown here are real calculated values and stay valid.</p>
                </div>
              ) : (
                <div className="viewport-fallback" role="status">
                  <span className="guided-spinner" aria-hidden="true" />
                  <p>Extracting deterministic volumetric isosurface…</p>
                  <p data-testid="guided-surface-slow">If this takes longer than a minute, the surface is probably not available on this server; the numbers do not depend on it.</p>
                </div>
              )
            )}
          </div>

          <p className="viewer-caption-shared" data-testid="orbital-viewer-caption" style={{ margin: "4px 12px" }} hidden={gridState === "FAILED"}>Static view: drag to rotate · scroll to zoom. Nothing here is animated.</p>

          {/* Isovalue Slider Control (Compact beneath viewer) */}
          <div className="guided-isovalue-strip" hidden={gridState === "FAILED"}>
            <IsovalueControl
              density={mode === "Density"}
              value={currentIso}
              onChange={setCurrentIso}
              disabled={gridState !== "READY"}
              bounds={bounds}
              id="guided-isovalue-control"
            />
          </div>
        </div>

        {/* 4. Right Sidebar: Key Scientific Values & Actions */}
        <aside className="guided-result-sidebar">
          {/* Key Scientific Values */}
          <div className="sidebar-section">
            <h3 className="sidebar-title">Key Scientific Values</h3>
            <div className="scientific-metrics-list">
              <GuidedMetric
                label="Total Energy"
                value={`${totalEnergy.toFixed(6)}`}
                unit="Eh"
                sublabel={`Derived: ${totalEnergyEv} eV`}
              />
              <GuidedMetric
                label="HOMO Energy"
                value={`${homoOrbital.energy_hartree.toFixed(4)}`}
                unit="Eh"
                sublabel={`${formatOrbitalLabel(homoOrbital.index)} (Occupied)`}
              />
              <GuidedMetric
                label="LUMO Energy"
                value={`${lumoOrbital.energy_hartree.toFixed(4)}`}
                unit="Eh"
                sublabel={`${formatOrbitalLabel(lumoOrbital.index)} (Unoccupied)`}
              />
              <GuidedMetric
                label="HOMO-LUMO Gap"
                value={`${gapEh.toFixed(4)}`}
                unit="Eh"
                sublabel={`${gapEv} eV`}
                highlight
                note="Orbital energy difference (not optical excitation energy)"
              />
            </div>
          </div>

          {/* Primary Next Actions */}
          <div className="sidebar-section">
            <h3 className="sidebar-title">Next Actions</h3>
            <div className="guided-action-buttons-list">
              {hasOptimizedGeometry === false ? (
                <ActionButton
                  intent="primary"
                  icon="refresh"
                  text="Prepare geometry optimization"
                  onClick={onOptimizeGeometry}
                  data-testid="guided-prepare-opt-btn"
                />
              ) : null}
              <ActionButton
                icon="chat"
                text="Ask AI Scientist"
                onClick={onOpenAiScientist}
                data-testid="guided-ask-ai-result-btn"
              />
              <ActionButton
                icon="cube"
                text="Back to structure view"
                onClick={onNavigateStructure}
              />
            </div>
          </div>

          {/* Technical Details (Collapsed Progressive Disclosure) */}
          <div className="sidebar-section">
            <GuidedDisclosure title="Technical details">
              <dl className="guided-tech-facts compact">
                <div>
                  <dt>Result ID</dt>
                  <dd><code>{resultId}</code></dd>
                </div>
                <div>
                  <dt>Engine</dt>
                  <dd>{result.engine} {result.engine_version}</dd>
                </div>
                <div>
                  <dt>Method</dt>
                  <dd>{result.method.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Basis Set</dt>
                  <dd>{result.basis.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Convergence Threshold</dt>
                  <dd>Unavailable in this stored orbital result</dd>
                </div>
                <div>
                  <dt>Grid Resolution</dt>
                  <dd>0.18 Å uniform spacing</dd>
                </div>
                <div>
                  <dt>HOMO Index</dt>
                  <dd>{formatOrbitalLabel(homoOrbital.index)} (engine index {homoOrbital.index})</dd>
                </div>
                <div>
                  <dt>LUMO Index</dt>
                  <dd>{formatOrbitalLabel(lumoOrbital.index)} (engine index {lumoOrbital.index})</dd>
                </div>
              </dl>
            </GuidedDisclosure>
          </div>
        </aside>
      </div>
    </div>
  );
}
