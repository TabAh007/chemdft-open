"use client";

import { saveBlob } from "@/lib/download";
import { navigatorCalculationTask } from "@/lib/navigator-navigation";
import { vibrationalKind, vibrationalSpectrumLabel } from "@/lib/vibrational-kind";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CalculationDetail, CalculationSubmitInput, GeometryEligibility, StructureVersionDetail } from "@chemdft/schemas";
import { ActionButton, AppIcon, StatusTag } from "@chemdft/ui";
import { useWorkspaceState } from "@/app/_components/workspace-state-provider";

import {
  cancelCalculation,
  downloadCalculationArtifact,
  getCalculation,
  submitCalculation,
} from "@/lib/structure-workspace-api";
import { useCalculationCapabilities } from "@/lib/use-calculation-capabilities";
import { basisCoverage, coverageMessage, periodicElementCoverage } from "@/lib/basis-element-limits";
import { useGeometryEligibility } from "@/lib/use-geometry-eligibility";
import {
  buildPsi4SubmissionPayload,
  getPsi4SupportedBases,
  getPsi4SupportedMethods,
  isPsi4PairSupported,
  validatePsi4Structure,
} from "@/lib/psi4-calculation";

import { hostedLimit, pyscfEnergyTimeNote } from "@/lib/hosted-limits";
import { ConformerSearchPanel } from "@/app/_components/conformers/conformer-search-panel";
import { Dftd4CorrectionControl } from "@/app/_components/dftd4-correction";
import { CiteCalculation } from "@/app/_components/cite-calculation";
import { CiteNudge } from "@/app/_components/cite-nudge";
import { PulseLightIndicator } from "@/app/_components/pulse-light-indicator";
import { EnergyPrecisionPlate } from "./visualization/energy-precision-plate";
import { QE_ENGINE_LABEL, U_DEFAULTS_NOTE } from "@/lib/periodic-wording";
import { QE_BASIS_DISPLAY, QE_BASIS_ID, QE_BAND_POINTS_PLANNING, meshTuple, qeElementSupport, qeEstimateMemoryMb, qeEstimateSeconds, qeCutoffs, qeRefusal, type QeScfMesh } from "@/lib/qe-periodic";
import { HOSTED_GEOMETRIC_MESSAGE } from "@/lib/guided-capability-state";
import { PeriodicEngineSelect, QeStageFields, type PeriodicEngineChoice, type QeStageState } from "./qe-periodic-fields";

type EnergyPayload = {
  payload_schema: "chemdft.energy" | "chemdft.periodic-energy";
  total_energy: { value: number; unit: { code: string } };
  converged?: boolean;
  method?: string | null;
  basis?: string | null;
  scf_iterations?: number | null;
  parser_version: string;
  validator_version: string;
  band_gap?: { value: number; unit: { code: string } } | null;
  total_magnetization?: number | null;
  local_magnetic_moments?: Record<string, number> | null;
  k_mesh?: [number, number, number] | string;
};

const DEFAULT_U_EFFECTIVE_EV: Record<string, number> = {
  V: 3.25,
  Cr: 3.7,
  Mn: 3.9,
  Fe: 5.3,
  Co: 3.32,
  Ni: 6.2,
};

const Z_TO_SYMBOL: Record<number, string> = {
  23: "V",
  24: "Cr",
  25: "Mn",
  26: "Fe",
  27: "Co",
  28: "Ni",
};

const convergenceLabels = {
  convergence_energy: "Energy (Eh)",
  convergence_grms: "Gradient RMS (Eh/bohr)",
  convergence_gmax: "Gradient max (Eh/bohr)",
  convergence_drms: "Displacement RMS (Å)",
  convergence_dmax: "Displacement max (Å)",
} as const;

