"use client";

import { useState } from "react";
import { AppIcon, StatusTag } from "@chemdft/ui";
import type { CalculationResult } from "@chemdft/schemas";
import { describeScientificState } from "@/lib/scientific-state";
import { KS_GAP_LABEL, KS_GAP_NOTE, LOCAL_SPIN_LABEL, LOCAL_SPIN_TOOLTIP, QE_GAP_LABEL, QE_GAP_NOTE, QE_LOCAL_SPIN_LABEL, QE_LOCAL_SPIN_NOTE, QE_LOCAL_SPIN_TOOLTIP, QE_PLANE_WAVE_FOOTNOTE } from "@/lib/periodic-wording";
import { QePeriodicResults } from "./qe-periodic-results";

export interface EnergyPrecisionPlateProps {
  projectId: string;
  calculationId?: string | undefined;
  resultId?: string | undefined;
  calculationState?: string | undefined;
  method?: string | undefined;
  basis?: string | null | undefined;
  engineName?: string | undefined;
  engineVersion?: string | undefined;
  energyValue: number;
  energyUnit?: string | undefined;
  converged?: boolean | undefined;
  scfIterations?: number | null | undefined;
  inputHash?: string | undefined;
  sourceClass?: string | undefined;
  validationState?: string | undefined;
  /** Stored authority / verification and the server's read-time state; the header never claims more than these. */
  authority?: string | undefined;
  verificationState?: string | undefined;
  effectiveState?: CalculationResult["effective_state"] | undefined;
  structureName?: string | undefined;
  structureId?: string | undefined;
  structureVersionId?: string | undefined;
  provenanceRecordId?: string | undefined;
  formula?: string | undefined;
  atomCount?: number | undefined;
  rawPayload?: Record<string, unknown> | null | undefined;
  onInspectStructure?: (() => void) | undefined;
  onPlanNextStep?: (() => void) | undefined;
  compact?: boolean | undefined;
}

const HARTREE_TO_EV = 27.211386245988;
const HARTREE_TO_KCAL = 627.509474;

