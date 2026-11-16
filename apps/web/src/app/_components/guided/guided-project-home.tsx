"use client";

import { useState } from "react";
import { ActionButton, AppIcon, StatusTag } from "@chemdft/ui";
import type { StructureVersionDetail, MolecularOrbitalAnalysis } from "@chemdft/schemas";
import { ProjectNavigator } from "../project-navigator";
import type { GuidedJobView } from "@/lib/guided-job-status";
import { GuidedJobBanner } from "./guided-job-banner";

export interface GuidedProjectHomeProps {
  projectId: string;
  projectName: string;
  structure?: StructureVersionDetail | null;
  result?: MolecularOrbitalAnalysis | null;
  hasUnreviewedCandidate?: boolean;
  candidateCount?: number;
  hasEnergyResult?: boolean;
  hasPaper?: boolean;
  hasSpectra?: boolean;
  onNavigateStructure: () => void;
  onNavigateResult: (tab?: "MO" | "Density" | "ESP") => void;
  onNavigateSpectra?: () => void;
  onSetupCalculation: (type: "energy" | "optimization" | "tddft" | "conformer") => void;
  onOpenAiScientist: () => void;
  onSwitchToAdvanced: () => void;
  onImportCalculation?: (() => void) | undefined;
  onDrawMolecule?: () => void;
  /** The submitted job for the selected structure, if any (restored from the persisted records after a reload). */
  job?: { view: GuidedJobView | null; onOpen: () => void; onDismiss: () => void } | undefined;
}

