"use client";

import { AppIcon } from "@chemdft/ui";
import { spectraNavBadge, type SpectraKind } from "@/lib/imported-results";

export type GuidedNavView =
  | "home"
  | "structure"
  | "draft"
  | "result"
  | "energy-result"
  | "setup"
  | "spectra"
  | "thermochemistry"
  | "imported"
  | "experimental";

export interface GuidedNavProps {
  currentView: GuidedNavView;
  activeResultTab?: "MO" | "Density" | "ESP";
  hasStructure: boolean;
  hasElectronicResult: boolean;
  hasConformerResult?: boolean;
  activeConformer?: boolean;
  onNavigateConformer?: () => void;
  hasOptimizationResult?: boolean;
  activeOptimization?: boolean;
  onNavigateOptimization?: () => void;
  hasSpectra?: boolean;
  /** Which calculated spectrum types exist; the badge names them (never a method that did not produce a result). */
  spectraKinds?: readonly SpectraKind[] | undefined;
  hasImportedSpectra?: boolean;
  hasAnalysis?: boolean;
  hasThermochemistry?: boolean;
  hasImported?: boolean;
  /** At least one measured experimental spectrum exists in the project. */
  hasExperimental?: boolean;
  onNavigateHome: () => void;
  onNavigateStructure: () => void;
  onNavigateCalculations: () => void;
  onNavigateResult: (tab?: "MO" | "Density" | "ESP") => void;
  onNavigateSpectra?: () => void;
  onNavigateThermochemistry?: () => void;
  onNavigateImported?: () => void;
  onNavigateExperimental?: () => void;
  onImportCalculation?: () => void;
  onImportSpectrum?: () => void;
  onSwitchToAdvanced: () => void;
  onOpenAiScientist?: () => void;
}

