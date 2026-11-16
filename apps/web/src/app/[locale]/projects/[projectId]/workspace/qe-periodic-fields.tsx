"use client";

import {
  ENGINE_HELP_PYSCF,
  ENGINE_HELP_QE,
  PYSCF_ENGINE_LABEL,
  QE_AFM_LOCAL_MINIMUM_NOTE,
  QE_ENGINE_LABEL,
  QE_ESTIMATE_LABEL,
  QE_PLANE_WAVE_FOOTNOTE,
  QE_PSEUDO_LIBRARY_LABEL,
} from "@/lib/periodic-wording";
import { QE_LIMITS, QE_SCF_MESHES, humanDuration, type QeScfMesh } from "@/lib/qe-periodic";

export type PeriodicEngineChoice = "pyscf" | "qe";

export type QeStageState = {
  relax: boolean;
  dos: boolean;
  dosMesh: "4x4x4" | "6x6x6";
  bands: boolean;
};

const small = { fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", lineHeight: 1.35 } as const;

/** Engine choice for a periodic crystal. Always shown, so the engine behind every number is a visible choice. */
export function PeriodicEngineSelect({ value, onChange, qeAvailable, qeReason }: {
  value: PeriodicEngineChoice;
  onChange: (next: PeriodicEngineChoice) => void;
  qeAvailable: boolean;
  qeReason: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
        Engine
        <select value={value} onChange={(event) => onChange(event.currentTarget.value as PeriodicEngineChoice)} data-testid="periodic-engine-select">
          <option value="pyscf">{PYSCF_ENGINE_LABEL}</option>
          <option value="qe" disabled={!qeAvailable}>{QE_ENGINE_LABEL}{qeAvailable ? "" : " (not available)"}</option>
        </select>
      </label>
      <span style={small} data-testid="periodic-engine-help">{value === "qe" ? ENGINE_HELP_QE : ENGINE_HELP_PYSCF}</span>
      {!qeAvailable && qeReason ? <span style={small} data-testid="qe-unavailable-reason">{qeReason}</span> : null}
    </div>
  );
}

/** Quantum ESPRESSO-only controls: k-mesh, stages, read-only library, estimate. The shared controls (magnetic order, +U) stay in the panel. */
export function QeStageFields({ mesh, onMesh, stages, onStages, estimateSeconds, memoryMb, refusal, atomCount }: {
  mesh: QeScfMesh;
  onMesh: (next: QeScfMesh) => void;
  stages: QeStageState;
  onStages: (next: QeStageState) => void;
  estimateSeconds: number;
  memoryMb: number;
  refusal: string | null;
  atomCount: number;
}) {
  const meshLabel = (m: string) => (m === "1x1x1" ? "Gamma only" : m.replace(/x/g, "×"));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }} data-testid="qe-options">
      <div className="calculation-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))" }}>
        <label>
          k-Point Mesh
          <select value={mesh} onChange={(event) => onMesh(event.currentTarget.value as QeScfMesh)} data-testid="qe-kmesh-select">
            {QE_SCF_MESHES.map((m) => (<option key={m} value={m}>{meshLabel(m)}</option>))}
          </select>
        </label>
        <label>
          Pseudopotentials and cutoffs
          <input readOnly value={QE_PSEUDO_LIBRARY_LABEL} data-testid="qe-pseudo-library" aria-readonly="true" style={{ background: "var(--cdf-surface-subtle, #f8fafc)" }} />
        </label>
      </div>
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: "12px" }} data-testid="qe-stage-checkboxes">
        <legend style={{ ...small, padding: 0, marginBottom: "4px" }}>Also compute (each adds time)</legend>
        <label style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
          <input type="checkbox" checked={stages.relax} onChange={(e) => onStages({ ...stages, relax: e.currentTarget.checked })} data-testid="qe-relax-toggle" />
          Relax atom positions (cell fixed)
        </label>
        <label style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
          <input type="checkbox" checked={stages.dos} onChange={(e) => onStages({ ...stages, dos: e.currentTarget.checked })} data-testid="qe-dos-toggle" />
          Density of states and projected DOS
        </label>
        <label style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
          <input type="checkbox" checked={stages.bands} onChange={(e) => onStages({ ...stages, bands: e.currentTarget.checked })} data-testid="qe-bands-toggle" />
          Band structure along a high-symmetry path
        </label>
        {stages.dos ? (
          <label style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
            DOS k-mesh
            <select value={stages.dosMesh} onChange={(e) => onStages({ ...stages, dosMesh: e.currentTarget.value as QeStageState["dosMesh"] })} data-testid="qe-dos-mesh-select">
              <option value="4x4x4">4×4×4</option>
              <option value="6x6x6">6×6×6 (default)</option>
            </select>
          </label>
        ) : null}
      </fieldset>
      <span style={small} data-testid="qe-estimate">
        Estimated run time on 2 vCPU: <strong>{humanDuration(estimateSeconds)}</strong>, memory up to about {(memoryMb / 1000).toFixed(1)} GB ({atomCount} atoms; hosted limits: {QE_LIMITS.maxAtoms} atoms, mesh up to 4×4×4). {QE_ESTIMATE_LABEL}
      </span>
      <span style={small} data-testid="qe-footnote">{QE_PLANE_WAVE_FOOTNOTE} {QE_AFM_LOCAL_MINIMUM_NOTE}</span>
      {refusal ? <p className="calculation-unavailable" role="alert" data-testid="qe-limit-refusal">{refusal}</p> : null}
    </div>
  );
}