export function GuidedProjectHome({
  projectId,
  projectName,
  structure,
  result,
  hasPaper,
  hasEnergyResult = false,
  hasSpectra,
  onNavigateStructure,
  onNavigateResult,
  onNavigateSpectra,
  onSetupCalculation,
  onOpenAiScientist,
  onDrawMolecule,
  job,
}: GuidedProjectHomeProps) {
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const hasResult = Boolean(result) || hasEnergyResult;
  const atomCount = structure?.version.coordinates?.atoms?.length ?? 0;
  const structName = structure?.structure.name ?? "Target molecule";
  const rev = structure?.version.revision ?? 1;

  return (
    <div className="guided-project-home" data-testid="guided-project-home">
      {job?.view ? <GuidedJobBanner view={job.view} onOpen={job.onOpen} onDismiss={job.onDismiss} /> : null}
      {/* 1. Header with Title, Context Facts and Mode Switch */}
      <header className="guided-home-header">
        <div>
          <div className="guided-title-row">
            <h1 className="guided-project-title">{projectName}</h1>
            <StatusTag intent="primary">Guided Scientific Mode</StatusTag>
          </div>
          <p className="guided-project-facts">
            {structure ? (
              <>
                <span className="fact-item highlight">
                  Structure: {structName} V{rev} ({atomCount} atoms)
                </span>
                <span className="fact-dot">·</span>
                <span>Charge: {structure.version.overall_charge ?? 0}</span>
                <span className="fact-dot">·</span>
                <span>Multiplicity: {structure.version.multiplicity ?? 1}</span>
              </>
            ) : (
              <span>No active molecular structure selected</span>
            )}
            {hasPaper ? (
              <>
                <span className="fact-dot">·</span>
                <span>Linked literature document available</span>
              </>
            ) : null}
          </p>
        </div>

      </header>

      {/* 2. Target Scientific Journey Primary Recommendation */}
      <section className="guided-recommendation" aria-label="Guided workflow recommendation">
        <div style={{ flex: 1 }}>
          <div className="rec-pill-row">
            <span className="rec-badge">Recommended Next Action</span>
            <span className="rec-context-badge">
              {structure ? "Step 3: Choose Calculation" : "Step 1: Molecular Structure"}
            </span>
          </div>
          <h2 className="rec-title">
            {structure
              ? hasResult
                ? "Inspect Published Results & Plan Next Action"
                : "Configure Single-Point Energy (GFN2-xTB / PySCF)"
              : "Import or Draw Molecular Geometry"}
          </h2>
          <p className="rec-description">
            {structure
              ? hasResult
                ? "Published results are available. Inspect their total energy, method, engine and immutable input provenance."
                : `Run semi-empirical GFN2-xTB or PySCF single-point total energy calculations for ${structName} V${rev}.`
              : "Calculations require committed, immutable 3D coordinates. Use Navigator below to select or import a molecule."}
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          {structure ? (
            <>
              <ActionButton
                intent="primary"
                icon={hasResult ? "eye-open" : "play"}
                text={hasResult ? "Explore results" : "Configure calculation"}
                onClick={() => {
                  if (hasResult) {
                    onNavigateResult();
                  } else {
                    onSetupCalculation("energy");
                  }
                }}
                data-testid="guided-primary-action-btn"
              />
              <ActionButton
                minimal
                icon="cube"
                text="Inspect 3D geometry"
                onClick={onNavigateStructure}
                data-testid="guided-inspect-geom-btn"
              />
              {onDrawMolecule ? (
                <ActionButton
                  minimal
                  icon="add"
                  text="New molecule"
                  title={`Draw a separate molecule with its own version history; ${structName} is not changed`}
                  onClick={onDrawMolecule}
                  data-testid="guided-new-molecule-btn"
                />
              ) : null}
            </>
          ) : onDrawMolecule ? (
            <ActionButton
              intent="primary"
              icon="edit"
              text="Draw molecule"
              onClick={onDrawMolecule}
              data-testid="guided-draw-molecule-btn"
            />
          ) : null}
          <button
            type="button"
            className="bp6-button bp6-minimal bp6-small"
            onClick={onOpenAiScientist}
            title="Open contextual AI Scientist"
          >
            <AppIcon icon="chat" /> <span>AI Scientist</span>
          </button>
        </div>
      </section>

      {/* 3. Available Scientific Calculation Pathways */}
      {structure ? (
        <section aria-label="Available scientific calculations">
          <h3 className="guided-section-heading">Available Scientific Calculations</h3>
          <div className="guided-goals-grid">
            <button type="button" className="guided-goal-card" onClick={() => onSetupCalculation("conformer")} data-testid="guided-goal-conformer">
              <div className="goal-card-icon"><AppIcon icon="cube" /></div>
              <div className="goal-card-text"><strong>Conformer Search (CREST)</strong><p>Native GFN2 sampling of retained molecular geometries</p></div>
              <div className="goal-card-arrow"><AppIcon icon="arrow-right" /></div>
            </button>
            <button
              type="button"
              className="guided-goal-card"
              onClick={() => onSetupCalculation("energy")}
              data-testid="guided-goal-energy"
            >
              <div className="goal-card-icon">
                <AppIcon icon="flash" />
              </div>
              <div className="goal-card-text">
                <strong>Ground-State Energy (xTB / PySCF)</strong>
                <p>Fast GFN2-xTB tight-binding or ab initio DFT/HF single-point evaluation</p>
              </div>
              <div className="goal-card-arrow">
                <AppIcon icon="arrow-right" />
              </div>
            </button>

            <button
              type="button"
              className="guided-goal-card"
              onClick={() => onSetupCalculation("optimization")}
              data-testid="guided-goal-opt"
            >
              <div className="goal-card-icon">
                <AppIcon icon="path" />
              </div>
              <div className="goal-card-text">
                <strong>Geometry Optimization</strong>
                <p>Relax molecular geometry with a supported engine; inspect convergence and history</p>
              </div>
              <div className="goal-card-arrow">
                <AppIcon icon="arrow-right" />
              </div>
            </button>

            <button
              type="button"
              className="guided-goal-card"
              onClick={() => onSetupCalculation("tddft")}
              data-testid="guided-goal-tddft"
            >
              <div className="goal-card-icon">
                <AppIcon icon="chart" />
              </div>
              <div className="goal-card-text">
                <strong>TDDFT UV/Vis Spectra</strong>
                <p>Simulate electronic excited states and length-gauge oscillator strengths</p>
              </div>
              <div className="goal-card-arrow">
                <AppIcon icon="arrow-right" />
              </div>
            </button>

            {hasSpectra && onNavigateSpectra ? (
              <button
                type="button"
                className="guided-goal-card goal-active"
                onClick={onNavigateSpectra}
                data-testid="guided-goal-spectra"
              >
                <div className="goal-card-icon" style={{ color: "#059669" }}>
                  <AppIcon icon="series-configuration" />
                </div>
                <div className="goal-card-text">
                  <strong>Spectroscopy Workbench</strong>
                  <p>View calculated UV/Vis, IR, and Raman spectra</p>
                </div>
                <div className="goal-card-arrow">
                  <AppIcon icon="arrow-right" />
                </div>
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 4. The complete catalogue, every blocker and its reason: available on request, not part of the default view. */}
      <details
        className="guided-navigator-details"
        data-testid="guided-navigator-details"
        onToggle={(event) => setNavigatorOpen(event.currentTarget.open)}
      >
        <summary>Browse all workflows, blockers and project assets</summary>
        {navigatorOpen ? (
          <section aria-label="Project Navigator and Scientific Assets">
            <ProjectNavigator projectId={projectId} structureVersionId={structure?.version.id} />
          </section>
        ) : null}
      </details>
    </div>
  );
}
