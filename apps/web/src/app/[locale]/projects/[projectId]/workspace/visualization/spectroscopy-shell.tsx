"use client";

import type { ReactNode } from "react";
import { MAX_VISUAL_EXAGGERATION, MIN_VISUAL_EXAGGERATION } from "@/lib/vibrational-mode";

/**
 * Shared presentation primitives for the Guided spectroscopy workspace.
 * UV/Vis, IR and Raman compose these so they read as three instruments in
 * one workspace. Nothing here touches scientific values.
 */

export function SpectroscopyHeader({
  title,
  subtitle,
  statusLabel = "Calculated",
  statusTone = "ok",
  summary,
  warning,
  viewToggle,
  onDetails,
  onSwitchToAdvanced,
  testIdPrefix,
}: {
  title: string;
  subtitle: string;
  statusLabel?: string | undefined;
  statusTone?: "ok" | "warn" | undefined;
  summary?: string | undefined;
  warning?: string | undefined;
  viewToggle?: ReactNode;
  onDetails?: (() => void) | undefined;
  onSwitchToAdvanced?: (() => void) | undefined;
  testIdPrefix: string;
}) {
  return (
    <header className="spectro-header">
      <div className="spectro-header-title">
        <div className="spectro-header-heading">
          <h2>{title}</h2>
          {statusLabel ? <span className={`spectro-chip spectro-chip--${statusTone}`} data-testid={`${testIdPrefix}-status-chip`}>{statusLabel}</span> : null}
          {warning ? <span className="spectro-chip spectro-chip--warn">{warning}</span> : null}
        </div>
        <p>{subtitle}{summary ? ` · ${summary}` : ""}</p>
      </div>
      <div className="spectro-header-actions">
        {viewToggle}
        {onDetails ? (
          <button type="button" className="spectro-link-btn" onClick={onDetails} data-testid={`${testIdPrefix}-details-btn`}>
            Details
          </button>
        ) : null}
        {onSwitchToAdvanced ? (
          <button
            type="button"
            className="spectro-link-btn"
            onClick={onSwitchToAdvanced}
            data-testid={`${testIdPrefix}-open-advanced-btn`}
            title="Open in Advanced Workbench (full provenance, artifacts, QA)"
          >
            Advanced
          </button>
        ) : null}
      </div>
    </header>
  );
}

export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; testId?: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="spectro-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          data-testid={option.testId}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface ModeSummaryRow {
  label: ReactNode;
  value: ReactNode;
  accent?: boolean;
}

export function NormalModeSummary({
  testIdPrefix,
  modeNumber,
  modeCount,
  rows,
  playing,
  onTogglePlay,
  onPrev,
  onNext,
  onReset,
  exaggeration,
  onExaggeration,
  speed,
  onSpeed,
}: {
  testIdPrefix: string;
  modeNumber: number;
  modeCount: number;
  rows: ModeSummaryRow[];
  playing: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReset: () => void;
  exaggeration: number;
  onExaggeration: (value: number) => void;
  speed: number;
  onSpeed: (value: number) => void;
}) {
  return (
    <aside className="spectro-summary" data-testid="selected-mode-inspector" aria-label={`Selected mode ${modeNumber}`}>
      <div className="spectro-summary-head">
        <h3>Mode {modeNumber}</h3>
        <div className="spectro-stepper">
          <button type="button" onClick={onPrev} aria-label="Previous mode" title="Previous mode" data-testid={`${testIdPrefix}-prev-mode-btn`}>
            ‹
          </button>
          <span aria-live="polite">{modeNumber} / {modeCount}</span>
          <button type="button" onClick={onNext} aria-label="Next mode" title="Next mode" data-testid={`${testIdPrefix}-next-mode-btn`}>
            ›
          </button>
        </div>
      </div>

      <dl className="spectro-facts">
        {rows.map((row, index) => (
          <div key={index}>
            <dt>{row.label}</dt>
            <dd className={row.accent ? "is-accent" : undefined}>{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="spectro-anim">
        <div className="spectro-anim-buttons">
          <button
            type="button"
            className="spectro-play"
            onClick={onTogglePlay}
            aria-label={playing ? "Pause animation" : "Play animation"}
            title={playing ? "Pause animation" : "Play animation"}
            aria-pressed={playing}
            data-testid={`${testIdPrefix}-play-pause-btn`}
          >
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button type="button" className="spectro-reset" onClick={onReset} title="Stop and reset the view">
            Reset
          </button>
        </div>
        <label title="Display-only exaggeration of the animated motion. It does not change the calculated normal modes." data-testid={`${testIdPrefix}-amplitude-control`}>
          <span>Visual exaggeration</span>
          <input
            aria-label="Visual exaggeration"
            type="range"
            min={MIN_VISUAL_EXAGGERATION}
            max={MAX_VISUAL_EXAGGERATION}
            step="0.25"
            value={exaggeration}
            onChange={(event) => onExaggeration(Number(event.currentTarget.value))}
          />
          <output>{exaggeration.toFixed(2)}×</output>
        </label>
        <label title="Animation speed multiplier">
          <span>Speed</span>
          <input
            aria-label="Animation speed"
            type="range"
            min="0.25"
            max="2.5"
            step="0.25"
            value={speed}
            onChange={(event) => onSpeed(Number(event.currentTarget.value))}
          />
          <output>{speed.toFixed(2)}×</output>
        </label>
      </div>
      <p className="spectro-hint">Select a peak or table row to change the mode.</p>
    </aside>
  );
}

/** Round-number ticks (including zero) for a linear 0..max axis. */
export function niceAxisTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let value = 0; value <= max * 1.0001; value += step) ticks.push(Number(value.toPrecision(6)));
  return ticks;
}
