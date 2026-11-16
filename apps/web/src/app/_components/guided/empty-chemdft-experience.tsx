"use client";

import { useState } from "react";
import { ActionButton, AppIcon } from "@chemdft/ui";
import type { ImportStage } from "@/lib/guided-workflow-machine";

export interface EmptyChemDFTExperienceProps {
  onOpenWaterExample: () => void;
  onOpenChromiumExample: () => void;
  onCreateProjectAndImport: (
    name: string,
    kind: "structure" | "paper",
    file?: File,
    onStageChange?: (stage: ImportStage) => void
  ) => Promise<void>;
  onCreateEmptyProject: (name: string, slug: string) => Promise<void>;
  /**
   * False for real (signed-in) users. The two demos below are frozen acceptance projects owned by the
   * legacy development workspace; a real account cannot open them. Sealed, copyable example projects
   * will replace them; until then the options are shown as unavailable instead of failing.
   */
  examplesAvailable?: boolean;
}

export type InputOption = "structure" | "paper" | "experimental" | "example" | "empty";

export function EmptyChemDFTExperience({
  onOpenWaterExample,
  onOpenChromiumExample,
  onCreateProjectAndImport,
  onCreateEmptyProject,
  examplesAvailable = true,
}: EmptyChemDFTExperienceProps) {
  const [selectedOption, setSelectedOption] = useState<InputOption | null>(null);
  const [projectName, setProjectName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importStage, setImportStage] = useState<ImportStage | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stageLabels: Record<ImportStage, string> = {
    uploading: "Uploading file…",
    reading: "Reading structure coordinates…",
    detecting: "Validating atomic coordinates…",
    building: "Building project workspace…",
    ready: "Ready!",
  };

  async function handleStart() {
    if (!selectedOption) return;
    setError(null);

    if (selectedOption === "example") {
      if (examplesAvailable) onOpenWaterExample();
      return;
    }

    if (selectedOption === "empty") {
      const name = projectName.trim() || "New Research Project";
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      setSubmitting(true);
      try {
        await onCreateEmptyProject(name, slug);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create project");
        setSubmitting(false);
      }
      return;
    }

    if ((selectedOption === "structure" || selectedOption === "paper") && selectedFile) {
      const defaultName = selectedFile.name.replace(/\.[^/.]+$/, "");
      const finalName = projectName.trim() || defaultName;

      setSubmitting(true);
      setImportStage("uploading");

      try {
        await onCreateProjectAndImport(
          finalName,
          selectedOption,
          selectedFile,
          (stage: ImportStage) => setImportStage(stage)
        );
        setImportStage("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to import file");
        setImportStage(null);
        setSubmitting(false);
      }
    }
  }

  return (
    <div className="empty-chemdft-experience" data-testid="empty-chemdft-experience">
      {/* Clean Scientific Hero */}
      <div className="empty-hero-section">
        <span className="guided-pill-badge">Welcome to ChemDFT</span>
        <h1 className="empty-hero-title">Build, analyze and understand molecules</h1>
        <p className="empty-hero-subtitle">
          Computational chemistry and AI guidance for molecular structures, quantum calculations, and scientific literature.
        </p>
      </div>

      {error ? (
        <div className="api-state error" role="alert">
          <AppIcon icon="warning-sign" />
          <span>{error}</span>
        </div>
      ) : null}

      {importStage ? (
        <div className="import-progress-card" data-testid="import-progress-card" role="status">
          <div className="progress-spinner-wrap">
            <span className="guided-spinner" aria-hidden="true" />
          </div>
          <h3>{stageLabels[importStage]}</h3>
          <p>ChemDFT is processing your input through deterministic scientific parsers.</p>
          <div className="stages-indicator">
            {(["uploading", "reading", "detecting", "building", "ready"] as ImportStage[]).map((st) => (
              <span
                key={st}
                className={`stage-dot ${st === importStage ? "current" : ["uploading", "reading", "detecting", "building", "ready"].indexOf(st) < ["uploading", "reading", "detecting", "building", "ready"].indexOf(importStage) ? "done" : ""}`}
                title={st}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="empty-chooser-container">
          <div className="empty-chooser-header">
            <h2>What do you have?</h2>
            <p>Select your starting material to establish a scientific workspace.</p>
          </div>

          <div className="input-options-grid" role="radiogroup" aria-label="Input options">
            <button
              type="button"
              role="radio"
              aria-checked={selectedOption === "structure"}
              className={`input-option-btn ${selectedOption === "structure" ? "selected" : ""}`}
              onClick={() => setSelectedOption("structure")}
              data-testid="option-molecular-structure"
            >
              <div className="option-icon-box">
                <AppIcon icon="cube" />
              </div>
              <div className="option-content">
                <strong>Molecular structure</strong>
                <span>Inspect 3D coordinates, run quantum chemistry</span>
                <small className="option-format-hint">XYZ · SDF · MOL · CIF</small>
              </div>
              <div className="radio-circle" />
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={selectedOption === "paper"}
              className={`input-option-btn ${selectedOption === "paper" ? "selected" : ""}`}
              onClick={() => setSelectedOption("paper")}
              data-testid="option-scientific-paper"
            >
              <div className="option-icon-box">
                <AppIcon icon="document" />
              </div>
              <div className="option-content">
                <strong>Scientific paper</strong>
                <span>Extract candidate structures & experimental datasets</span>
                <small className="option-format-hint">PDF articles</small>
              </div>
              <div className="radio-circle" />
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={selectedOption === "experimental"}
              className={`input-option-btn ${selectedOption === "experimental" ? "selected" : ""}`}
              onClick={() => setSelectedOption("experimental")}
              data-testid="option-experimental-data"
            >
              <div className="option-icon-box">
                <AppIcon icon="timeline-events" />
              </div>
              <div className="option-content">
                <strong>Experimental data</strong>
                <span>Digitize XRD peaks, DLS curves, and spectra</span>
                <small className="option-format-hint">CSV · XY · Figures</small>
              </div>
              <div className="radio-circle" />
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={selectedOption === "example"}
              className={`input-option-btn ${selectedOption === "example" ? "selected" : ""}`}
              onClick={() => setSelectedOption("example")}
              data-testid="option-start-example"
            >
              <div className="option-icon-box">
                <AppIcon icon="projects" />
              </div>
              <div className="option-content">
                <strong>Start from example</strong>
                <span>Pre-calculated Water (H₂O) or Chromium paper</span>
                <small className="option-format-hint">Instant exploration</small>
              </div>
              <div className="radio-circle" />
            </button>
          </div>

          {/* Focused upload experience for structure */}
          {selectedOption === "structure" ? (
            <div className="focused-upload-panel">
              <div className="focused-upload-header">
                <h3>Upload molecular structure</h3>
                <p>Supported: XYZ · SDF · MOL · CIF</p>
              </div>
              <label htmlFor="file-input" className="file-input-dropzone" data-testid="file-dropzone">
                <AppIcon icon="upload" />
                <span className="dropzone-text">
                  {selectedFile ? (
                    <strong>{selectedFile.name}</strong>
                  ) : (
                    <>
                      <strong>Choose a structure file</strong> or drag and drop here
                    </>
                  )}
                </span>
                <input
                  id="file-input"
                  type="file"
                  accept=".xyz,.mol,.sdf,.cif"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setSelectedFile(file);
                      if (!projectName) setProjectName(file.name.replace(/\.[^/.]+$/, ""));
                    }
                  }}
                />
              </label>
            </div>
          ) : null}

          {/* Focused upload experience for paper */}
          {selectedOption === "paper" ? (
            <div className="focused-upload-panel">
              <div className="focused-upload-header">
                <h3>Upload scientific paper</h3>
                <p>ChemDFT extracts reported structures, XRD diffractograms, and DLS spectra</p>
              </div>
              <label htmlFor="paper-input" className="file-input-dropzone">
                <AppIcon icon="document" />
                <span className="dropzone-text">
                  {selectedFile ? (
                    <strong>{selectedFile.name}</strong>
                  ) : (
                    <>
                      <strong>Choose a PDF document</strong> or drag and drop here
                    </>
                  )}
                </span>
                <input
                  id="paper-input"
                  type="file"
                  accept=".pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setSelectedFile(file);
                      if (!projectName) setProjectName(file.name.replace(/\.[^/.]+$/, ""));
                    }
                  }}
                />
              </label>
            </div>
          ) : null}

          {/* Experimental data info panel */}
          {selectedOption === "experimental" ? (
            <div className="focused-upload-panel">
              <div className="focused-upload-header">
                <h3>Experimental Data Digitization</h3>
                <p>
                  ChemDFT supports digitizing XRD diffractograms and DLS particle-size curves directly from literature figures or raw CSV tables.
                </p>
              </div>
              {examplesAvailable ? (
                <div className="experimental-options-row">
                  <button
                    type="button"
                    className="example-choice-btn"
                    onClick={onOpenChromiumExample}
                    data-testid="choose-chromium-example"
                  >
                    <AppIcon icon="document" />
                    <div>
                      <strong>Explore Chromium Paper Acceptance Demo</strong>
                      <span>Includes pre-extracted candidate and digitized XRD/DLS experimental curves</span>
                    </div>
                    <AppIcon icon="arrow-right" />
                  </button>
                </div>
              ) : (
                <p className="example-unavailable" data-testid="examples-unavailable">The Chromium demo is not available yet. Sealed example projects you can copy will arrive in a later release.</p>
              )}
            </div>
          ) : null}

          {/* Example pickers */}
          {selectedOption === "example" ? (
            <div className="example-pickers-container">
              {!examplesAvailable ? (
                <p className="example-unavailable" data-testid="examples-unavailable">Example projects are not available yet. Sealed examples you can copy to your own projects will arrive in a later release.</p>
              ) : (
                <>
              <button
                type="button"
                className="example-choice-btn"
                onClick={onOpenWaterExample}
                data-testid="choose-water-example"
              >
                <div className="example-icon-box">
                  <AppIcon icon="cube" />
                </div>
                <div className="example-details">
                  <strong>Water (H₂O) Molecule Demo</strong>
                  <span>3 atoms · Hartree-Fock / STO-3G · Orbitals & Electron Density</span>
                </div>
                <AppIcon icon="arrow-right" />
              </button>

              <button
                type="button"
                className="example-choice-btn"
                onClick={onOpenChromiumExample}
                data-testid="choose-chromium-example"
              >
                <div className="example-icon-box">
                  <AppIcon icon="document" />
                </div>
                <div className="example-details">
                  <strong>Chromium Paper Acceptance Demo</strong>
                  <span>Reconstructed candidate · Digitized XRD & DLS datasets</span>
                </div>
                <AppIcon icon="arrow-right" />
              </button>
                </>
              )}
            </div>
          ) : null}

          {/* Project name input and continue button */}
          {selectedOption && selectedOption !== "example" && selectedOption !== "experimental" ? (
            <div className="option-confirm-row">
              <input
                className="bp6-input project-name-input"
                placeholder={selectedOption === "empty" ? "Project name (e.g. My Screening Study)" : "Project name (optional)"}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                aria-label="Project name"
              />
              <ActionButton
                intent="primary"
                icon="arrow-right"
                text={submitting ? "Processing…" : "Continue"}
                disabled={submitting || ((selectedOption === "structure" || selectedOption === "paper") && !selectedFile)}
                onClick={() => void handleStart()}
                data-testid="guided-continue-btn"
              />
            </div>
          ) : null}

          {/* Secondary Option: Start Empty */}
          <div className="empty-secondary-strip">
            <button
              type="button"
              role="radio"
              aria-checked={selectedOption === "empty"}
              className={`empty-secondary-link ${selectedOption === "empty" ? "selected" : ""}`}
              onClick={() => setSelectedOption("empty")}
              data-testid="option-start-empty"
            >
              <span>Or start with an empty project boundary</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