export function EnergyPrecisionPlate({
  projectId,
  calculationId,
  resultId,
  calculationState = "Unknown",
  method: methodProp = "Unknown",
  basis = null,
  engineName: engineNameProp = "Unknown",
  engineVersion = "",
  energyValue,
  energyUnit = "Unknown",
  converged,
  scfIterations = null,
  inputHash,
  sourceClass = "Unknown",
  validationState = "Unknown",
  authority, verificationState, effectiveState,
  structureName, structureId, structureVersionId, provenanceRecordId,
  formula,
  atomCount,
  rawPayload,
  onInspectStructure,
  onPlanNextStep,
  compact = false,
}: EnergyPrecisionPlateProps) {
  const state = describeScientificState({
    authority: authority ?? "CANDIDATE",
    validation_state: validationState,
    verification_state: verificationState ?? "UNVERIFIED",
    source_class: sourceClass,
    effective_state: effectiveState,
  });
  // Payloads from some engines (QE periodic) carry no method/basis; a null or missing value must never reach .toLowerCase().
  const method = typeof methodProp === "string" && methodProp ? methodProp : "Unknown";
  const engineName = typeof engineNameProp === "string" && engineNameProp ? engineNameProp : "Unknown";
  const [showRaw, setShowRaw] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);

  const isXtb = engineName.toLowerCase().includes("xtb") || method.toLowerCase().includes("gfn");
  const isMp2 = method.toLowerCase() === "mp2";
  const isPeriodic = rawPayload?.payload_schema === "chemdft.periodic-energy" || method.toLowerCase().includes("pbe+u") || (rawPayload?.task_type === "PERIODIC_ENERGY");
  const isQe = isPeriodic && (rawPayload?.engine === "qe" || engineName.toLowerCase() === "qe");
  const engineDisplay = isQe ? "Quantum ESPRESSO" : engineName;
  const uMap = (rawPayload?.u_effective_ev as Record<string, number> | undefined) ?? null;
  const hasPlusU = method.toLowerCase().includes("+u") || (uMap !== null && Object.keys(uMap).length > 0);
  const methodName = isPeriodic ? (hasPlusU ? "PBE+U" : "PBE") : isXtb ? "GFN2-xTB" : isMp2 ? "Conventional MP2" : method.toUpperCase();
  const methodClass = isPeriodic
    ? (isQe ? "Periodic Density Functional Theory (Quantum ESPRESSO, plane waves)" : "Periodic Density Functional Theory (PySCF PBC, Gaussian & plane-wave GDF)")
    : isXtb
      ? "Semi-empirical extended tight-binding (Grimme et al.)"
      : isMp2
        ? "Ab initio electronic structure (Conventional MP2 / Post-Hartree–Fock)"
        : "Ab initio electronic structure (DFT / Hartree–Fock)";
  const cutoffs = rawPayload?.cutoffs_ry as { ecutwfc?: number; ecutrho?: number } | undefined;
  const basisText = isPeriodic
    ? (isQe ? `Plane waves, ${(rawPayload?.pseudopotential_library as string | undefined) ?? "SSSP PBE Efficiency v2.0"}${cutoffs ? ` (cutoffs ${cutoffs.ecutwfc}/${cutoffs.ecutrho} Ry)` : ""}` : "GTH-DZVP-MOLOPT-SR (GTH-PBE pseudopotential)")
    : isXtb
      ? "Built-in method basis and parameters; no user-selectable basis"
      : basis?.toUpperCase() ?? "Not specified";

  const nativeHartree = ["Eh", "HARTREE", "hartree"].includes(energyUnit);
  function publishedHartree(key: string) {
    const value = rawPayload?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  const mp2Reference = publishedHartree("hf_reference_hartree");
  const mp2Correlation = publishedHartree("mp2_correlation_hartree");
  const mp2SameSpin = publishedHartree("mp2_same_spin_hartree");
  const mp2OppositeSpin = publishedHartree("mp2_opposite_spin_hartree");

  const bandGap = typeof rawPayload?.band_gap === "object" && rawPayload?.band_gap !== null
    ? ((rawPayload.band_gap as { value?: number }).value ?? null)
    : (typeof rawPayload?.band_gap_ev === "number" ? rawPayload.band_gap_ev : null);
  const kMesh = Array.isArray(rawPayload?.k_mesh)
    ? (rawPayload.k_mesh as number[]).join("x")
    : (typeof rawPayload?.k_mesh === "string" ? rawPayload.k_mesh : null);
  const totalMagnetization = typeof rawPayload?.total_magnetization === "number" ? rawPayload.total_magnetization : null;
  // A moment that is not a finite number (null, NaN sent as null, an object) is dropped instead of crashing the page on completion.
  const rawMoments = rawPayload?.local_magnetic_moments;
  const localMoments: Record<string, number> | null = rawMoments && typeof rawMoments === "object" && !Array.isArray(rawMoments)
    ? Object.fromEntries(Object.entries(rawMoments as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])))
    : null;

  const evValue = (energyValue * HARTREE_TO_EV).toFixed(4);
  const kcalValue = (energyValue * HARTREE_TO_KCAL).toFixed(2);

  const copyHash = () => {
    if (inputHash && typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(inputHash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  return (
    <div
      className={`energy-precision-plate ${compact ? "compact" : ""}`}
      data-testid="energy-precision-plate"
      data-calculation-id={calculationId} data-result-id={resultId} data-structure-version-id={structureVersionId}
      data-engine={engineName} data-method={method} data-input-hash={inputHash}
      style={{
        background: "var(--cdf-surface, #ffffff)",
        border: "1px solid var(--cdf-line, #d6dde4)",
        padding: compact ? "16px" : "24px",
        borderRadius: "4px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
      }}
    >
      {/* Plate Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          borderBottom: "1px solid var(--cdf-line, #d6dde4)",
          paddingBottom: "14px",
          marginBottom: "18px",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--cdf-accent, #1565a7)",
                background: "var(--cdf-selection, #e3effc)",
                padding: "2px 6px",
                borderRadius: "2px",
              }}
            >
              {state.currentlyAuthoritative ? "Authoritative Engine Result" : state.headline}
            </span>
            <StatusTag intent={state.validation.intent === "none" ? "primary" : state.validation.intent}>
              {state.validation.value}
            </StatusTag>
            <span
              style={{
                fontSize: "11px",
                color: "var(--cdf-ink-muted, #52606d)",
                fontFamily: "monospace",
                whiteSpace: "nowrap",
              }}
            >
              {sourceClass}
            </span>
          </div>
          <h2 style={{ margin: "2px 0 0", fontSize: "18px", fontWeight: 600, color: "var(--cdf-ink, #18212b)" }}>
            Ground-State Total Energy ({methodName})
          </h2>
          <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--cdf-ink-muted, #52606d)" }}>
            {methodClass} · Produced by {engineDisplay} {engineVersion}
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {onInspectStructure ? (
            <button
              type="button"
              className="bp6-button bp6-minimal bp6-small"
              onClick={onInspectStructure}
              title="Inspect 3D coordinates that produced this energy"
            >
              <AppIcon icon="cube" /> <span>3D Geometry</span>
            </button>
          ) : null}
          {onPlanNextStep ? (
            <button
              type="button"
              className="bp6-button bp6-minimal bp6-small"
              onClick={onPlanNextStep}
              title="Open AI Scientist for next actions"
            >
              <AppIcon icon="compass" /> <span>Next Action</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Hero Digital Readout */}
      <div
        style={{
          background: "var(--cdf-surface-subtle, #f8fafc)",
          border: "1px solid var(--cdf-line, #d6dde4)",
          padding: compact ? "12px 8px" : "20px 24px",
          borderRadius: "3px",
          marginBottom: "20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <span
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--cdf-ink-muted, #52606d)",
              display: "block",
              marginBottom: "4px",
            }}
          >
            Total Energy (E_tot)
          </span>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
            <span
              style={{
                fontFamily: "SFMono-Regular, ui-monospace, Menlo, Consolas, monospace",
                fontSize: compact ? "clamp(16px, 6cqi, 28px)" : "28px",
                whiteSpace: "nowrap",
                overflowWrap: "normal",
                fontWeight: 700,
                color: "var(--cdf-ink, #18212b)",
                letterSpacing: "-0.02em",
              }}
              data-testid="energy-readout-value"
            >
              {energyValue.toFixed(10)}
            </span>
            <span
              style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "var(--cdf-accent, #1565a7)",
                fontFamily: "monospace",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {energyUnit}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
          {nativeHartree ? <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "13px", fontFamily: "monospace", color: "var(--cdf-ink-muted, #52606d)" }}>
            <span>Derived conversions:</span>
            <span>{evValue} eV</span>
            <span style={{ color: "var(--cdf-line-strong, #b8c2cc)" }}>|</span>
            <span>{kcalValue} kcal/mol</span>
          </div> : null}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
            <AppIcon icon={converged ? "tick-circle" : "warning-sign"} />
            <span style={{ color: converged ? "var(--cdf-status-success, #237a4b)" : "var(--cdf-status-error, #b4232b)", fontWeight: 600 }}>
              {converged === undefined ? "Convergence not reported" : converged ? "Self-Consistent Field Converged" : "SCF Not Converged"}
            </span>
            {scfIterations ? (
              <span style={{ color: "var(--cdf-ink-muted, #52606d)" }}>({scfIterations} iterations)</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* MP2 Energy Decomposition (Only when provided in backend payload; never derived in browser) */}
      {isMp2 && nativeHartree && [mp2Reference, mp2Correlation, mp2SameSpin, mp2OppositeSpin].some((value) => value !== null) ? (
        <div
          data-testid="mp2-decomposition-plate"
          style={{
            background: "var(--cdf-surface-subtle, #f8fafc)",
            border: "1px solid var(--cdf-line, #d6dde4)",
            padding: "16px 20px",
            borderRadius: "3px",
            marginBottom: "20px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--cdf-ink-muted, #52606d)",
              display: "block",
              marginBottom: "10px",
              fontWeight: 700,
            }}
          >
            Conventional MP2 Energy Decomposition
          </span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "12px",
            }}
          >
            {mp2Reference !== null ? (
              <div style={{ padding: "8px 12px", background: "var(--cdf-surface, #ffffff)", border: "1px solid var(--cdf-line, #d6dde4)" }}>
                <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
                  HF Reference Energy (E_ref)
                </span>
                <strong style={{ fontFamily: "monospace", fontSize: "13px", color: "var(--cdf-ink, #18212b)" }} data-testid="mp2-reference-energy">
                  {mp2Reference.toFixed(10)} Eh
                </strong>
              </div>
            ) : null}
            {mp2Correlation !== null ? (
              <div style={{ padding: "8px 12px", background: "var(--cdf-surface, #ffffff)", border: "1px solid var(--cdf-line, #d6dde4)" }}>
                <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
                  MP2 Correlation Energy (E_corr)
                </span>
                <strong style={{ fontFamily: "monospace", fontSize: "13px", color: "var(--cdf-ink, #18212b)" }} data-testid="mp2-correlation-energy">
                  {mp2Correlation.toFixed(10)} Eh
                </strong>
              </div>
            ) : null}
            <div style={{ padding: "8px 12px", background: "var(--cdf-surface, #ffffff)", border: "1px solid var(--cdf-line, #d6dde4)" }}>
              <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
                Total MP2 Energy (E_tot)
              </span>
              <strong style={{ fontFamily: "monospace", fontSize: "13px", color: "var(--cdf-accent, #1565a7)" }} data-testid="mp2-total-energy">
                {energyValue.toFixed(10)} {energyUnit}
              </strong>
            </div>
            {mp2SameSpin !== null ? (
              <div style={{ padding: "8px 12px", background: "var(--cdf-surface, #ffffff)", border: "1px solid var(--cdf-line, #d6dde4)" }}>
                <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
                  Same-Spin Correlation (E_ss)
                </span>
                <span style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--cdf-ink-muted, #52606d)" }}>
                  {mp2SameSpin.toFixed(10)} Eh
                </span>
              </div>
            ) : null}
            {mp2OppositeSpin !== null ? (
              <div style={{ padding: "8px 12px", background: "var(--cdf-surface, #ffffff)", border: "1px solid var(--cdf-line, #d6dde4)" }}>
                <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
                  Opposite-Spin Correlation (E_os)
                </span>
                <span style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--cdf-ink-muted, #52606d)" }}>
                  {mp2OppositeSpin.toFixed(10)} Eh
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Periodic Electronic Structure Card */}
      {isPeriodic ? (
        <div
          data-testid="periodic-electronic-plate"
          style={{
            background: "var(--cdf-surface-subtle, #f8fafc)",
            border: "1px solid var(--cdf-line, #d6dde4)",
            padding: "16px 20px",
            borderRadius: "3px",
            marginBottom: "20px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--cdf-ink-muted, #52606d)",
              display: "block",
              marginBottom: "10px",
              fontWeight: 700,
            }}
          >
            Periodic Electronic Structure & Magnetism
          </span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "12px",
            }}
          >
            {bandGap !== null && bandGap !== undefined ? (
              <div style={{ padding: "8px 12px", background: "var(--cdf-surface, #ffffff)", border: "1px solid var(--cdf-line, #d6dde4)" }}>
                <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
                  {isQe ? QE_GAP_LABEL : KS_GAP_LABEL}
                </span>
                <strong style={{ fontFamily: "monospace", fontSize: "13px", color: "var(--cdf-ink, #18212b)" }} data-testid="periodic-band-gap">
                  {bandGap.toFixed(4)} eV
                </strong>
                <span style={{ fontSize: "10px", color: "var(--cdf-ink-muted, #52606d)", display: "block", marginTop: "2px" }}>
                  {isQe ? QE_GAP_NOTE : KS_GAP_NOTE}
                </span>
              </div>
            ) : null}
            {kMesh ? (
              <div style={{ padding: "8px 12px", background: "var(--cdf-surface, #ffffff)", border: "1px solid var(--cdf-line, #d6dde4)" }}>
                <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
                  k-Point Mesh
                </span>
                <strong style={{ fontFamily: "monospace", fontSize: "13px", color: "var(--cdf-ink, #18212b)" }} data-testid="periodic-k-mesh">
                  {kMesh === "1x1x1" ? "1×1×1 (Γ-only)" : kMesh}
                </strong>
              </div>
            ) : null}
            {totalMagnetization !== null && totalMagnetization !== undefined ? (
              <div style={{ padding: "8px 12px", background: "var(--cdf-surface, #ffffff)", border: "1px solid var(--cdf-line, #d6dde4)" }}>
                <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
                  Total Magnetization
                </span>
                <strong style={{ fontFamily: "monospace", fontSize: "13px", color: "var(--cdf-accent, #1565a7)" }} data-testid="periodic-total-magnetization">
                  {totalMagnetization.toFixed(4)} μB
                </strong>
              </div>
            ) : null}
            {localMoments && Object.keys(localMoments).length > 0 ? (
              <div style={{ padding: "8px 12px", background: "var(--cdf-surface, #ffffff)", border: "1px solid var(--cdf-line, #d6dde4)", gridColumn: "1 / -1" }}>
                <span title={isQe ? QE_LOCAL_SPIN_TOOLTIP : LOCAL_SPIN_TOOLTIP} style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block", marginBottom: "4px" }} data-testid="periodic-local-moments-label">
                  {isQe ? QE_LOCAL_SPIN_LABEL : LOCAL_SPIN_LABEL} · {isQe ? "Quantum ESPRESSO" : "PySCF"}
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }} data-testid="periodic-local-moments">
                  {Object.entries(localMoments).map(([atomKey, moment]) => (
                    <span key={atomKey} style={{ fontFamily: "monospace", fontSize: "12px", padding: "2px 6px", background: "var(--cdf-surface-subtle, #f8fafc)", border: "1px solid var(--cdf-line, #d6dde4)" }}>
                      {atomKey}: {moment >= 0 ? `+${moment.toFixed(3)}` : moment.toFixed(3)} μB
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {isQe ? (
              <div style={{ padding: "8px 12px", gridColumn: "1 / -1", fontSize: "10px", color: "var(--cdf-ink-muted, #52606d)" }} data-testid="qe-engine-note">
                {QE_PLANE_WAVE_FOOTNOTE} {QE_LOCAL_SPIN_NOTE}
              </div>
            ) : null}
            {uMap && Object.keys(uMap).length > 0 ? (
              <div style={{ padding: "8px 12px", background: "var(--cdf-surface, #ffffff)", border: "1px solid var(--cdf-line, #d6dde4)" }}>
                <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
                  Dudarev +U Parameters
                </span>
                <div style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--cdf-ink, #18212b)" }} data-testid="periodic-u-effective">
                  {Object.entries(uMap).map(([el, uVal]) => `${el}: U_eff = ${uVal} eV`).join(", ")}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isQe && rawPayload ? <QePeriodicResults payload={rawPayload} projectId={projectId} calculationId={calculationId} /> : null}

      {/* Scientific Instrument Specification Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "12px",
          marginBottom: "20px",
        }}
      >
        <div style={{ padding: "10px 14px", border: "1px solid var(--cdf-line, #d6dde4)", background: "var(--cdf-surface, #ffffff)" }}>
          <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
            Engine & Version
          </span>
          <strong style={{ fontSize: "13px", color: "var(--cdf-ink, #18212b)" }}>
            {engineName} {engineVersion}
          </strong>
        </div>

        <div style={{ padding: "10px 14px", border: "1px solid var(--cdf-line, #d6dde4)", background: "var(--cdf-surface, #ffffff)" }}>
          <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
            Method Formulation
          </span>
          <strong style={{ fontSize: "13px", color: "var(--cdf-ink, #18212b)" }}>
            {methodName}
          </strong>
        </div>

        <div style={{ padding: "10px 14px", border: "1px solid var(--cdf-line, #d6dde4)", background: "var(--cdf-surface, #ffffff)" }}>
          <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
            Basis Set Representation
          </span>
          <strong style={{ fontSize: "13px", color: "var(--cdf-ink, #18212b)" }}>
            {basisText}
          </strong>
        </div>

        {structureName || formula ? (
          <div style={{ padding: "10px 14px", border: "1px solid var(--cdf-line, #d6dde4)", background: "var(--cdf-surface, #ffffff)" }}>
            <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", textTransform: "uppercase", display: "block" }}>
              Target Geometry
            </span>
            <strong style={{ fontSize: "13px", color: "var(--cdf-ink, #18212b)" }}>
              {structureName ?? formula ?? "Molecular structure"}
              {atomCount ? ` (${atomCount} atoms)` : ""}
            </strong>
          </div>
        ) : null}
      </div>

      <dl className="energy-result-identifiers">
        <div><dt>Calculation ID</dt><dd>{calculationId ?? "Unavailable"}</dd></div>
        <div><dt>Result ID</dt><dd>{resultId ?? "Unavailable"}</dd></div>
        {structureId ? <div><dt>Input structure ID</dt><dd>{structureId}</dd></div> : null}
        {structureVersionId ? <div><dt>Immutable input version ID</dt><dd>{structureVersionId}</dd></div> : null}
        {provenanceRecordId ? <div><dt>Provenance record ID</dt><dd>{provenanceRecordId}</dd></div> : null}
      </dl>
      {/* Provenance & Boundary Guarantee Footer */}
      <div
        style={{
          borderTop: "1px solid var(--cdf-line, #d6dde4)",
          paddingTop: "12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          fontSize: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "var(--cdf-ink-muted, #52606d)" }}>
          <span>Calculation State: <strong style={{ color: "var(--cdf-ink, #18212b)" }}>{calculationState}</strong></span>
          {inputHash ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              Input Hash: <code style={{ fontFamily: "monospace" }}>{inputHash.slice(0, 12)}…</code>
              <button
                type="button"
                className="bp6-button bp6-minimal bp6-small"
                onClick={copyHash}
                style={{ padding: "2px 4px", fontSize: "11px" }}
                title="Copy complete calculation input hash"
              >
                {copiedHash ? "Copied" : "Copy"}
              </button>
            </span>
          ) : null}
        </div>

        <button
          type="button"
          className="bp6-button bp6-minimal bp6-small"
          onClick={() => setShowRaw((v) => !v)}
          style={{ color: "var(--cdf-accent, #1565a7)" }}
        >
          <AppIcon icon={showRaw ? "chevron-up" : "chevron-down"} />
          <span>{showRaw ? "Hide raw JSON" : "Inspect raw result JSON"}</span>
        </button>
      </div>

      {/* Raw Payload Drawer */}
      {showRaw ? (
        <div style={{ marginTop: "14px", borderTop: "1px dashed var(--cdf-line, #d6dde4)", paddingTop: "12px" }}>
          <pre
            style={{
              background: "#101a24",
              color: "#e6edf3",
              padding: "14px",
              borderRadius: "3px",
              fontSize: "11px",
              fontFamily: "SFMono-Regular, ui-monospace, Menlo, Consolas, monospace",
              overflowX: "auto",
              maxHeight: "260px",
              lineHeight: 1.5,
            }}
          >
            {JSON.stringify(
              rawPayload ?? {
                calculation_id: calculationId,
                result_id: resultId,
                notice: "Published raw payload unavailable",
                method,
                basis,
                converged,
                scf_iterations: scfIterations,
                producer_software: { name: engineName, version: engineVersion },
              },
              null,
              2,
            )}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
