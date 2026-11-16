"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  MolecularOrbital,
  MolecularOrbitalAnalysis,
  VolumetricFieldOutput,
  StructureVersionDetail,
} from "@chemdft/schemas";
import { getVolumetricFieldGrid, getStructureVersion } from "@/lib/structure-workspace-api";

const OrbitalViewport = dynamic(() => import("./orbital-isosurface-viewport"), {
  ssr: false,
  loading: () => <div className="mo-viewport-fallback" role="status">Loading molecular-orbital renderer…</div>,
});

import { isovalueBounds, type FieldSurface } from "@chemdft/scientific-scene";

import { IsovalueControl } from "@/app/_components/isovalue-control";
import { formatThreshold } from "@/lib/workstation-ux";
import type { FieldMode, ElectronicInspectorContext } from "@/lib/electronic-workbench";
const DEFAULT_ISOVALUE = 0.035;
type SelectedOrbital = { index: number; spin: MolecularOrbital["spin_channel"] };

export function MolecularOrbitalWorkspace({
  active = true,
  projectId,
  calculationId,
  resultId,
  result,
}: {
  active?: boolean;
  projectId: string;
  calculationId: string;
  resultId: string;
  result: MolecularOrbitalAnalysis;
}) {
  const defaultFrontier = result.frontier_by_spin[0]!;
  const [selected, setSelected] = useState<SelectedOrbital>({
    index: defaultFrontier.homo_index,
    spin: defaultFrontier.spin_channel,
  });
  const [structure, setStructure] = useState<StructureVersionDetail | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [grid, setGrid] = useState<VolumetricFieldOutput | null>(null);
  const [mode, setMode] = useState<FieldMode>("MO");
  const [densityIso, setDensityIso] = useState(0.001);
  const [potential, setPotential] = useState<VolumetricFieldOutput | undefined>();
  const [surfaceStats, setSurfaceStats] = useState<{ minimum: number | null; maximum: number | null; triangles: number } | null>(null);
  const fields = useRef(new Map<string, VolumetricFieldOutput>());
  const onSurface = useCallback((surface: FieldSurface) => {
    const next = { minimum: surface.minimum, maximum: surface.maximum, triangles: surface.triangleCount };
    setSurfaceStats(previous => previous?.minimum === next.minimum && previous?.maximum === next.maximum && previous?.triangles === next.triangles ? previous : next);
  }, []);
  const [gridState, setGridState] = useState<"GRID NOT GENERATED" | "GENERATING" | "READY" | "FAILED">("GRID NOT GENERATED");
  const [gridError, setGridError] = useState<string | null>(null);
  const [isovalue, setIsovalue] = useState(DEFAULT_ISOVALUE);
  const [opacity, setOpacity] = useState(0.58);
  const [showMolecule, setShowMolecule] = useState(true);
  const [showPositive, setShowPositive] = useState(true);
  const [showNegative, setShowNegative] = useState(true);
  const [fitToken, setFitToken] = useState(0);
  const [fitTarget, setFitTarget] = useState<"molecule" | "surface">("surface");
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [retry, setRetry] = useState(0);
  const [persisted, setPersisted] = useState(false);

  const selectedOrbital = result.orbitals.find(
    (orbital) => orbital.index === selected.index && orbital.spin_channel === selected.spin,
  ) ?? result.orbitals.find((orbital) => orbital.index === defaultFrontier.homo_index
    && orbital.spin_channel === defaultFrontier.spin_channel)!;
  const selectedFrontier = result.frontier_by_spin.find((frontier) => frontier.spin_channel === selectedOrbital.spin_channel)!;
  const fieldReady = gridState === "READY" && Boolean(structure && grid && (
    mode === "MO" ? grid.manifest.field_quantity === "MO_AMPLITUDE"
      && grid.manifest.orbital_index === selectedOrbital.index
      && grid.manifest.spin_channel === selectedOrbital.spin_channel :
      grid.manifest.field_quantity === "ELECTRON_DENSITY" && (mode === "ESP" ? potential : !potential)
  ));
  const bounds = useMemo(() => grid ? isovalueBounds(grid, mode !== "MO")
    : { minimum: 0.0001, maximum: 0.1, defaultValue: mode === "MO" ? DEFAULT_ISOVALUE : 0.001 }, [grid, mode]);
  const currentIso = mode === "MO" ? isovalue : densityIso;
  const setCurrentIso = (value: number) => {
    if (Number.isFinite(value) && value > 0) {
      if (mode === "MO") setIsovalue(value); else setDensityIso(value);
    }
  };
  const selectedRole = roleFor(selectedOrbital, selectedFrontier);
  useEffect(() => {
    if (!active) return;
    const context: ElectronicInspectorContext = { projectId, resultId, calculationId, result, mode, orbital: selectedOrbital, grid, potential };
    window.dispatchEvent(new CustomEvent("chemdft:electronic-inspector", { detail: context }));

    const methodBasis = result.method ? `${result.method}${result.basis ? `/${result.basis}` : ""}` : "";
    const baseLabel = `Electronic structure${methodBasis ? ` · ${methodBasis}` : ""}`;
    const subLabel =
      mode === "Density"
        ? "Electron density"
        : mode === "ESP"
          ? "ESP"
          : selectedRole || (selectedOrbital ? `MO ${selectedOrbital.index + 1}` : "HOMO");
    const currentView = `${baseLabel} → ${subLabel}`;

    window.dispatchEvent(
      new CustomEvent("chemdft:workspace-selection", {
        detail: {
          projectId,
          calculationId,
          resultId,
          structureName: structure?.structure.name,
          structureVersionRevision: structure?.version.revision,
          currentView,
          selectionName: baseLabel,
        },
      }),
    );
  }, [active, projectId, resultId, calculationId, result, mode, selectedOrbital, selectedRole, grid, potential, structure]);

  useEffect(() => {
    let active = true;
    getStructureVersion({
      projectId,
      structureId: result.input_structure_id,
      versionId: result.input_structure_version_id,
    }).then((detail) => { if (active) { setStructure(detail); setStructureError(null); } })
      .catch((error: unknown) => {
        if (active) setStructureError(error instanceof Error ? error.message : "Calculation StructureVersion could not be loaded.");
      });
    return () => { active = false; };
  }, [projectId, result.input_structure_id, result.input_structure_version_id, retry]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const key = `chemdft:mo-view:${projectId}:${resultId}`;
      try {
        const saved = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<{
          mode: FieldMode; densityIso: number; isovalue: number; opacity: number; showMolecule: boolean; showPositive: boolean; showNegative: boolean;
          selectedOrbitalIndex: number; selectedSpin: MolecularOrbital["spin_channel"];
        }> | null;
        if (saved) {
          if (saved.mode && ["MO", "Density", "ESP"].includes(saved.mode)) setMode(saved.mode);
          if (Number.isFinite(saved.densityIso) && saved.densityIso! > 0) setDensityIso(saved.densityIso!);
          if (Number.isFinite(saved.isovalue) && saved.isovalue! > 0) setIsovalue(saved.isovalue!);
          if (Number.isFinite(saved.opacity) && saved.opacity! >= 0.15 && saved.opacity! <= 1) setOpacity(saved.opacity!);
          if (typeof saved.showMolecule === "boolean") setShowMolecule(saved.showMolecule);
          if (typeof saved.showPositive === "boolean") setShowPositive(saved.showPositive);
          if (typeof saved.showNegative === "boolean") setShowNegative(saved.showNegative);
          if (Number.isInteger(saved.selectedOrbitalIndex) && saved.selectedSpin
            && result.orbitals.some((orbital) => orbital.index === saved.selectedOrbitalIndex
              && orbital.spin_channel === saved.selectedSpin)) {
            setSelected({ index: saved.selectedOrbitalIndex!, spin: saved.selectedSpin });
          }
        }
      } catch { /* Invalid view preferences are discarded. */ }
      setPersisted(true);
    });
    return () => { active = false; };
  }, [projectId, resultId, result.orbitals]);

  useEffect(() => {
    if (!persisted) return;
    window.localStorage.setItem(`chemdft:mo-view:${projectId}:${resultId}`, JSON.stringify({
      mode, densityIso, isovalue, opacity, showMolecule, showPositive, showNegative,
      selectedOrbitalIndex: selectedOrbital.index,
      selectedSpin: selectedOrbital.spin_channel,
    }));
  }, [mode, densityIso, isovalue, opacity, showMolecule, showPositive, showNegative, selectedOrbital.index,
    selectedOrbital.spin_channel, persisted, projectId, resultId]);

  useEffect(() => {
    if (!persisted) return;
    let active = true;
    const request = mode === "MO"
      ? { field_kind: "MO_AMPLITUDE" as const, orbital_index: selectedOrbital.index, spin_channel: selectedOrbital.spin_channel }
      : { field_kind: "ELECTRON_DENSITY" as const };
    const load = async (fieldRequest: Parameters<typeof getVolumetricFieldGrid>[0]["request"]) => {
      const key = JSON.stringify(fieldRequest);
      const cached = fields.current.get(key);
      if (cached) return cached;
      const output = await getVolumetricFieldGrid({ projectId, calculationId, request: fieldRequest });
      fields.current.set(key, output);
      return output;
    };
    queueMicrotask(() => { if (active) { setGridState("GENERATING"); setGridError(null); } });
    Promise.all([load(request), mode === "ESP" ? load({ field_kind: "ELECTROSTATIC_POTENTIAL" }) : Promise.resolve(undefined)])
      .then(([output, esp]) => { if (active) { setGrid(output); setPotential(esp); setGridState("READY"); } })
      .catch((error: unknown) => { if (active) { setGridState("FAILED"); setGridError(error instanceof Error ? error.message : "Field generation failed. Saved SCF and MO results remain available."); } });
    return () => { active = false; };
  }, [projectId, calculationId, selectedOrbital.index, selectedOrbital.spin_channel, mode, persisted, retry]);

  function select(index: number, spin = selectedOrbital.spin_channel) {
    if (result.orbitals.some((orbital) => orbital.index === index && orbital.spin_channel === spin)) {
      setSelected({ index, spin });
      setMode("MO");
    }
  }

  function resetView() {
    setIsovalue(DEFAULT_ISOVALUE);
    setDensityIso(0.001);
    setOpacity(0.58);
    setShowMolecule(true);
    setShowPositive(true);
    setShowNegative(true);
  }

  return <section className={`mo-workspace ${summaryVisible ? "summary-visible" : ""}`} aria-label="Electronic-structure result workspace">
    <aside className="mo-workspace-panel mo-orbital-panel" aria-label="Orbital calculation and table">
      <div className="mo-panel-heading"><span>Electronic structure</span><strong>CALCULATED · NOT REVIEWED</strong></div>
      <dl className="mo-facts">
        <div><dt>Engine</dt><dd>{result.engine} {result.engine_version}</dd></div>
        <div><dt>Method / basis</dt><dd>{result.method.toUpperCase()} / {result.basis.toUpperCase()}</dd></div>
        <div><dt>Charge / multiplicity</dt><dd>{result.charge} / {result.multiplicity}</dd></div>
        <div><dt>SCF</dt><dd>{result.converged ? "CONVERGED" : "NOT CONVERGED"}{result.scf_iterations == null ? "" : ` · ${result.scf_iterations} cycles`}</dd></div>
        <div><dt>Total SCF energy</dt><dd>{result.total_energy_hartree.toFixed(10)} Eh</dd></div>
        <div><dt>Electrons</dt><dd>{result.electron_count} · α {result.alpha_electron_count} / β {result.beta_electron_count}</dd></div>
        <div><dt>Basis functions</dt><dd>{result.basis_function_count}</dd></div>
        <div><dt>Molecular orbitals</dt><dd>{result.molecular_orbital_count}</dd></div>
      </dl>
      <div className="mo-gap-box">
        <span>HOMO–LUMO orbital-energy gap</span>
        <strong>{selectedFrontier.gap_hartree.toFixed(8)} Eh · {selectedFrontier.gap_ev.toFixed(5)} eV</strong>
        <small>Orbital-energy difference; not an excited-state calculation.</small>
      </div>
      <div className="mo-table-heading"><h2>Orbital table</h2><span>{selectedOrbital.spin_channel}</span></div>
      <div className="mo-quick-actions" aria-label="Frontier orbital shortcuts">
        {(["HOMO−1", "HOMO", "LUMO", "LUMO+1"] as const).map((role) => {
          const index = role === "HOMO" ? selectedFrontier.homo_index
            : role === "LUMO" ? selectedFrontier.lumo_index
              : role === "HOMO−1" ? selectedFrontier.homo_index - 1
                : selectedFrontier.lumo_index + 1;
          const available = result.orbitals.some((orbital) => orbital.index === index && orbital.spin_channel === selectedOrbital.spin_channel);
          return <button type="button" key={role} disabled={!available} onClick={() => select(index)}>{role}</button>;
        })}
      </div>
      <div className="mo-table-scroll" tabIndex={0}>
        <table className="mo-orbital-table">
          <thead><tr><th>Orbital</th><th>Spin</th><th>Occ.</th><th>Eh</th><th>eV</th><th>Role</th></tr></thead>
          <tbody>{result.orbitals.map((orbital) => {
            const frontier = result.frontier_by_spin.find((item) => item.spin_channel === orbital.spin_channel);
            const role = frontier ? roleFor(orbital, frontier) : "—";
            const active = orbital.index === selectedOrbital.index && orbital.spin_channel === selectedOrbital.spin_channel;
            return <tr key={`${orbital.spin_channel}-${orbital.index}`} aria-selected={active}>
              <td><button type="button" className="mo-orbital-select" aria-label={`Select MO ${orbital.index} ${orbital.spin_channel} ${role}`} onClick={() => select(orbital.index, orbital.spin_channel)}>MO {orbital.index + 1}</button></td>
              <td>{orbital.spin_channel}</td><td>{formatOccupation(orbital.occupation)}</td>
              <td>{orbital.energy_hartree.toFixed(5)}</td><td>{orbital.energy_ev.toFixed(3)}</td><td>{role}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </aside>

    <section className="mo-workspace-panel mo-scene-panel" aria-label="Molecular orbital scene">
      <div className="mo-panel-heading"><div>
        <strong>{mode === "MO" ? `MO ${selectedOrbital.index + 1} · ${selectedRole} · ${selectedOrbital.spin_channel}` : mode === "Density" ? "Electron density ρ(r)" : "Electrostatic potential on electron density"}</strong></div>
        <span className={`mo-grid-status ${gridState.toLowerCase().replaceAll(" ", "-")}`}>{gridState}</span>
      </div>
      <div className="electronic-field-modes" aria-label="Electronic-structure toolbar">
        <button className="mo-summary-toggle" type="button" aria-pressed={summaryVisible} onClick={() => setSummaryVisible(value => !value)}>Orbitals & summary</button>
        {(["MO", "Density", "ESP"] as const).map(field => <button key={field} type="button" aria-pressed={mode === field} onClick={() => setMode(field)}>{field === "Density" ? "Electron density" : field === "ESP" ? "ESP surface" : "MO"}</button>)}
        <button type="button" onClick={() => { setFitTarget("molecule"); setFitToken(value => value + 1); }}>Fit molecule</button>
        <button type="button" disabled={!fieldReady} onClick={() => { setFitTarget("surface"); setFitToken(value => value + 1); }}>Fit surface</button>
        <button type="button" disabled={!fieldReady} onClick={() => window.dispatchEvent(new Event("chemdft:export-field-image"))}>Export image</button>
        <button type="button" onClick={() => window.dispatchEvent(new Event("chemdft:open-inspector"))}>Provenance</button>
      </div>
      <IsovalueControl key={mode === "MO" ? "mo" : "density"} density={mode !== "MO"} value={currentIso} onChange={setCurrentIso} bounds={bounds} disabled={!fieldReady} id={`iso-number-${resultId}`} />
      <div className="electronic-viewport-container">

      {grid && structure ? <div className="electronic-viewport-frame" aria-busy={!fieldReady} style={{ visibility: fieldReady ? "visible" : "hidden" }}><OrbitalViewport structure={structure} grid={grid} potential={potential} onSurface={onSurface} isovalue={grid.manifest.field_quantity === "MO_AMPLITUDE" ? isovalue : densityIso}
        opacity={opacity} showMolecule={showMolecule} showPositive={showPositive} showNegative={showNegative}
        fitToken={fitToken} fitTarget={fitTarget} active={active} cameraKey={`chemdft:camera:${projectId}:${resultId}:${result.input_structure_version_id}`} /></div> : <div className="mo-viewport-fallback" role={gridState === "FAILED" ? "alert" : "status"}>
          {gridState === "GENERATING" ? `Generating deterministic grid for MO ${selectedOrbital.index + 1}…`
            : gridState === "FAILED" ? gridError ?? "Grid generation failed; calculated orbital energies remain available."
              : "GRID NOT GENERATED"}
        </div>}
      {!fieldReady ? <div className="field-loading-overlay" role={structureError || gridState === "FAILED" ? "alert" : "status"}>{structureError || gridState === "FAILED" ? <>{structureError ?? gridError}<button type="button" onClick={() => setRetry(value => value + 1)}>Retry field</button></> : "Loading saved field…"}</div> : null}
      {fieldReady && surfaceStats?.triangles === 0 ? <div className="empty-isosurface" role="status"><strong>No isosurface intersects this threshold.</strong><p>Lower the isovalue to display {mode === "MO" ? "the orbital" : "the density surface"}.</p><button type="button" onClick={() => setCurrentIso(bounds.defaultValue)}>Reset isovalue</button></div> : null}
      </div>
      <div className="mo-scene-toolbar">
        <label><input type="checkbox" checked={showMolecule} onChange={(event) => setShowMolecule(event.currentTarget.checked)} /> Molecule</label>
        {mode === "MO" ? <><label><input type="checkbox" checked={showPositive} onChange={(event) => setShowPositive(event.currentTarget.checked)} /> Positive phase</label>
        <label><input type="checkbox" checked={showNegative} onChange={(event) => setShowNegative(event.currentTarget.checked)} /> Negative phase</label></> : null}
        <label className="mo-range-control">Opacity <input aria-label="Isosurface opacity" type="range" min="0.15" max="1" step="0.01" value={opacity} onChange={(event) => setOpacity(Number(event.currentTarget.value))} /></label>
      </div>
      <button className="mo-reset-button" type="button" onClick={resetView}>Reset visualization preferences</button>
      {mode === "MO" ? <div className="mo-phase-legend" aria-label="Orbital phase legend">
        <span><i className="mo-phase-positive" />Blue (+ phase)</span><span><i className="mo-phase-negative" />Orange (− phase)</span><small>Orbital phase — not electric charge</small>
      </div> : mode === "ESP" && surfaceStats?.minimum != null && surfaceStats.maximum != null ? <div className="esp-scalar-legend" aria-label="ESP scalar legend">
        <strong>Electrostatic potential V(r) / a.u.</strong><div className="esp-color-scale" />
        <div className="esp-scale-labels"><span>−{Math.max(Math.abs(surfaceStats.minimum), Math.abs(surfaceStats.maximum)).toFixed(5)}</span><span>0</span><span>+{Math.max(Math.abs(surfaceStats.minimum), Math.abs(surfaceStats.maximum)).toFixed(5)} a.u.</span></div>
        <small>Negative · zero · positive potential. Symmetric display range from current surface extrema.</small>
        <p>Current rendered mesh · min {surfaceStats.minimum.toFixed(6)} · maximum {surfaceStats.maximum.toFixed(6)} a.u.</p>
      </div> : <div className="mo-phase-legend">Electron density ρ(r) · e/a₀³ · single positive isosurface</div>}
      <details className="field-facts-disclosure"><summary>Field details · {grid?.manifest.dimensions.join(" × ")} · {grid?.manifest.spacing_angstrom} Å</summary><dl className="mo-selected-facts">
        {mode === "MO" ? <><div><dt>Energy</dt><dd>{selectedOrbital.energy_hartree.toFixed(8)} Eh · {selectedOrbital.energy_ev.toFixed(5)} eV</dd></div><div><dt>Occupation</dt><dd>{formatOccupation(selectedOrbital.occupation)}</dd></div></> : <>
          <div><dt>Integrated density over finite grid</dt><dd>{grid?.manifest.density_integral_electrons?.toFixed(6)} e · QA only</dd></div>
          <div><dt>SCF electrons</dt><dd>{result.electron_count} · authoritative</dd></div>
          <div><dt>Mesh</dt><dd>{surfaceStats?.triangles ?? 0} triangles</dd></div>
        </>}
        <div><dt>Isovalue</dt><dd>{mode === "MO" ? "± " : "ρ = "}{formatThreshold(currentIso)} {mode === "MO" ? "a₀⁻³ᐟ²" : "e/a₀³"}</dd></div>
      </dl></details>
    </section>

  </section>;
}

function roleFor(orbital: MolecularOrbital, frontier: MolecularOrbitalAnalysis["frontier_by_spin"][number]): string {
  if (orbital.index === frontier.homo_index) return "HOMO";
  if (orbital.index === frontier.lumo_index) return "LUMO";
  if (orbital.index < frontier.homo_index) {
    const offset = frontier.homo_index - orbital.index;
    return offset <= 2 ? `HOMO−${offset}` : "OCCUPIED";
  }
  const offset = orbital.index - frontier.lumo_index;
  return offset <= 2 ? `LUMO+${offset}` : "VIRTUAL";
}

function formatOccupation(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
