"use client";

import type { ReactNode } from "react";

/**
 * Release 0.0.25 follow-up: ONE viewer toolbar for every page that shows a molecule. Same order and labels
 * everywhere: Reset view, Style (Ball and stick / Space filling / …), optional Distance and Angle where measuring
 * exists, then page-specific extras. Motion controls (Play/Pause, speed) are NOT part of it: they appear only
 * where motion exists, and the caption under the viewer says what the motion is.
 */
export interface ViewerStyleOption { value: string; label: string }

export interface ViewerStyleButton { value: string; label: string; testId: string; title?: string | undefined }

export interface ViewerStructureFacts {
  formula?: string | undefined;
  atoms?: number | undefined;
  charge?: number | undefined;
  multiplicity?: number | undefined;
  source?: string | undefined;
}

export function ViewerToolbar({
  testIdPrefix,
  style,
  styleOptions,
  styleButtons,
  onStyleChange,
  onReset,
  resetLabel = "Reset view",
  resetTestId,
  resetTitle,
  labels,
  structureFacts,
  nextStepCard,
  isWideTier = false,
  measure,
  measureTestIds,
  children,
}: {
  testIdPrefix: string;
  style: string;
  styleOptions: readonly ViewerStyleOption[];
  /** Keep an existing page's pressed-button style control (and its test ids) instead of the select. Same labels, same order. */
  styleButtons?: readonly ViewerStyleButton[] | undefined;
  onStyleChange: (value: string) => void;
  onReset: () => void;
  resetLabel?: string;
  resetTestId?: string | undefined;
  resetTitle?: string | undefined;
  labels?: {
    value: string;
    options: readonly { value: string; label: string }[];
    onChange: (val: string) => void;
    testId?: string | undefined;
  } | undefined;
  structureFacts?: ViewerStructureFacts | undefined;
  nextStepCard?: ReactNode | undefined;
  isWideTier?: boolean | undefined;
  measureTestIds?: { distance: string; angle: string } | undefined;
  /** Present only where measuring exists. */
  measure?: { active: "none" | "distance" | "angle"; onChange: (kind: "none" | "distance" | "angle") => void } | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="viewer-toolbar-container">
      <div className="viewer-toolbar-shared" role="toolbar" aria-label="3D viewer controls" data-testid={`${testIdPrefix}-viewer-toolbar`}>
        <div className="viewer-toolbar-controls">
          <button type="button" onClick={onReset} data-testid={resetTestId ?? `${testIdPrefix}-reset-view`} title={resetTitle}>{resetLabel}</button>
          {styleButtons ? (
            <span role="group" aria-label="Molecule style" style={{ display: "inline-flex", gap: 4 }}>
              {styleButtons.map((option) => (
                <button key={option.value} type="button" aria-pressed={style === option.value} onClick={() => onStyleChange(option.value)} data-testid={option.testId} title={option.title}>{option.label}</button>
              ))}
            </span>
          ) : (
            <label>
              <span>Style</span>
              <select value={style} onChange={(event) => onStyleChange(event.currentTarget.value)} aria-label="Molecule style" data-testid={`${testIdPrefix}-style`}>
                {styleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          )}
          {labels ? (
            <label className="viewer-labels-label">
              <span>Labels</span>
              <select
                value={labels.value}
                onChange={(event) => labels.onChange(event.currentTarget.value)}
                aria-label="Labels"
                data-testid={labels.testId ?? `${testIdPrefix}-labels-select`}
              >
                {labels.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {measure ? (
            <span role="group" aria-label="Measure">
              {(["distance", "angle"] as const).map((kind) => (
                <button key={kind} type="button" aria-pressed={measure.active === kind} onClick={() => measure.onChange(measure.active === kind ? "none" : kind)} data-testid={measureTestIds?.[kind] ?? `${testIdPrefix}-measure-${kind}`} title={kind === "distance" ? "Measure a distance between two atoms" : "Measure an angle between three atoms"}>
                  {kind === "distance" ? "Distance" : "Angle"}
                </button>
              ))}
            </span>
          ) : null}
          {children}
        </div>

        {structureFacts ? (
          <div className="viewer-structure-facts" data-testid={`${testIdPrefix}-structure-facts`} aria-label="Structure facts">
            {structureFacts.formula ? <strong className="fact-formula">{structureFacts.formula}</strong> : null}
            {structureFacts.atoms != null ? <span>{structureFacts.atoms} atoms</span> : null}
            {structureFacts.charge != null ? <span>charge {structureFacts.charge}</span> : null}
            {structureFacts.multiplicity != null ? <span>mult {structureFacts.multiplicity}</span> : null}
            {structureFacts.source ? <span className="fact-source" title={structureFacts.source}>{structureFacts.source}</span> : null}
          </div>
        ) : null}
      </div>

      {isWideTier && nextStepCard ? (
        <div className="viewer-next-step-card-wrapper" data-testid="viewer-next-step-card">
          {nextStepCard}
        </div>
      ) : null}
    </div>
  );
}

/** One line under the viewer that says what the motion (or the lack of it) is. */
export function ViewerCaption({ children, testId }: { children: ReactNode; testId?: string | undefined }) {
  return <p className="viewer-caption-shared" data-testid={testId ?? "viewer-caption"}>{children}</p>;
}

export const STATIC_VIEWER_CAPTION = "Drag to rotate · scroll to zoom";
export const spectraViewerCaption = (modeNumber: number) => `Animation of the vibration of mode ${modeNumber} (exaggerated; an illustration of the calculated mode, not a simulation)`;
