"use client";

import { ResultScientificState } from "../result-scientific-state";
import { useState } from "react";
import type { CalculationResult, TddftResult, VibrationalAnalysis } from "@chemdft/schemas";
import { ActionButton } from "@chemdft/ui";
import { UvVisSpectroscopyPanel } from "@/app/[locale]/projects/[projectId]/workspace/visualization/uvvis-spectroscopy-panel";
import { IrSpectroscopyPanel } from "@/app/[locale]/projects/[projectId]/workspace/visualization/ir-spectroscopy-panel";
import { RamanSpectroscopyPanel } from "@/app/[locale]/projects/[projectId]/workspace/visualization/raman-spectroscopy-panel";

export interface GuidedSpectraViewProps {
  projectId: string;
  calculationId?: string | undefined;
  resultId?: string | undefined;
  result?: TddftResult | null | undefined;
  vibrationalResult?: {
    calculationId: string;
    resultId: string;
    vibrational: VibrationalAnalysis;
    result: CalculationResult;
  } | null | undefined;
  ramanResult?: {
    calculationId: string;
    resultId: string;
    vibrational: VibrationalAnalysis;
    result: CalculationResult;
  } | null | undefined;
  activeSpectroscopy?: "uvvis" | "ir" | "raman" | undefined;
  onSelectSpectroscopy?: ((type: "uvvis" | "ir" | "raman") => void) | undefined;
  onCalculateIr?: (() => void) | undefined;
  onCalculateUvVis?: (() => void) | undefined;
  onCalculateRaman?: (() => void) | undefined;
  structureName?: string | undefined;
  initialSelectedState?: string | null | undefined;
  onStateSelected?: ((stateLabel: string | null) => void) | undefined;
  initialSelectedMode?: number | null | undefined;
  onModeSelected?: ((modeIndex: number | null) => void) | undefined;
  onNavigateStructure: () => void;
  onNavigateHome: () => void;
  onNavigateElectronicStructure: (moIndex?: number) => void;
  onOpenAiScientist: () => void;
  onSwitchToAdvanced: () => void;
}