export function CalculationPanel({
  projectId,
  structureVersionId,
  charge: initialCharge,
  multiplicity: initialMultiplicity,
  structureOrigin: initialStructureOrigin,
  coordinateOrigin,
  periodic,
  structure,
  eligibility: initialEligibility,
  onOpenEditor,
}: {
  projectId: string;
  structureVersionId: string;
  charge: number;
  multiplicity: number;
  structureOrigin: string;
  coordinateOrigin?: string | null;
  periodic: boolean;
  structure: StructureVersionDetail;
  eligibility?: GeometryEligibility | null;
  onOpenEditor?: () => void;
}) {
  const { openSelection } = useWorkspaceState();
  const {
    capabilities,
    loading: capabilitiesLoading,
    error: capabilityError, refresh,
  } = useCalculationCapabilities(projectId);
  const [engine, setEngine] = useState<"pyscf" | "xtb" | "psi4">("pyscf");
  const [charge, setCharge] = useState(initialCharge);
  const [multiplicity, setMultiplicity] = useState(initialMultiplicity);
  const [method, setMethod] = useState("hf");
  const [basis, setBasis] = useState("sto-3g");
  const [task, setTask] = useState<"ENERGY" | "GEOMETRY_OPTIMIZATION" | "FREQUENCY" | "ORBITAL" | "TDDFT" | "CONFORMER_SEARCH">(() => typeof window === "undefined" ? "ENERGY" : navigatorCalculationTask(new URLSearchParams(window.location.search).get("navigator_action")) ?? "ENERGY");
  const [maxSteps, setMaxSteps] = useState(100);
  // TDDFT states: 5 is the count verified on the hosted worker (10 did not converge for water at def2-SVP).
  const [nstates, setNstates] = useState(5);
  const [convergence, setConvergence] = useState<Record<string, string>>({});
  const [calculation, setCalculation] = useState<CalculationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const pendingSubmission = useRef<{ signature: string; payload: CalculationSubmitInput } | null>(null);
  const cancelEpoch = useRef(0);
  const [message, setMessage] = useState<string | null>(null);
  const [citeOpen, setCiteOpen] = useState(false);
  const geometry = useGeometryEligibility(
    projectId, structure.structure.id, structureVersionId, initialEligibility,
  );
  const geometryEligibility = geometry.eligibility;

  const pyscf = useMemo(
    () => capabilities.find((capability) => capability.engine === "pyscf"),
    [capabilities],
  );
  const xtb = useMemo(
    () => capabilities.find((capability) => capability.engine === "xtb"),
    [capabilities],
  );
  const psi4 = useMemo(
    () => capabilities.find((capability) => capability.engine === "psi4"),
    [capabilities],
  );
  const qeCapability = useMemo(
    () => capabilities.find((capability) => capability.engine === "qe"),
    [capabilities],
  );
  const isCapabilityExpired = Boolean(capabilityError?.includes("expired"));
  const activeCapability = engine === "xtb" ? xtb : engine === "psi4" ? psi4 : pyscf;
  const psi4Validation = useMemo(
    () => (engine === "psi4" ? validatePsi4Structure(structure, periodic) : { valid: true }),
    [engine, structure, periodic],
  );
  const optimizer = activeCapability?.supported_optimizers?.find((item) => item === (engine === "xtb" ? "xtb-ancopt" : "geometric"));
  const level = activeCapability?.supported_optimization_levels?.find((item) => item === "normal");
  const geometryEligible = geometry.eligible;
  const atomicNumbers = (structure.version.coordinates?.atoms ?? []).map((atom) => atom.atomic_number);
  const limitView = hostedLimit({ task, engine, atomCount: atomicNumbers.length, atomicNumbers });
  const timeNote = task === "ENERGY" && engine === "pyscf" ? pyscfEnergyTimeNote(atomicNumbers.length, basis) : null;
  const pyscfBasisCoverage = (id: string) => basisCoverage(pyscf, id, atomicNumbers);
  const selectedPyscfCoverage = engine === "pyscf" ? pyscfBasisCoverage(basis) : { usable: true, limit: null, offending: [] };

  const [periodicEngine, setPeriodicEngine] = useState<PeriodicEngineChoice>("pyscf");
  const [qeMesh, setQeMesh] = useState<QeScfMesh>("2x2x2");
  const [qeStages, setQeStages] = useState<QeStageState>({ relax: false, dos: false, dosMesh: "6x6x6", bands: false });
  const [periodicKMesh, setPeriodicKMesh] = useState<"1x1x1" | "2x2x2">("1x1x1");
  const [periodicMagneticOrder, setPeriodicMagneticOrder] = useState<"none" | "ferromagnetic" | "antiferromagnetic">("antiferromagnetic");
  const [periodicPlusU, setPeriodicPlusU] = useState<boolean>(true);
  const [periodicUEff, setPeriodicUEff] = useState<Record<string, number>>(() => ({ ...DEFAULT_U_EFFECTIVE_EV }));

  const detectedTransitionElements = useMemo(() => {
    const symbols = new Set<string>();
    for (const atom of structure.version.coordinates?.atoms ?? []) {
      const sym = Z_TO_SYMBOL[atom.atomic_number] ?? (
        atom.element && DEFAULT_U_EFFECTIVE_EV[atom.element] !== undefined ? atom.element : null
      );
      if (sym) symbols.add(sym);
    }
    return Array.from(symbols).sort();
  }, [structure]);

  const isQe = periodicEngine === "qe";
  const elementSymbols = useMemo(
    () => [...new Set((structure.version.coordinates?.atoms ?? []).map((atom) => atom.element).filter((el): el is string => Boolean(el)))],
    [structure],
  );
  const qeElements = qeElementSupport(elementSymbols);
  const qeCuts = qeCutoffs(elementSymbols);
  const qeEstimateInput = {
    atoms: atomicNumbers.length,
    ecutwfc: qeCuts?.ecutwfc ?? 45,
    scfMesh: meshTuple(qeMesh),
    nspin: (periodicMagneticOrder === "none" ? 1 : 2) as 1 | 2,
    relax: qeStages.relax,
    dos: qeStages.dos,
    dosMesh: meshTuple(qeStages.dosMesh),
    bands: qeStages.bands,
    bandPoints: qeStages.bands ? QE_BAND_POINTS_PLANNING : 0,
  };
  const qeRefusalText = isQe ? (qeElements.usable ? qeRefusal(qeEstimateInput) : `Quantum ESPRESSO (SSSP PBE Efficiency v2.0) does not offer: ${qeElements.offending.join(", ")}.`) : null;
  const qeEngineAvailable = qeCapability?.availability === "AVAILABLE";
  const qeEstimate = qeEstimateSeconds(qeEstimateInput).total;
  const qeMemory = qeEstimateMemoryMb({ atoms: qeEstimateInput.atoms, ecutwfc: qeEstimateInput.ecutwfc, bandPoints: qeEstimateInput.bandPoints, bands: qeEstimateInput.bands, dos: qeEstimateInput.dos });

  const periodicCoverage = periodicElementCoverage(atomicNumbers);
  const periodicLimitView = hostedLimit({ task: "PERIODIC_ENERGY", engine: "pyscf", atomCount: atomicNumbers.length, atomicNumbers, periodic: true });

  const periodicAvailable =
    periodic &&
    !capabilitiesLoading &&
    !isCapabilityExpired &&
    !capabilityError &&
    (isQe
      ? qeEngineAvailable && !qeRefusalText
      : (pyscf?.availability === "AVAILABLE" || pyscf === undefined) &&
        atomicNumbers.length <= 20 &&
        periodicCoverage.usable &&
        !periodicLimitView.refusal);

  const molecularAvailable =
    !periodic &&
    !capabilitiesLoading &&
    !isCapabilityExpired &&
    !capabilityError &&
    activeCapability?.availability === "AVAILABLE" &&
    activeCapability.supported_tasks.includes(task) &&
    geometryEligible &&
    selectedPyscfCoverage.usable &&
    !limitView.refusal &&
    (task !== "GEOMETRY_OPTIMIZATION" || (optimizer && (engine !== "xtb" || level))) &&
    (engine !== "psi4" || (isPsi4PairSupported(method, basis, psi4) && psi4Validation.valid));

  const available = periodic ? periodicAvailable : molecularAvailable;
  const energy = calculation?.calculation.state === "SUCCEEDED" && calculation.result?.validation_state === "VALIDATED" && (
    calculation.result.payload?.payload_schema === "chemdft.energy" ||
    calculation.result.payload?.payload_schema === "chemdft.periodic-energy" ||
    calculation.result.result_type === "chemdft.energy" ||
    calculation.result.result_type === "chemdft.periodic-energy"
  ) ? calculation.result.payload as EnergyPayload : undefined;
  const terminal = ["SUCCEEDED", "FAILED", "CANCELED"].includes(
    calculation?.calculation.state ?? "",
  );
  const computeState = calculation?.compute_job?.state ?? "No job";

  useEffect(() => {
    if (!calculation || terminal) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const calculationId = calculation.calculation.id;
    async function poll() {
      const epoch = cancelEpoch.current;
      try {
        const detail = await getCalculation({ projectId, calculationId });
        if (!active || epoch !== cancelEpoch.current) return;
        setCalculation(detail);
        if (["SUCCEEDED", "FAILED", "CANCELED"].includes(detail.calculation.state)) {
          window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
          setMessage(detail.calculation.state === "SUCCEEDED" ? "Authoritative calculated result published through the Scientific Result Firewall." : detail.calculation.state === "FAILED" ? detail.attempt?.diagnostic ?? "Calculation failed before publication." : "Calculation was canceled before an authoritative result was published.");
          return;
        }
      } catch (error: unknown) {
        if (active) setMessage(error instanceof Error ? error.message : "Calculation status refresh failed.");
      }
      if (active) timer = setTimeout(() => void poll(), 2500);
    }
    timer = setTimeout(() => void poll(), 2500);
    return () => { active = false; clearTimeout(timer); };
  }, [calculation, projectId, terminal]);

  async function runCalculation() {
    if (calculation && !terminal) { setMessage("A calculation on this structure is still running or queued. Wait for it to finish or cancel it, then run again."); return; }
    if (submitLock.current || busy) { setMessage("The previous request is still being sent. Please wait a moment."); return; }
    if (!available) { setMessage(periodic ? ((isQe ? qeRefusalText : periodicLimitView.refusal) ?? "This periodic calculation cannot be submitted right now.") : (limitView.refusal ?? "This calculation cannot be submitted right now; see the note above the button.")); return; }
    submitLock.current = true;
    setBusy(true);
    setMessage("Validating the immutable structure and calculation settings…");
    try {
      if (periodic) {
        const uEffectiveMap: Record<string, number> = {};
        if (periodicPlusU) {
          for (const el of detectedTransitionElements) {
            uEffectiveMap[el] = periodicUEff[el] ?? DEFAULT_U_EFFECTIVE_EV[el] ?? 3.7;
          }
        }
        const candidate: CalculationSubmitInput = {
          structure_version: {
            project_id: projectId,
            entity_type: "structure.version",
            entity_id: structureVersionId,
          },
          specification: ({
            task_type: "PERIODIC_ENERGY",
            method: {
              identifier: periodicPlusU ? "pbe+u" : "pbe",
              display_name: periodicPlusU ? "PBE+U" : "PBE",
              registry: "chemdft.method",
            },
            basis: isQe
              ? { identifier: QE_BASIS_ID, display_name: QE_BASIS_DISPLAY, registry: "chemdft.basis" }
              : { identifier: "gth-dzvp-molopt-sr", display_name: "GTH-DZVP-MOLOPT-SR", registry: "chemdft.basis" },
            charge: 0,
            multiplicity: 1,
            engine_preference: isQe
              ? { engine: "qe", allowed_version: qeCapability?.version ?? null }
              : { engine: "pyscf", allowed_version: pyscf?.version ?? null },
            periodic: isQe
              ? {
                  k_mesh: meshTuple(qeMesh),
                  ...(periodicPlusU && Object.keys(uEffectiveMap).length > 0 ? { u_effective_ev: uEffectiveMap } : {}),
                  magnetic_order: periodicMagneticOrder,
                  relax: qeStages.relax,
                  dos: qeStages.dos,
                  ...(qeStages.dos ? { dos_k_mesh: meshTuple(qeStages.dosMesh) } : {}),
                  bands: qeStages.bands,
                }
              : {
                  k_mesh: periodicKMesh === "2x2x2" ? [2, 2, 2] : [1, 1, 1],
                  ...(periodicPlusU && Object.keys(uEffectiveMap).length > 0 ? { u_effective_ev: uEffectiveMap } : {}),
                  magnetic_order: periodicMagneticOrder,
                },
          }) as unknown as CalculationSubmitInput["specification"],
          provider_preference: "AUTO",
          idempotency_key: `web-calculation-${crypto.randomUUID()}`,
        };
        const signature = JSON.stringify({ ...candidate, idempotency_key: undefined });
        if (pendingSubmission.current?.signature !== signature) pendingSubmission.current = { signature, payload: candidate };
        const result = await submitCalculation(projectId, pendingSubmission.current.payload);
        pendingSubmission.current = null;
        setCalculation(result);
        window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
        setMessage(
          result.calculation.state === "SUCCEEDED"
            ? "Authoritative calculated result published through the Scientific Result Firewall."
            : `Periodic calculation queued as compute job ${result.compute_job?.id.slice(0, 8) ?? ""}.`,
        );
        return;
      }
      const isXtb = engine === "xtb";
      const isPsi4 = engine === "psi4";
      const candidate: CalculationSubmitInput = isPsi4
        ? buildPsi4SubmissionPayload({
              projectId,
              versionId: structureVersionId,
              method,
              basis,
              allowedVersion: psi4?.version ?? null,
            })
        : {
            structure_version: {
              project_id: projectId,
              entity_type: "structure.version",
              entity_id: structureVersionId,
            },
            specification: {
              task_type: task,
              method: {
                identifier: isXtb ? "gfn2" : method,
                display_name: isXtb ? "GFN2-xTB" : method === "hf" ? "Hartree–Fock" : method.toUpperCase(),
                registry: "chemdft.method",
              },
              basis: isXtb ? null : {
                identifier: basis,
                display_name: basis.toUpperCase(),
                registry: "chemdft.basis",
              },
              charge,
              multiplicity,
              engine_preference: { engine: isXtb ? "xtb" : "pyscf", allowed_version: activeCapability?.version ?? null },
              ...(task === "GEOMETRY_OPTIMIZATION" ? { optimization: {
                optimizer: optimizer as "geometric" | "xtb-ancopt",
                ...(isXtb ? { xtb_level: level as "normal" } : {}),
                max_steps: maxSteps,
                ...(!isXtb ? Object.fromEntries(Object.entries(convergence).filter(([, value]) => value.trim() !== "").map(([key, value]) => [key, Number(value)])) : {}),
              } } : {}),
              ...(task === "FREQUENCY" ? { hessian: {
                strategy: "ANALYTIC" as const,
                exclude_translation_rotation: true as const,
                coordinate_unit: "angstrom" as const,
                hessian_unit: "Eh/bohr^2" as const,
                frequency_unit: "cm^-1" as const,
              } } : {}),
              ...(task === "TDDFT" ? { tddft: {
                nstates,
                spin: "singlet" as const,
                gauge: "length" as const,
                conv_tol: 1e-7,
              } } : {}),
            },
            provider_preference: "AUTO",
            idempotency_key: `web-calculation-${crypto.randomUUID()}`,
          };
      const signature = JSON.stringify({ ...candidate, idempotency_key: undefined });
      if (pendingSubmission.current?.signature !== signature) pendingSubmission.current = { signature, payload: candidate };
      const result = await submitCalculation(projectId, pendingSubmission.current.payload);
      pendingSubmission.current = null;
      setCalculation(result);
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
      setMessage(
        result.calculation.state === "SUCCEEDED"
          ? "Authoritative calculated result published through the Scientific Result Firewall."
          : `Calculation queued as compute job ${result.compute_job?.id.slice(0, 8) ?? ""}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Calculation submission failed.");
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  async function requestCancel() {
    if (!calculation || terminal || busy) return;
    cancelEpoch.current += 1;
    setBusy(true);
    setMessage("Cancelling… waiting for provider reconciliation.");
    try {
      const detail = await cancelCalculation({
        projectId,
        calculationId: calculation.calculation.id,
      });
      setCalculation(detail);
      setMessage(
        detail.calculation.state === "CANCELED"
          ? "Calculation canceled before execution completed."
          : "Cancel requested; status will update after provider reconciliation.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cancellation request failed.");
      setCalculation((current) => current ? { ...current } : current);
    } finally {
      setBusy(false);
    }
  }

  const psi4Execution = calculation?.specification.engine_preference.engine === "psi4";
  const executionArtifacts = (psi4Execution
    ? calculation?.attempt?.raw_artifacts?.filter((artifact) => artifact.sha256 !== calculation.calculation_input_hash)
    : calculation?.attempt?.raw_artifacts?.slice(1, 2)) ?? [];

  async function downloadExecutionArtifact(artifactId: string) {
    if (!calculation) return;
    try {
      const { blob, filename } = await downloadCalculationArtifact({
        projectId,
        calculationId: calculation.calculation.id,
        artifactId,
      });
      saveBlob(blob, filename);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Artifact download failed.");
    }
  }

  const taskSelector = (<label>Task<select value={task} onChange={(event) => {
          const nextTask = event.currentTarget.value as typeof task;
          setTask(nextTask);
          if (nextTask !== "ENERGY" && engine === "psi4") {
            setEngine("pyscf");
            setMethod("hf");
            setBasis("sto-3g");
          }
          if (nextTask === "TDDFT") {
            setMethod("b3lyp");
            setBasis("def2-svp");
          }
        }}><option value="CONFORMER_SEARCH">Conformer search (CREST)</option><option value="ENERGY">Single-point energy</option><option value="GEOMETRY_OPTIMIZATION">Geometry optimization</option><option value="FREQUENCY">Vibrational analysis</option><option value="ORBITAL">Molecular orbitals</option><option value="TDDFT">TDDFT Excited States / UV-Vis</option></select></label>);
  if (task === "CONFORMER_SEARCH") return <section className="calculation-panel" aria-label="Calculation">
    <div className="calculation-form-grid">{taskSelector}</div>
    <ConformerSearchPanel key={`${projectId}:${structureVersionId}`} projectId={projectId} structure={structure}
      onOpenResult={(detail) => { if (detail.result) openSelection({kind: "calculationResult", id: detail.result.id, projectId, sourceId: detail.calculation.id}, "CREST ensemble"); }}
      onOpenCalculation={(detail) => openSelection({kind: "calculation", id: detail.calculation.id, projectId}, "Conformer search")} />
  </section>;

  return (
    <section className="calculation-panel" aria-labelledby="calculation-title">
      <div className="pane-heading">
        <div>
          <h2 id="calculation-title">Calculation</h2>
          <p>Validated quantum chemical calculations (PySCF, Psi4 & GFN2-xTB) from committed structure coordinates.</p>
        </div>
        <StatusTag intent={available ? "success" : "warning"}>
          {available ? "AVAILABLE" : geometry.loading || capabilitiesLoading ? "CHECKING" : geometry.error ? "ELIGIBILITY CHECK FAILED" : geometryEligibility?.eligible === false ? "GEOMETRY REQUIRED" : isCapabilityExpired ? "REFRESH REQUIRED" : (activeCapability?.availability ?? "UNAVAILABLE")}
        </StatusTag>
      </div>
      {geometry.loading ? <p role="status">Checking calculation eligibility…</p> : null}
      {geometry.error ? <div role="alert">
        <p>Calculation eligibility could not be verified. {geometry.error}</p>
        <ActionButton text="Retry eligibility check" onClick={geometry.retry} />
      </div> : null}
      {geometryEligibility && !geometryEligibility.eligible ? (
        <div
          className="reconstruction-calculation-warning"
          role="alert"
          data-testid="calculation-geometry-ineligible"
          style={{
            borderColor: "var(--cdf-status-warning, #f97316)",
            background: "rgba(249, 115, 22, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <div>
            <strong>VALID 3D GEOMETRY REQUIRED</strong>
            <span>
              {geometryEligibility.detail ||
                "This structure is a raw 2D drawing. Quantum calculations require a generated and accepted 3D geometry with explicit hydrogens."}
            </span>
          </div>
          {onOpenEditor ? (
            <ActionButton
              intent="primary"
              icon="cube"
              text="Generate 3D"
              onClick={onOpenEditor}
              data-testid="panel-generate-3d-btn"
            />
          ) : null}
        </div>
      ) : null}
      {initialStructureOrigin === "RECONSTRUCTED" && coordinateOrigin?.startsWith("USER") ? <div className="reconstruction-calculation-warning" role="note">
        <strong>RECONSTRUCTED COORDINATES</strong>
        <span>These coordinates were user supplied and were not reported by the source paper. Calculations will apply to this reconstructed model.</span>
      </div> : null}
      {engine === "psi4" && !psi4Validation.valid ? (
        <div className="reconstruction-calculation-warning" role="note" style={{ borderColor: "#c23030", background: "rgba(194, 48, 48, 0.08)" }}>
          <strong>PSI4 MOLECULAR SCOPE RESTRICTION</strong>
          <span>{psi4Validation.reason}</span>
        </div>
      ) : null}
      {periodic ? (
        <div className="periodic-calculation-form" data-testid="periodic-setup-form" style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cdf-accent, #1565a7)", background: "var(--cdf-selection, #e3effc)", padding: "2px 6px", borderRadius: "2px" }}>
              {isQe ? "Periodic Crystal DFT (Quantum ESPRESSO)" : "Periodic Crystal DFT (PySCF PBC)"}
            </span>
            <span style={{ fontSize: "12px", color: "var(--cdf-ink-muted, #52606d)" }}>
              {isQe ? "PBE · plane waves · fixed SSSP pseudopotentials and cutoffs" : "PBE functional · GTH-DZVP-MOLOPT-SR basis · GDF density fitting"}
            </span>
          </div>

          <PeriodicEngineSelect
            value={periodicEngine}
            onChange={setPeriodicEngine}
            qeAvailable={qeEngineAvailable}
            qeReason={qeEngineAvailable ? null : (qeCapability?.diagnostic ?? "Quantum ESPRESSO is not available on this deployment.")}
          />

          {isQe ? (
            <QeStageFields
              mesh={qeMesh}
              onMesh={setQeMesh}
              stages={qeStages}
              onStages={setQeStages}
              estimateSeconds={qeEstimate}
              memoryMb={qeMemory}
              refusal={qeRefusalText}
              atomCount={atomicNumbers.length}
            />
          ) : null}

          <div className="calculation-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))" }}>
            {!isQe ? (
            <label>
              k-Point Mesh
              <select
                value={periodicKMesh}
                onChange={(event) => setPeriodicKMesh(event.currentTarget.value as "1x1x1" | "2x2x2")}
                data-testid="periodic-kmesh-select"
              >
                <option value="1x1x1">1×1×1 (Γ-only) — about 17 min (estimate)</option>
                <option value="2x2x2" disabled>2×2×2 mesh (not offered with PySCF on hosted beta; use Quantum ESPRESSO)</option>
                <option value="3x3x3" disabled>3×3×3 mesh (not offered on hosted beta)</option>
              </select>
            </label>
            ) : null}

            <label>
              Magnetic Order
              <select
                value={periodicMagneticOrder}
                onChange={(event) => setPeriodicMagneticOrder(event.currentTarget.value as "none" | "ferromagnetic" | "antiferromagnetic")}
                data-testid="periodic-magnetic-select"
              >
                <option value="none">{isQe ? "None — non-magnetic" : "None — Non-magnetic / singlet (KRKS)"}</option>
                <option value="ferromagnetic">{isQe ? "Ferromagnetic — all spins aligned" : "Ferromagnetic — All spins aligned (KUKS)"}</option>
                <option value="antiferromagnetic">{isQe ? "Antiferromagnetic — alternating spins along the cell diagonal" : "Antiferromagnetic — Alternating spins along c-axis (KUKS)"}</option>
              </select>
            </label>

            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--cdf-ink-muted, #52606d)", marginBottom: "6px" }}>Hubbard +U</span>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "13px" }}>
                <input
                  type="checkbox"
                  checked={periodicPlusU}
                  onChange={(event) => setPeriodicPlusU(event.currentTarget.checked)}
                  data-testid="periodic-plus-u-toggle"
                  style={{ width: "16px", height: "16px" }}
                />
                <span>Enable Dudarev +U</span>
              </label>
            </div>
          </div>

          {periodicPlusU && detectedTransitionElements.length > 0 ? (
            <div
              style={{
                background: "var(--cdf-surface-subtle, #f8fafc)",
                border: "1px solid var(--cdf-line, #d6dde4)",
                padding: "8px 12px",
                borderRadius: "3px",
              }}
              data-testid="periodic-u-effective-inputs"
            >
              <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cdf-ink-muted, #52606d)", display: "block", marginBottom: "6px" }}>
                Effective Hubbard U (U_eff in eV, Dudarev 1998 / Jain 2011 defaults)
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                {detectedTransitionElements.map((el) => (
                  <label key={el} style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
                    <strong>{el} 3d:</strong>
                    <input
                      type="number"
                      step="0.05"
                      min="0.0"
                      max="15.0"
                      value={periodicUEff[el] ?? DEFAULT_U_EFFECTIVE_EV[el] ?? 3.7}
                      onChange={(event) => {
                        const val = parseFloat(event.currentTarget.value);
                        if (!isNaN(val)) setPeriodicUEff((prev) => ({ ...prev, [el]: val }));
                      }}
                      style={{ width: "65px", padding: "2px 4px", fontSize: "12px", fontFamily: "monospace" }}
                      data-testid={`periodic-u-input-${el}`}
                    />
                    <span>eV</span>
                  </label>
                ))}
              </div>
              <span style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", lineHeight: 1.35, display: "block", marginTop: "6px" }} data-testid="periodic-u-defaults-note">{U_DEFAULTS_NOTE}</span>
            </div>
          ) : null}

          <div style={{ fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", lineHeight: 1.4 }}>
            <span>{isQe ? "Collinear spin symmetry broken along the cell diagonal for 3d transition metals. Smearing: Fermi-Dirac (0.01 Ry = 0.005 Ha). Cell relaxation, stress and pressure are not offered." : "Collinear spin symmetry broken along the crystal's trigonal/c axis for 3d transition metals. Smearing: Fermi-Dirac (σ = 0.005 Ha). Scratch limit: 10 GB."}</span>
          </div>
        </div>
      ) : (
        <div className="calculation-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))" }}>
          {taskSelector}
          <label>Engine<select value={engine} onChange={(event) => {
            const nextEngine = event.currentTarget.value as "pyscf" | "xtb" | "psi4";
            setEngine(nextEngine);
            if (nextEngine === "xtb") {
              setMethod("gfn2");
            } else if (nextEngine === "psi4") {
              setMethod("hf");
              setBasis("sto-3g");
              setCharge(0);
              setMultiplicity(1);
            } else if (method === "gfn2") {
              setMethod("hf");
              setBasis("sto-3g");
            }
          }}>
            <option value="pyscf" disabled={!pyscf?.supported_tasks.includes(task)}>PySCF {pyscf?.version ? `(${pyscf.version})` : ""}</option>
            <option value="psi4" disabled={task !== "ENERGY" || psi4?.availability !== "AVAILABLE" || !psi4?.supported_tasks.includes(task)}>Psi4 {psi4?.version ? `(${psi4.version})` : ""} {task !== "ENERGY" ? "— Energy only" : psi4?.availability !== "AVAILABLE" ? (isCapabilityExpired ? "— Refresh required" : "— Unavailable") : ""}</option>
            <option value="xtb" disabled={xtb?.availability !== "AVAILABLE" || !xtb.supported_tasks.includes(task)}>xTB {xtb?.version ? `(${xtb.version})` : ""} {xtb?.availability !== "AVAILABLE" ? (isCapabilityExpired ? "— Refresh required" : "— Unavailable") : ""}</option>
          </select></label>
          <label>Method{engine === "xtb" ? (
            <select value="gfn2" disabled><option value="gfn2">GFN2-xTB</option></select>
          ) : engine === "psi4" ? (
            <select value={method} onChange={(event) => {
              const nextMethod = event.currentTarget.value;
              setMethod(nextMethod);
              const validBases = getPsi4SupportedBases(nextMethod, psi4);
              if (!validBases.includes(basis)) {
                setBasis(validBases[0] ?? "def2-svp");
              }
            }}>
              {getPsi4SupportedMethods(psi4).map((id) => (
                <option key={id} value={id}>
                  {id === "hf" ? "Hartree–Fock (HF)" : id === "b3lyp" ? "B3LYP (DFT)" : id === "pbe" ? "PBE (DFT)" : id === "mp2" ? "MP2 (Post-HF)" : id.toUpperCase()}
                </option>
              ))}
            </select>
          ) : (
            <select value={method} onChange={(event) => setMethod(event.currentTarget.value)}>{pyscf?.supported_methods.map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}</select>
          )}</label>
          <label>Basis{engine === "xtb" ? (
            <select value="" disabled><option value="">Built-in method basis and parameters</option></select>
          ) : engine === "psi4" ? (
            <select value={basis} onChange={(event) => setBasis(event.currentTarget.value)}>
              {getPsi4SupportedBases(method, psi4).map((id) => (
                <option key={id} value={id}>{id.toUpperCase()}</option>
              ))}
            </select>
          ) : (
            <select value={basis} onChange={(event) => setBasis(event.currentTarget.value)}>{pyscf?.supported_basis_sets.map((id) => { const coverage = pyscfBasisCoverage(id); return <option key={id} value={id} disabled={!coverage.usable}>{coverage.usable ? id.toUpperCase() : `${id.toUpperCase()} — unavailable (Z ≤ ${coverage.limit} only)`}</option>; })}</select>
          )}</label>
          <label>Charge<input type="number" value={engine === "psi4" ? 0 : charge} onChange={(event) => setCharge(Number(event.currentTarget.value))} disabled={engine === "psi4"} title={engine === "psi4" ? "Psi4 Gate C scope is restricted to neutral singlets (charge 0)" : undefined} /></label>
          <label>Multiplicity<input type="number" min={1} value={engine === "psi4" ? 1 : multiplicity} onChange={(event) => setMultiplicity(Number(event.currentTarget.value))} disabled={engine === "psi4" || task === "TDDFT"} title={engine === "psi4" ? "Psi4 Gate C scope is restricted to closed-shell singlets (multiplicity 1)" : undefined} /></label>
          {task === "TDDFT" ? <label>Excited states<input type="number" min={1} max={20} value={nstates} onChange={(event) => setNstates(Number(event.currentTarget.value))} aria-describedby="calc-nstates-hint" /><small id="calc-nstates-hint">Singlet states. 5 is the count checked on the hosted worker; more states may not converge.</small></label> : null}
          {task === "GEOMETRY_OPTIMIZATION" ? <>
            <label>Maximum steps<input type="number" min={1} max={500} value={maxSteps} onChange={(event) => setMaxSteps(Number(event.currentTarget.value))} /></label>
            <label>Optimizer<input value={optimizer ?? "Unavailable"} disabled /></label>
            {engine === "xtb" ? <label>Optimization level<input value={level ?? "Unavailable"} disabled /></label> : null}
            {engine !== "xtb" ? (Object.keys(convergenceLabels) as Array<keyof typeof convergenceLabels>).map((key) =>
              <label key={key}>{convergenceLabels[key]} threshold<input type="number" min="0" step="any" placeholder="Engine default"
                value={convergence[key] ?? ""} onChange={(event) => setConvergence((current) => ({ ...current, [key]: event.currentTarget.value }))} /></label>) : null}
          </> : null}
        </div>
      )}
      {capabilityError ? (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            marginBottom: "12px",
            borderRadius: "4px",
            fontSize: "12px",
            backgroundColor: isCapabilityExpired ? "#eff6ff" : "#fef2f2",
            border: isCapabilityExpired ? "1px solid #bfdbfe" : "1px solid #fecaca",
            color: isCapabilityExpired ? "#1e40af" : "#991b1b",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
          }}
          data-testid="capability-alert"
        >
          <span>
            <strong>{isCapabilityExpired ? "Submission availability cache expired:" : "Engine capabilities unavailable:"}</strong>{" "}
            {isCapabilityExpired
              ? "Existing validated results remain authoritative. Refresh engine availability before submitting new calculations."
              : capabilityError}
          </span>
          <button
            type="button"
            className="bp6-button bp6-small"
            style={{ whiteSpace: "nowrap" }}
            onClick={() => { void refresh().catch(() => {}); }}
          >
            {isCapabilityExpired ? "Refresh availability" : "Retry engine capabilities"}
          </button>
        </div>
      ) : null}
      {periodic ? (
        <>
          {!isQe && periodicLimitView.note ? <p className="calculation-hint" data-testid="hosted-limit-note">{periodicLimitView.note}</p> : null}
          {!isQe ? <p className="calculation-hint" data-testid="hosted-time-note">Estimate on the hosted machine (2 vCPU): Γ-only, 10 atoms, about 17 min (1009 s measured once); your cell may differ.</p> : null}
          {!isQe && periodicLimitView.refusal ? <p className="calculation-unavailable" role="alert" data-testid="hosted-limit-refusal"><AppIcon icon="warning-sign" /> {periodicLimitView.refusal} Run is disabled until the unit cell has at most 20 atoms.</p> : null}
          {!isQe && !periodicCoverage.usable ? <p className="calculation-unavailable" role="alert" data-testid="basis-element-limit"><AppIcon icon="warning-sign" /> PySCF GTH pseudopotentials and MOLOPT basis support elements Z = 1–56 and 72–86. This crystal contains elements outside coverage: Z = {periodicCoverage.offending.join(", ")}.</p> : null}
          {!available && (isQe ? !qeRefusalText : !periodicLimitView.refusal && periodicCoverage.usable) ? (
            <p className="calculation-unavailable">
              <AppIcon icon="warning-sign" /> {isCapabilityExpired ? "Submission capabilities expired. Refresh capabilities above." : isQe ? `${QE_ENGINE_LABEL} is unavailable.` : activeCapability ? `${activeCapability.engine.toUpperCase()} worker unavailable.` : "Checking isolated scientific worker…"}
            </p>
          ) : null}
        </>
      ) : (
        <>
          {engine === "pyscf" && task === "GEOMETRY_OPTIMIZATION" && !pyscf?.supported_optimizers?.includes("geometric") ? (
            <p className="calculation-unavailable" role="alert" data-testid="hosted-geometric-refusal">
              <AppIcon icon="info-sign" /> {HOSTED_GEOMETRIC_MESSAGE}
            </p>
          ) : null}
          {engine === "xtb" && !xtb?.supported_tasks.includes(task) ? (
            <p className="calculation-unavailable">
              <AppIcon icon="info-sign" /> The selected xTB engine does not support {task.toLowerCase()}. Select a supported task or engine.
            </p>
          ) : null}
          {limitView.note ? <p className="calculation-hint" data-testid="hosted-limit-note">{limitView.note}</p> : null}
          {timeNote ? <p className="calculation-hint" data-testid="hosted-time-note">{timeNote}</p> : null}
          {limitView.refusal ? <p className="calculation-unavailable" role="alert" data-testid="hosted-limit-refusal"><AppIcon icon="warning-sign" /> {limitView.refusal} Run is disabled until the structure or the task changes.</p> : null}
          {!available && !limitView.refusal ? (
            <p className="calculation-unavailable">
              <AppIcon icon="warning-sign" /> {!geometryEligible
                ? (geometryEligibility?.detail ?? (geometry.loading
                  ? "Checking calculation eligibility…"
                  : "Calculation eligibility must be verified before submission."))
                : engine === "psi4" && !psi4Validation.valid
                  ? psi4Validation.reason
                  : isCapabilityExpired
                    ? "Submission capabilities expired. Existing validated results remain authoritative. Refresh capabilities above to submit new calculations."
                    : activeCapability
                      ? `${activeCapability.engine.toUpperCase()} worker unavailable in this development environment. ${activeCapability.diagnostic ?? ""}`
                      : "Checking isolated scientific worker…"}
            </p>
          ) : null}
          {task === "FREQUENCY" && initialStructureOrigin !== "OPTIMIZED" ? <p className="calculation-unavailable">Frequency analysis is being run on a geometry not recorded as an optimized stationary point.</p> : null}
          {!selectedPyscfCoverage.usable ? <p className="calculation-unavailable" role="alert" data-testid="basis-element-limit">{coverageMessage(basis, selectedPyscfCoverage)} Choose a basis that covers every element, or use xTB.</p> : null}
        </>
      )}
      <ActionButton
        intent="primary"
        icon="play"
        text={busy ? "Validating…" : periodic ? (isQe ? "Run Quantum ESPRESSO periodic job" : "Run periodic energy") : task === "ENERGY" ? (engine === "xtb" ? "Run GFN2-xTB energy" : engine === "psi4" ? "Run Psi4 energy" : "Run energy") : task === "FREQUENCY" ? "Run vibrational analysis" : task === "ORBITAL" ? "Calculate orbitals" : task === "TDDFT" ? "Run TDDFT calculation" : "Optimize geometry"}
        disabled={!available || busy || Boolean(calculation && !terminal) || (!periodic && task === "TDDFT" && (!Number.isInteger(nstates) || nstates < 1 || nstates > 20)) || (!periodic && task === "GEOMETRY_OPTIMIZATION" && (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 500))}
        onClick={() => void runCalculation()}
      />
      {message ? <p className="calculation-message">{message}</p> : null}
      {calculation && calculation.calculation.state === "SUCCEEDED" ? (
        <CiteNudge
          projectId={projectId}
          onOpenCite={() => setCiteOpen((prev) => !prev)}
        />
      ) : null}
      {citeOpen && calculation ? (
        <div style={{ margin: "8px 0" }}>
          <CiteCalculation projectId={projectId} calculationId={calculation.calculation.id} />
        </div>
      ) : null}
      {calculation ? (
        <div className="calculation-result" aria-label="Calculation result" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))" }}>
          {energy && calculation.calculation.state === "SUCCEEDED" && calculation.result?.validation_state === "VALIDATED" ? (
            <div className="calculation-energy-full-width">
              <EnergyPrecisionPlate
                projectId={projectId}
                calculationId={calculation.calculation.id}
                resultId={calculation.result?.id}
                structureVersionId={structureVersionId}
                structureId={structure.structure.id}
                structureName={`${structure.structure.name} V${structure.version.revision}`}
                provenanceRecordId={calculation.result?.provenance_record_id}
                calculationState={calculation.calculation.state}
                method={energy.method ?? undefined}
                basis={energy.basis ?? null}
                engineName={calculation.result?.producer_software.name ?? (engine === "xtb" ? "xtb" : engine === "psi4" ? "psi4" : "pyscf")}
                engineVersion={calculation.result?.producer_software.version ?? (engine === "xtb" ? (xtb?.version ?? "6.7.1") : engine === "psi4" ? (psi4?.version ?? "1.11") : (pyscf?.version ?? "2.14.0"))}
                energyValue={energy.total_energy.value}
                energyUnit={energy.total_energy.unit.code}
                converged={energy.converged}
                scfIterations={energy.scf_iterations ?? null}
                inputHash={calculation.calculation_input_hash}
                sourceClass={calculation.result?.source_class ?? "CALCULATED"}
                authority={calculation.result?.authority}
                verificationState={calculation.result?.verification_state}
                effectiveState={calculation.result?.effective_state}
                validationState={calculation.result?.validation_state ?? "VALIDATED"}
                rawPayload={(calculation.result?.payload as unknown as Record<string, unknown>) ?? null}
                compact
              />
              {calculation.result?.result_type === "chemdft.energy" ? (
                <Dftd4CorrectionControl key={calculation.result.id} projectId={projectId} source={calculation.result} />
              ) : null}
            </div>
          ) : null}
          <div><span>State</span><strong>{calculation.calculation.state}</strong></div>
          <div><span>Compute</span><strong>{computeState}</strong></div>
          {!terminal && calculation.compute_job ? (
            <div data-testid="calculation-pulse-light-row" style={{ gridColumn: "1 / -1", padding: "4px 0" }}>
              <PulseLightIndicator
                jobState={calculation.compute_job.state}
                provider={calculation.compute_job.provider}
                workerStatus={calculation.compute_job.worker_status}
                createdAt={calculation.compute_job.created_at}
                startedAt={calculation.compute_job.latest_execution?.started_at}
                heartbeatAt={calculation.compute_job.latest_execution?.heartbeat_at}
                heartbeatStatus={(calculation.compute_job as { heartbeat_status?: "FRESH" | "STALE" | "NOT_REPORTED" | "NOT_APPLICABLE" | null })?.heartbeat_status}
                heartbeatAgeSeconds={(calculation.compute_job as { heartbeat_age_seconds?: number | null })?.heartbeat_age_seconds}
                heartbeatStaleAfterSeconds={(calculation.compute_job as { heartbeat_stale_after_seconds?: number | null })?.heartbeat_stale_after_seconds}
                onCancel={requestCancel}
                cancelDisabled={busy}
              />
            </div>
          ) : null}
          {!terminal && calculation.compute_job?.worker_status ? <div data-testid="calculation-worker-status" role="status"><span>Engine status</span><strong>{calculation.compute_job.worker_status}</strong></div> : null}
          <div><span>Provider</span><strong>{calculation.compute_job?.provider ?? "—"}</strong></div>
          <div><span>Estimate</span><strong>{calculation.compute_job?.estimate?.provider_summary ?? "—"}</strong></div>
          <div><span>Attempts</span><strong>{calculation.compute_job?.attempt_count ?? 0}</strong></div>
          <div><span>Source class</span><strong>{calculation.result?.source_class ?? "No authoritative result"}</strong></div>
          <div><span>Energy</span><strong>{energy ? `${energy.total_energy.value.toFixed(10)} ${energy.total_energy.unit.code}` : "Not published"}</strong></div>
          <div><span>Method / basis</span><strong>{energy ? `${energy.method ? energy.method.toUpperCase() : periodic ? (periodicPlusU ? "PBE+U" : "PBE") : method.toUpperCase()} / ${energy.basis ?? (periodic ? (isQe ? QE_BASIS_DISPLAY : "GTH-DZVP-MOLOPT-SR") : "None (tight-binding)")}` : `${periodic ? (periodicPlusU ? "PBE+U" : "PBE") : method.toUpperCase()} / ${periodic ? (isQe ? QE_BASIS_DISPLAY : "GTH-DZVP-MOLOPT-SR") : engine === "xtb" ? "None (tight-binding)" : basis}`}</strong></div>
          <div><span>Engine</span><strong>{calculation.result ? `${calculation.result.producer_software.name} ${calculation.result.producer_software.version}` : (periodic ? (isQe ? QE_ENGINE_LABEL : "PySCF (PBC)") : "No engine result")}</strong></div>
          <div><span>Validation</span><strong>{calculation.result?.validation_state ?? calculation.attempt?.failure_code ?? "Pending"}</strong></div>
          <div><span>Convergence</span><strong>{calculation.optimization_trajectory?.state === "CONVERGED" || energy?.converged ? "Converged" : calculation.optimization_trajectory?.state === "NOT_CONVERGED" ? "Not converged" : "Not established"}</strong></div>
          <div><span>Input hash</span><strong>{calculation.calculation_input_hash.slice(0, 16)}…</strong></div>
          <div><span>Result ID</span><strong>{calculation.result?.id ?? "—"}</strong></div>
          <div><span>Raw artifacts</span><strong>{calculation.attempt?.raw_artifacts?.length ?? 0} retained · internal references only</strong></div>
          {calculation.optimization_trajectory ? <div><span>Trajectory</span><strong>{calculation.optimization_trajectory.state} · {calculation.optimization_trajectory.steps.length} recorded evaluations</strong></div> : null}
          {calculation.optimization_trajectory ? <button type="button" onClick={() => openSelection({ kind: "optimizationTrajectory", id: calculation.optimization_trajectory!.id, projectId, sourceId: calculation.calculation.id }, "Optimization trajectory")}>Open trajectory</button> : null}
          {calculation.result?.result_type === "chemdft.vibrational-analysis" ? <button type="button" onClick={() => openSelection({ kind: "calculationResult", id: calculation.result!.id, projectId, sourceId: calculation.calculation.id }, "modes" in calculation.result!.payload ? vibrationalSpectrumLabel(calculation.result!.payload) : "IR spectrum · 0 modes")}>{"modes" in calculation.result!.payload && vibrationalKind(calculation.result!.payload) === "raman" ? "Open Raman spectrum" : "Open IR spectrum"}</button> : null}
          {calculation.result?.result_type === "chemdft.molecular-orbitals" ? <button type="button" onClick={() => openSelection({ kind: "calculationResult", id: calculation.result!.id, projectId, sourceId: calculation.calculation.id }, "Molecular orbitals")}>Open molecular orbitals</button> : null}
          {calculation.result?.result_type === "chemdft.tddft" ? <button type="button" onClick={() => openSelection({ kind: "calculationResult", id: calculation.result!.id, projectId, sourceId: calculation.calculation.id }, "UV/Vis absorption spectrum")}>Open UV/Vis spectrum</button> : null}
          {calculation.result && !["chemdft.vibrational-analysis", "chemdft.molecular-orbitals", "chemdft.tddft"].includes(calculation.result.result_type) ? <button type="button" data-testid="calculation-panel-open-result" onClick={() => openSelection({ kind: "calculationResult", id: calculation.result!.id, projectId, sourceId: calculation.calculation.id }, `Result · ${calculation.result!.result_type.replace(/^chemdft\./, "")}`)}>Open result</button> : null}
          {executionArtifacts.map((artifact) => (
            <ActionButton key={artifact.artifact_id} minimal small icon="download" text={psi4Execution ? `Download retained artifact ${artifact.artifact_id.slice(0, 8)}` : "Download execution log"} onClick={() => void downloadExecutionArtifact(artifact.artifact_id)} />
          ))}
          {!terminal && calculation.compute_job ? (
            <ActionButton minimal small icon="disable" text="Cancel" disabled={busy} onClick={() => void requestCancel()} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