export function GuidedNav({
  currentView,
  hasStructure,
  hasElectronicResult,
  hasConformerResult = false,
  activeConformer = false,
  onNavigateConformer,
  hasOptimizationResult = false,
  activeOptimization = false,
  onNavigateOptimization,
  hasSpectra = false,
  spectraKinds,
  hasImportedSpectra = false,
  hasAnalysis = false,
  hasThermochemistry = false,
  hasImported = false,
  hasExperimental = false,
  onNavigateHome,
  onNavigateStructure,
  onNavigateCalculations,
  onNavigateResult,
  onNavigateSpectra,
  onNavigateThermochemistry,
  onNavigateImported,
  onNavigateExperimental,
  onImportCalculation,
  onImportSpectrum,
}: GuidedNavProps) {
  const hasAnyResult =
    hasElectronicResult ||
    hasOptimizationResult ||
    hasConformerResult ||
    hasSpectra ||
    hasImportedSpectra ||
    hasAnalysis ||
    hasThermochemistry ||
    hasImported ||
    hasExperimental;

  // The imported-results page is Files & Data (Project Resources); it must not also light up Results as the current page.
  const isResultActive =
    currentView === "result" ||
    currentView === "energy-result" ||
    currentView === "spectra" ||
    currentView === "thermochemistry" ||
    currentView === "experimental";

  function handleNavigateResults() {
    if (!hasAnyResult) return;
    if (hasElectronicResult) {
      onNavigateResult("MO");
    } else if (hasOptimizationResult && onNavigateOptimization) {
      onNavigateOptimization();
    } else if (hasConformerResult && onNavigateConformer) {
      onNavigateConformer();
    } else if (hasSpectra && onNavigateSpectra) {
      onNavigateSpectra();
    } else if ((hasAnalysis || hasThermochemistry) && onNavigateThermochemistry) {
      onNavigateThermochemistry();
    } else if (hasImported && onNavigateImported) {
      onNavigateImported();
    } else if (hasExperimental && onNavigateExperimental) {
      onNavigateExperimental();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    const nav = e.currentTarget;
    const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>("button:not([disabled])")).filter((button) => button.getClientRects().length > 0 && !button.closest("[hidden], [inert], [aria-hidden=\"true\"]"));
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex === -1) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % buttons.length;
      buttons[nextIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      buttons[prevIndex]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      buttons[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
  }

  return (
    <aside
      className="guided-left-nav"
      aria-label="Guided scientific navigation"
      data-testid="guided-left-nav"
      onKeyDown={handleKeyDown}
    >
      {/* 1. WORKSPACE SECTION */}
      <div className="guided-nav-section" role="region" aria-label="Workspace navigation">
        <div className="guided-nav-section-title">
          <span>Guided workflow</span>
        </div>

        <nav className="guided-nav-menu" aria-label="Primary workflow">
          {/* Overview */}
          <button
            type="button"
            className={`guided-nav-item ${currentView === "home" ? "active" : ""}`}
            onClick={onNavigateHome}
            aria-current={currentView === "home" ? "page" : undefined}
            aria-label="Guided home"
            data-testid="guided-nav-overview"
            title="Guided home: start a calculation or continue where you left off"
          >
            <AppIcon icon="home" />
            <span className="guided-nav-label">Guided home</span>
          </button>

          {/* Structures */}
          <button
            type="button"
            className={`guided-nav-item ${currentView === "structure" ? "active" : ""} ${
              !hasStructure ? "unavailable" : ""
            }`}
            onClick={onNavigateStructure}
            disabled={!hasStructure}
            aria-current={currentView === "structure" ? "page" : undefined}
            aria-label="Structures"
            data-testid="guided-nav-structure"
            title={hasStructure ? "Structures: Molecular geometry & 3D viewer" : "No molecular structure loaded"}
          >
            <AppIcon icon="cube" />
            <span className="guided-nav-label">Structures</span>
          </button>

          {/* Calculations */}
          <button
            type="button"
            className={`guided-nav-item ${currentView === "setup" ? "active" : ""} ${
              !hasStructure ? "unavailable" : ""
            }`}
            onClick={onNavigateCalculations}
            disabled={!hasStructure}
            aria-current={currentView === "setup" ? "page" : undefined}
            aria-label="Calculation setup"
            data-testid="guided-nav-calculations"
            title={
              hasStructure
                ? "Calculation setup: structure, configuration and review"
                : "Select a structure first"
            }
          >
            <AppIcon icon="function" />
            <span className="guided-nav-label">Calculation setup</span>
          </button>

          {/* Results Group */}
          <div className="guided-nav-group">
            <button
              type="button"
              className={`guided-nav-item ${isResultActive ? "active" : ""} ${
                !hasAnyResult ? "unavailable" : ""
              }`}
              onClick={handleNavigateResults}
              disabled={!hasAnyResult}
              aria-current={isResultActive ? "page" : undefined}
              aria-label="Results"
              data-testid="guided-nav-results"
              title={
                hasAnyResult
                  ? "Results: Energy, optimized geometry, spectra, & thermochemistry"
                  : "No calculation results published yet"
              }
            >
              <AppIcon icon="predictive-analysis" />
              <span className="guided-nav-label">Results</span>
            </button>

            {/* Results Subitems (Visible when results exist) */}
            {hasAnyResult ? (
              <div className="guided-nav-subitems-wrap" role="group" aria-label="Available results">
                {hasElectronicResult ? (
                  <button
                    type="button"
                    className={`guided-nav-item guided-nav-subitem ${
                      !activeOptimization && !activeConformer && (currentView === "result" || currentView === "energy-result") ? "active" : ""
                    }`}
                    onClick={() => onNavigateResult("MO")}
                    aria-current={
                      !activeOptimization && !activeConformer && (currentView === "result" || currentView === "energy-result") ? "page" : undefined
                    }
                    aria-label="Energy & Orbitals"
                    data-testid="guided-nav-electronic"
                    title="Published total energy and available molecular orbital results"
                  >
                    <AppIcon icon="flash" />
                    <span className="guided-nav-label">Energy &amp; Orbitals</span>
                  </button>
                ) : null}

                {hasConformerResult ? <button type="button" className={`guided-nav-item guided-nav-subitem ${activeConformer && currentView === "result" ? "active" : ""}`}
                  onClick={onNavigateConformer} aria-current={activeConformer && currentView === "result" ? "page" : undefined}
                  aria-label="Conformer ensembles" data-testid="guided-nav-conformers">
                  <AppIcon icon="cube" /><span className="guided-nav-label">Conformer ensembles</span>
                </button> : null}
                {hasOptimizationResult ? <button type="button"
                  className={`guided-nav-item guided-nav-subitem ${activeOptimization && currentView === "result" ? "active" : ""}`}
                  onClick={onNavigateOptimization} aria-current={activeOptimization && currentView === "result" ? "page" : undefined}
                  aria-label="Geometry optimization results" data-testid="guided-nav-optimization"
                  title="Published optimized geometries, total energies and recorded trajectories">
                  <AppIcon icon="path" /><span className="guided-nav-label">Geometry optimization</span>
                </button> : null}
                {hasSpectra || hasImportedSpectra ? (
                  <button
                    type="button"
                    className={`guided-nav-item guided-nav-subitem ${
                      currentView === "spectra" ? "active" : ""
                    }`}
                    onClick={() => onNavigateSpectra?.()}
                    aria-current={currentView === "spectra" ? "page" : undefined}
                    aria-label="Spectra"
                    data-testid="guided-nav-spectra"
                    title="Calculated and imported UV/Vis, IR, and Raman spectra"
                  >
                    <AppIcon icon="timeline-events" />
                    <span className="guided-nav-label">Spectra</span>
                    {spectraNavBadge({ hasSpectra, hasImportedSpectra, kinds: spectraKinds }) ? (
                      <span className="guided-nav-badge">
                        {spectraNavBadge({ hasSpectra, hasImportedSpectra, kinds: spectraKinds })}
                      </span>
                    ) : null}
                  </button>
                ) : null}

                {hasAnalysis || hasThermochemistry ? (
                  <button
                    type="button"
                    className={`guided-nav-item guided-nav-subitem ${
                      currentView === "thermochemistry" ? "active" : ""
                    }`}
                    onClick={() => onNavigateThermochemistry?.()}
                    aria-current={currentView === "thermochemistry" ? "page" : undefined}
                    aria-label="Thermochemistry"
                    data-testid="guided-nav-analysis"
                    title="Thermochemical enthalpy, entropy, and free energies"
                  >
                    <AppIcon icon="flows" />
                    <span className="guided-nav-label">Thermochemistry</span>
                  </button>
                ) : null}

                {hasImported ? (
                  <button
                    type="button"
                    className="guided-nav-item guided-nav-subitem"
                    onClick={() => onNavigateImported?.()}
                    aria-label="External Imports"
                    data-testid="guided-nav-imported-results"
                    title="Imported calculations from Gaussian or ORCA"
                  >
                    <AppIcon icon="import" />
                    <span className="guided-nav-label">External Imports</span>
                    <span className="guided-nav-badge">External</span>
                  </button>
                ) : null}

                {hasExperimental ? (
                  <button
                    type="button"
                    className={`guided-nav-item guided-nav-subitem ${
                      currentView === "experimental" ? "active" : ""
                    }`}
                    onClick={() => onNavigateExperimental?.()}
                    aria-current={currentView === "experimental" ? "page" : undefined}
                    aria-label="Experimental Data"
                    data-testid="guided-nav-experimental"
                    title="Measured experimental spectra"
                  >
                    <AppIcon icon="timeline-line-chart" />
                    <span className="guided-nav-label">Experimental Data</span>
                    <span className="guided-nav-badge">Measured</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </nav>
      </div>

      <div className="guided-nav-divider" />

      {/* 2. PROJECT RESOURCES SECTION */}
      <div className="guided-nav-section" role="region" aria-label="Project resources">
        <div className="guided-nav-section-title">
          <span>Project Resources</span>
        </div>

        <nav className="guided-nav-menu" aria-label="Project assets">
          <div className="guided-nav-group">
            <button
              type="button"
              className={`guided-nav-item ${currentView === "imported" ? "active" : ""}`}
              onClick={onNavigateImported}
              aria-current={currentView === "imported" ? "page" : undefined}
              aria-label="Files & Data"
              data-testid="guided-nav-imported"
              title="Files & Data: Project files, imported calculation packages, and experimental datasets"
            >
              <AppIcon icon="folder-close" />
              <span className="guided-nav-label">Files &amp; Data</span>
            </button>

            {/* Contextual subactions available when in Files & Data */}
            {currentView === "imported" ? (
              <div className="guided-nav-subitems-wrap" role="group" aria-label="Import actions">
                {onImportCalculation ? (
                  <button
                    type="button"
                    className="guided-nav-item guided-nav-subitem"
                    onClick={onImportCalculation}
                    aria-label="Import calculation"
                    data-testid="guided-nav-import"
                    title="Import a finished Gaussian or ORCA calculation output"
                  >
                    <AppIcon icon="import" />
                    <span className="guided-nav-label">Import calculation…</span>
                  </button>
                ) : null}

                {onImportSpectrum ? (
                  <button
                    type="button"
                    className="guided-nav-item guided-nav-subitem"
                    onClick={onImportSpectrum}
                    aria-label="Import spectrum"
                    data-testid="guided-nav-import-spectrum"
                    title="Import a measured IR, Raman or UV/Vis experimental spectrum"
                  >
                    <AppIcon icon="upload" />
                    <span className="guided-nav-label">Import spectrum…</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </nav>
      </div>

    </aside>
  );
}
