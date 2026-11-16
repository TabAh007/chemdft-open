"use client";

import { useEffect, useState } from "react";
import type { CalculationDetail, EnergyResult, MolecularOrbitalAnalysis, StructureVersionDetail } from "@chemdft/schemas";
import { getCalculation } from "@/lib/structure-workspace-api";
import { calculationInputStructure, selectedPublishedResult } from "@/lib/calculation-result-association";
import { EnergyPrecisionPlate } from "@/app/[locale]/projects/[projectId]/workspace/visualization/energy-precision-plate";
import { OptimizationTrajectoryPanel } from "@/app/[locale]/projects/[projectId]/workspace/visualization/optimization-trajectory-panel";
import { ConformerEnsembleExplorer } from "../conformers/conformer-ensemble-explorer";
import { Dftd4CorrectionControl, Dftd4ResultView } from "../dftd4-correction";
import { GuidedResultView } from "./guided-result-view";
import { ScientificStateStrip } from "../scientific-state-strip";
import { CalculationScientificSummary } from "../calculation-scientific-summary";

type Props = {
  projectId: string;
  calculationId: string;
  resultId: string;
  tab: "MO" | "Density" | "ESP";
  onInspect: (structure: StructureVersionDetail) => void;
  onHome: () => void;
  onOptimize: () => void;
  hasOptimizedGeometry?: boolean | undefined;
  onAi: () => void;
  onAdvanced: () => void;
};

/** Mount with a calculation/result key so no earlier selection can be rendered while loading. */
export function SelectedGuidedResult(props: Props) {
  const { projectId, calculationId, resultId } = props;
  const [record, setRecord] = useState<{ detail: CalculationDetail; structure: StructureVersionDetail } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", { detail: {
      projectId, calculationId, resultId, structureName: undefined, structureVersionRevision: undefined,
      currentView: "Selected scientific result → Loading",
    } }));
    void (async () => {
      const detail = await getCalculation({ projectId, calculationId });
      if (!selectedPublishedResult(detail, calculationId, resultId)) throw new Error("The selected published result is unavailable.");
      if (detail.calculation.state !== "SUCCEEDED" || detail.result?.validation_state !== "VALIDATED") {
        throw new Error(`The selected result cannot be displayed: ${detail.calculation.state} / ${detail.result?.validation_state ?? "unavailable"}.`);
      }
      const structure = await calculationInputStructure(projectId, detail);
      if (alive) setRecord({ detail, structure });
    })().catch((cause: unknown) => {
      if (!alive) return;
      setError(cause instanceof Error ? cause.message : "The selected result could not be loaded.");
      window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", { detail: {
        projectId, calculationId, resultId, currentView: "Selected scientific result → Unavailable",
      } }));
    });
    return () => { alive = false; };
  }, [projectId, calculationId, resultId]);

  useEffect(() => {
    if (!record) return;
    const { detail, structure } = record;
    if (detail.result?.result_type !== "chemdft.energy") return;
    window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", { detail: {
      projectId, calculationId, resultId,
      structureName: structure.structure.name, structureVersionRevision: structure.version.revision,
      currentView: `Total Energy · ${detail.specification.method.identifier.toUpperCase()} · ${structure.structure.name} V${structure.version.revision}`,
    } }));
  }, [record, projectId, calculationId, resultId]);

  if (error) return <div className="guided-result-state" role="alert" data-testid="selected-result-error">{error}</div>;
  if (!record) return <div className="guided-result-state" role="status" data-testid="selected-result-loading">Loading selected scientific result…</div>;
  const { detail, structure } = record;
  const result = detail.result!;
  return <>
    <ScientificStateStrip projectId={projectId} resultId={resultId} result={result} />
    <SelectedResultBody {...props} detail={detail} structure={structure} />
  </>;
}

function SelectedResultBody(props: Props & { detail: CalculationDetail; structure: StructureVersionDetail }) {
  const { projectId, calculationId, resultId, detail, structure } = props;
  const result = detail.result!;
  if (result.result_type === "chemdft.molecular-orbitals") return <div data-testid="selected-orbital-result"
    data-calculation-id={calculationId} data-result-id={resultId} data-structure-version-id={structure.version.id}
    data-engine={result.producer_software.name} data-method={detail.specification.method.identifier}>
    <GuidedResultView
    projectId={projectId} calculationId={calculationId} resultId={resultId} result={result.payload as MolecularOrbitalAnalysis}
    initialTab={props.tab} onOptimizeGeometry={props.onOptimize} hasOptimizedGeometry={props.hasOptimizedGeometry} onOpenAiScientist={props.onAi}
    onNavigateStructure={() => props.onInspect(structure)} onNavigateHome={props.onHome} onSwitchToAdvanced={props.onAdvanced}
  /></div>;
  if (result.result_type === "chemdft.conformer-ensemble") return <ConformerEnsembleExplorer
    projectId={projectId} calculationId={calculationId} resultId={resultId} detail={detail} inputStructure={structure}
    onInspectInput={() => props.onInspect(structure)} />;
  if (result.result_type === "chemdft.optimization") return <div data-testid="selected-optimization-result"
    data-calculation-id={calculationId} data-result-id={resultId} data-structure-version-id={structure.version.id}
    data-engine={result.producer_software.name} data-method={detail.specification.method.identifier}>
    <button type="button" onClick={() => props.onInspect(structure)} title="Open the initial StructureVersion">Open starting structure</button>
    <OptimizationTrajectoryPanel key={calculationId} projectId={projectId} detail={detail} onOpenFinal={props.onInspect} />
  </div>;
  if (result.result_type === "chemdft.dispersion-corrected-energy") return <Dftd4ResultView key={calculationId} projectId={projectId} initial={detail} />;
  if (result.result_type !== "chemdft.energy") return <div className="guided-result-state" role="status">
    Published {detail.specification.task_type.toLowerCase().replaceAll("_", " ")} result available.
    <button type="button" onClick={props.onAdvanced}>Open scientific result in Advanced Workbench</button>
  </div>;
  const energy = result.payload as EnergyResult;
  if (!energy.total_energy || !Number.isFinite(energy.total_energy.value) || !energy.total_energy.unit?.code) {
    return <div role="alert">The selected result has no valid published total energy.</div>;
  }
  return <div className="guided-energy-result-container" data-testid="guided-energy-result-view">
    <EnergyPrecisionPlate projectId={projectId} calculationId={calculationId} resultId={resultId}
      calculationState={detail.calculation.state} method={detail.specification.method.identifier}
      basis={detail.specification.basis?.identifier ?? null} engineName={result.producer_software.name}
      engineVersion={result.producer_software.version} energyValue={energy.total_energy.value}
      energyUnit={energy.total_energy.unit.code} converged={energy.converged} scfIterations={energy.scf_iterations}
      inputHash={detail.calculation_input_hash} sourceClass={result.source_class} validationState={result.validation_state}
      authority={result.authority} verificationState={result.verification_state} effectiveState={result.effective_state}
      structureName={`${structure.structure.name} V${structure.version.revision}`} structureId={structure.structure.id}
      structureVersionId={structure.version.id} provenanceRecordId={result.provenance_record_id}
      rawPayload={result.payload as unknown as Record<string, unknown>}
      onInspectStructure={() => props.onInspect(structure)} onPlanNextStep={props.onAi}
    />
    <Dftd4CorrectionControl key={result.id} projectId={projectId} source={result} />
    <CalculationScientificSummary projectId={projectId} detail={detail} input={structure} />
  </div>;
}
