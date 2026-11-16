"use client";

import { ResultScientificState } from "../result-scientific-state";
import { HelpTip } from "@/app/_components/help/help-tip";
import { useState } from "react";
import { ActionButton } from "@chemdft/ui";
import { ThermochemistryPanel, type ThermochemistryConditionRequest } from "@/app/[locale]/projects/[projectId]/workspace/visualization/thermochemistry-panel";
import { DEFAULT_THERMO_TEMPERATURE_K, STANDARD_ATMOSPHERE_PA, type ThermoRecord } from "@/lib/thermochemistry";

export interface ThermochemistryEligibility {
  frequencyResultId: string;
  structureVersionId: string;
}

export interface GuidedThermochemistryViewProps {
  projectId: string;
  records: ThermoRecord[];
  selectedResultId?: string | null | undefined;
  onSelectResult?: ((resultId: string) => void) | undefined;
  onRequestConditions: (request: ThermochemistryConditionRequest) => Promise<{ error?: string }>;
  /** Frequency result on a ChemDFT-optimized geometry that may be offered as a source. */
  eligibleSource: ThermochemistryEligibility | null;
  hasOptimizedGeometry: boolean;
  hasFrequencyResult: boolean;
  structureName?: string | undefined;
  onNavigateStructure: () => void;
  onNavigateHome: () => void;
  onOpenAiScientist: () => void;
  onSwitchToAdvanced: () => void;
}

export function GuidedThermochemistryView({
  projectId,
  records,
  selectedResultId,
  onSelectResult,
  onRequestConditions,
  eligibleSource,
  hasOptimizedGeometry,
  hasFrequencyResult,
  structureName,
  onNavigateStructure,
  onNavigateHome,
  onOpenAiScientist,
  onSwitchToAdvanced,
}: GuidedThermochemistryViewProps) {
  const [request, setRequest] = useState<{ state: "idle" | "pending" | "error"; message?: string }>({ state: "idle" });

  async function calculateDefault() {
    if (!eligibleSource) return;
    setRequest({ state: "pending" });
    const outcome = await onRequestConditions({
      frequencyResultId: eligibleSource.frequencyResultId,
      structureVersionId: eligibleSource.structureVersionId,
      temperatureK: DEFAULT_THERMO_TEMPERATURE_K,
      pressurePa: STANDARD_ATMOSPHERE_PA,
    });
    setRequest(outcome.error ? { state: "error", message: outcome.error } : { state: "idle" });
  }

  return (
    <div className="guided-spectra-view-container guided-thermo-container" data-testid="guided-thermochemistry-view">
      <div className="guided-spectra-selector spectro-tabs" role="group" aria-label="Analysis">
        <button type="button" className="spectro-tab active" aria-current="page" data-testid="analysis-tab-thermochemistry">
          <span>Thermochemistry</span>
          {records.length > 0 ? <span className="spectro-tab-dot" role="img" aria-label="Result available" title="Result available" /> : null}
        </button>
        <button type="button" className="spectro-tab-back" onClick={onNavigateHome}>Overview</button>
      </div>

      {records.length > 0 && selectedResultId ? <ResultScientificState key={selectedResultId} projectId={projectId} resultId={selectedResultId} /> : null}

      {records.length > 0 ? (
        <ThermochemistryPanel
          projectId={projectId}
          records={records}
          selectedResultId={selectedResultId}
          onSelectResult={onSelectResult}
          onRequestConditions={onRequestConditions}
          structureName={structureName}
          onSwitchToAdvanced={onSwitchToAdvanced}
        />
      ) : (
        <div className="thermo-empty" data-testid="thermochemistry-empty">
          <h3>No thermochemistry calculated yet <HelpTip topic="thermochemistry.frequency_requirement" /></h3>
          <p>
            Thermochemistry reuses a validated optimized geometry, its harmonic frequencies and its electronic energy
            (ideal-gas rigid-rotor harmonic-oscillator model). No DFT or Hessian is rerun.
          </p>
          <ul className="thermo-checklist">
            <li className={hasOptimizedGeometry ? "is-ok" : "is-missing"}>
              {hasOptimizedGeometry ? "✓" : "○"} Geometry optimized with ChemDFT (same method and basis as the frequencies)
            </li>
            <li className={hasFrequencyResult ? "is-ok" : "is-missing"}>
              {hasFrequencyResult ? "✓" : "○"} Frequency calculation on that optimized geometry, with no imaginary modes
            </li>
            <li className={eligibleSource ? "is-ok" : "is-missing"}>
              {eligibleSource ? "✓" : "○"} Gradient RMS ≤ 3×10⁻⁴ Eh/bohr and persisted electronic energy (verified by the server)
            </li>
          </ul>
          <p className="thermo-conditions" data-testid="thermo-default-conditions">
            {`Conditions: ${DEFAULT_THERMO_TEMPERATURE_K} K · ${STANDARD_ATMOSPHERE_PA === 101325 ? "1 atm" : `${STANDARD_ATMOSPHERE_PA} Pa`} (default). Model: ideal gas, rigid rotor, harmonic oscillator.`}
          </p>
          {request.state === "error" ? <p role="alert" className="thermo-request-error" data-testid="thermo-request-error">{request.message}</p> : null}
          {eligibleSource ? (
            <ActionButton
              intent="primary"
              icon="play"
              text={request.state === "pending" ? "Calculating…" : "Calculate thermochemistry (298.15 K · 1 atm)"}
              disabled={request.state === "pending"}
              onClick={() => void calculateDefault()}
              data-testid="calculate-thermochemistry-btn"
            />
          ) : (
            <p className="thermo-empty-hint">
              Run <strong>Geometry optimization</strong> and then <strong>Frequencies</strong> on the optimized structure
              (Guided → Spectra → Calculate IR), then return here.
            </p>
          )}
        </div>
      )}

      <div className="guided-spectra-footer-actions">
        <div className="footer-actions-left">
          <ActionButton
            icon="chat"
            text="Ask AI Scientist about thermochemistry"
            onClick={onOpenAiScientist}
            data-testid="thermo-ask-ai-btn"
          />
        </div>
        <div className="footer-actions-right">
          <ActionButton minimal icon="cube" text="Back to structure" onClick={onNavigateStructure} />
          <ActionButton minimal icon="layout-grid" text="Advanced Workbench" onClick={onSwitchToAdvanced} />
        </div>
      </div>
    </div>
  );
}