export function GuidedSpectraView({
  projectId,
  calculationId,
  resultId,
  result,
  vibrationalResult,
  ramanResult,
  activeSpectroscopy: propActiveSpectroscopy,
  onSelectSpectroscopy,
  onCalculateIr,
  onCalculateUvVis,
  onCalculateRaman,
  structureName,
  initialSelectedState,
  onStateSelected,
  initialSelectedMode,
  onModeSelected,
  onNavigateStructure,
  onNavigateHome,
  onNavigateElectronicStructure,
  onOpenAiScientist,
  onSwitchToAdvanced,
}: GuidedSpectraViewProps) {
  // Determine which tab is active: prefer controlled prop, or fallback to available results
  const [internalSpectroscopy, setInternalSpectroscopy] = useState<"uvvis" | "ir" | "raman">(() => {
    if (propActiveSpectroscopy) return propActiveSpectroscopy;
    if (ramanResult && !vibrationalResult && !result) return "raman";
    if (vibrationalResult && !result) return "ir";
    return "uvvis";
  });

  const activeTab = propActiveSpectroscopy ?? internalSpectroscopy;

  const handleTabSwitch = (type: "uvvis" | "ir" | "raman") => {
    setInternalSpectroscopy(type);
    onSelectSpectroscopy?.(type);
  };

  const hasUvVis = Boolean(result);
  const hasIr = Boolean(vibrationalResult);
  const hasRaman = Boolean(ramanResult);

  return (
    <div className="guided-spectra-view-container" data-testid="guided-spectra-view">
      {/* Spectroscopy type switcher: three instruments in one workspace */}
      <div className="guided-spectra-selector spectro-tabs" role="group" aria-label="Spectroscopy type">
        {([
          { id: "uvvis", label: "UV/Vis", done: hasUvVis },
          { id: "ir", label: "IR", done: hasIr },
          { id: "raman", label: "Raman", done: hasRaman },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleTabSwitch(tab.id)}
            className={`spectro-tab ${activeTab === tab.id ? "active" : ""}`}
            aria-pressed={activeTab === tab.id}
            aria-current={activeTab === tab.id ? "page" : undefined}
            data-testid={`spectra-tab-${tab.id}`}
            title={tab.done ? `${tab.label} spectrum calculated` : `${tab.label} spectrum not calculated yet`}
          >
            <span>{tab.label}</span>
            {tab.done ? <span className="spectro-tab-dot" role="img" aria-label="Result available" title="Result available" /> : null}
          </button>
        ))}
        <button type="button" className="spectro-tab-back" onClick={onNavigateHome}>Overview</button>
      </div>

      {resultId && (activeTab === "uvvis" ? hasUvVis : activeTab === "ir" ? hasIr : hasRaman)
        ? <ResultScientificState key={resultId} projectId={projectId} resultId={resultId} /> : null}

      {/* Main Content Area */}
      {activeTab === "uvvis" ? (
        result ? (
          <UvVisSpectroscopyPanel
            projectId={projectId}
            calculationId={calculationId ?? ""}
            resultId={resultId ?? ""}
            result={result}
            active={activeTab === "uvvis"}
            structureName={structureName}
            initialSelectedState={initialSelectedState}
            onStateSelected={onStateSelected}
            onSelectOrbital={(moIndex) => onNavigateElectronicStructure(moIndex)}
            onSwitchToAdvanced={onSwitchToAdvanced}
          />
        ) : (
          <div style={{ padding: "40px 20px", textAlign: "center", background: "var(--cdf-surface)" }}>
            <h3 style={{ margin: "0 0 8px" }}>No UV/Vis absorption spectrum calculated yet</h3>
            <p style={{ margin: "0 0 20px", color: "var(--cdf-ink-muted)", fontSize: "13px" }}>
              Calculate electronic excited states (TDDFT) to predict UV/Vis transition energies and oscillator strengths.
            </p>
            {onCalculateUvVis ? (
              <ActionButton
                intent="primary"
                icon="play"
                text="Predict UV/Vis Spectrum (TDDFT)"
                onClick={onCalculateUvVis}
              />
            ) : null}
          </div>
        )
      ) : activeTab === "ir" ? (
        vibrationalResult ? (
          <IrSpectroscopyPanel
            projectId={projectId}
            calculationId={vibrationalResult.calculationId}
            resultId={vibrationalResult.resultId}
            result={vibrationalResult.result}
            active={activeTab === "ir"}
            structureName={structureName}
            initialSelectedMode={initialSelectedMode}
            onModeSelected={onModeSelected}
            onSwitchToAdvanced={onSwitchToAdvanced}
          />
        ) : (
          <div style={{ padding: "40px 20px", textAlign: "center", background: "var(--cdf-surface)" }}>
            <h3 style={{ margin: "0 0 8px" }}>No IR spectrum calculated yet</h3>
            <p style={{ margin: "0 0 20px", color: "var(--cdf-ink-muted)", fontSize: "13px" }}>
              Calculate the analytic Hessian and dipole derivatives with PySCF (B3LYP / def2-SVP) to predict normal-mode frequencies and IR intensities.
            </p>
            {onCalculateIr ? (
              <ActionButton
                intent="primary"
                icon="play"
                text="Predict / Calculate IR Spectrum (B3LYP / def2-SVP · PySCF)"
                onClick={onCalculateIr}
                data-testid="calculate-ir-spectrum-btn"
              />
            ) : null}
          </div>
        )
      ) : ramanResult ? (
        <RamanSpectroscopyPanel
          projectId={projectId}
          calculationId={ramanResult.calculationId}
          resultId={ramanResult.resultId}
          result={ramanResult.result}
          active={activeTab === "raman"}
          structureName={structureName}
          initialSelectedMode={initialSelectedMode}
          onModeSelected={onModeSelected}
          onSwitchToAdvanced={onSwitchToAdvanced}
        />
      ) : (
        <div style={{ padding: "40px 20px", textAlign: "center", background: "var(--cdf-surface)" }}>
          <h3 style={{ margin: "0 0 8px" }}>No Raman spectrum calculated yet</h3>
          <p style={{ margin: "0 0 20px", color: "var(--cdf-ink-muted)", fontSize: "13px" }}>
            Calculates harmonic vibrational modes and non-resonant Raman activities with PySCF (B3LYP / def2-SVP) via finite electric field polarizabilities.
          </p>
          {onCalculateRaman ? (
            <ActionButton
              intent="primary"
              icon="play"
              text="Predict / Calculate Raman Spectrum (B3LYP / def2-SVP · PySCF)"
              onClick={onCalculateRaman}
              data-testid="calculate-raman-spectrum-btn"
            />
          ) : null}
        </div>
      )}

      {/* Guided Next Actions Footer */}
      <div className="guided-spectra-footer-actions">
        <div className="footer-actions-left">
          <ActionButton
            intent="primary"
            icon="predictive-analysis"
            text="Explore molecular orbitals"
            onClick={() => onNavigateElectronicStructure()}
            data-testid="spectra-goto-mo-btn"
          />
          <ActionButton
            icon="chat"
            text="Ask AI Scientist about spectrum"
            onClick={onOpenAiScientist}
            data-testid="spectra-ask-ai-btn"
          />
        </div>
        <div className="footer-actions-right">
          <ActionButton
            minimal
            icon="cube"
            text="Back to structure"
            onClick={onNavigateStructure}
          />
          <ActionButton
            minimal
            icon="layout-grid"
            text="Advanced Workbench"
            onClick={onSwitchToAdvanced}
          />
        </div>
      </div>
    </div>
  );
}
