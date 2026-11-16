"use client";

import type { ReactNode } from "react";
import { AppIcon, type IconName } from "@chemdft/ui";

/**
 * Guided Section Container
 */
export function GuidedSection({
  title,
  subtitle,
  children,
  action,
  className = "",
  id,
  testId,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  id?: string;
  testId?: string;
}) {
  return (
    <section className={`guided-section ${className}`} id={id} data-testid={testId}>
      {title ? (
        <div className="guided-section-header">
          <div>
            <h2 className="guided-section-title">{title}</h2>
            {subtitle ? <p className="guided-section-subtitle">{subtitle}</p> : null}
          </div>
          {action ? <div className="guided-section-action">{action}</div> : null}
        </div>
      ) : null}
      <div className="guided-section-body">{children}</div>
    </section>
  );
}

/**
 * Standard Guided Action Button
 */
export function GuidedAction({
  label,
  icon,
  onClick,
  intent = "secondary",
  disabled = false,
  testId,
  badge,
  title,
  type = "button",
  size = "md",
}: {
  label: string;
  icon?: IconName;
  onClick?: () => void;
  intent?: "primary" | "secondary" | "subtle" | "danger";
  disabled?: boolean;
  testId?: string;
  badge?: string;
  title?: string;
  type?: "button" | "submit";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      type={type}
      className={`guided-action-btn intent-${intent} size-${size}`}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      title={title}
    >
      {icon ? <AppIcon icon={icon} /> : null}
      <span className="guided-action-label">{label}</span>
      {badge ? <span className="guided-action-badge">{badge}</span> : null}
    </button>
  );
}

/**
 * Restrained Scientific Status Badge
 */
export function GuidedStatus({
  children,
  intent = "neutral",
  size = "sm",
}: {
  children: ReactNode;
  intent?: "neutral" | "success" | "warning" | "danger" | "accent";
  size?: "sm" | "md";
}) {
  return (
    <span className={`guided-status-tag status-${intent} size-${size}`}>
      <span className="guided-status-dot" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

/**
 * Orientation / Journey Step Path
 */
export type JourneyStep = {
  id: string;
  label: string;
  status: "complete" | "available" | "unavailable" | "active";
  hint?: string;
};

export function GuidedJourney({
  steps,
  onStepClick,
}: {
  steps: JourneyStep[];
  onStepClick?: (stepId: string) => void;
}) {
  return (
    <nav className="guided-journey-bar" aria-label="Scientific workflow progress">
      <ol className="guided-journey-list">
        {steps.map((step, idx) => {
          const isComplete = step.status === "complete";
          const isActive = step.status === "active";
          return (
            <li
              key={step.id}
              className={`guided-journey-item status-${step.status}`}
            >
              <button
                type="button"
                className="guided-journey-btn"
                onClick={() => onStepClick?.(step.id)}
                disabled={step.status === "unavailable"}
                aria-current={isActive ? "step" : undefined}
                title={step.hint ?? step.label}
              >
                <span className="step-indicator">
                  {isComplete ? (
                    <AppIcon icon="small-tick" />
                  ) : (
                    <span className="step-num">{idx + 1}</span>
                  )}
                </span>
                <span className="step-text">
                  <strong className="step-label">{step.label}</strong>
                  {step.hint ? <small className="step-hint">{step.hint}</small> : null}
                </span>
              </button>
              {idx < steps.length - 1 ? (
                <span className="journey-connector" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Result Tab Navigation Switch
 */
export function GuidedResultTab({
  activeTab,
  onChange,
  disabledReason,
}: {
  activeTab: "MO" | "Density" | "ESP";
  onChange: (tab: "MO" | "Density" | "ESP") => void;
  /** Release 0.0.25 follow-up: why the surface-based tabs (Density, ESP) cannot be used, when they cannot. */
  disabledReason?: string | undefined;
}) {
  return (
    <div className="guided-result-tabs" role="tablist" aria-label="Electronic field views">
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "MO"}
        className={`guided-result-tab-btn ${activeTab === "MO" ? "active" : ""}`}
        onClick={() => onChange("MO")}
        data-testid="tab-molecular-orbitals"
      >
        <AppIcon icon="predictive-analysis" />
        <span>Molecular Orbitals</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "Density"}
        className={`guided-result-tab-btn ${activeTab === "Density" ? "active" : ""}`}
        onClick={() => onChange("Density")} disabled={Boolean(disabledReason)} title={disabledReason}
        data-testid="tab-electron-density"
      >
        <AppIcon icon="cube" />
        <span>Electron Density</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "ESP"}
        className={`guided-result-tab-btn ${activeTab === "ESP" ? "active" : ""}`}
        onClick={() => onChange("ESP")} disabled={Boolean(disabledReason)} title={disabledReason}
        data-testid="tab-electrostatic-potential"
      >
        <AppIcon icon="heatmap" />
        <span>Electrostatic Potential</span>
      </button>
    </div>
  );
}

/**
 * Current Scientific Context Card
 */
export function GuidedContextCard({
  title,
  subtitle,
  tags,
  action,
  testId,
}: {
  title: string;
  subtitle?: string;
  tags?: Array<{ label: string; intent?: "neutral" | "success" | "warning" | "accent" }>;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="guided-context-card" data-testid={testId}>
      <div className="context-card-info">
        <span className="context-eyebrow">Current Context</span>
        <h2 className="context-title">{title}</h2>
        {subtitle ? <p className="context-subtitle">{subtitle}</p> : null}
        {tags && tags.length > 0 ? (
          <div className="context-tags">
            {tags.map((t, idx) => (
              <GuidedStatus key={idx} intent={t.intent ?? "neutral"}>
                {t.label}
              </GuidedStatus>
            ))}
          </div>
        ) : null}
      </div>
      {action ? <div className="context-card-action">{action}</div> : null}
    </div>
  );
}

/**
 * Primary Guided Recommendation Banner
 */
export function GuidedRecommendation({
  title,
  description,
  badge = "Recommended next step",
  contextBadge,
  actionLabel,
  onAction,
  testId = "recommended-next-step",
  actionTestId = "guided-primary-action-btn",
}: {
  title: string;
  description: string;
  badge?: string | undefined;
  contextBadge?: string | undefined;
  actionLabel: string;
  onAction: () => void;
  testId?: string | undefined;
  actionTestId?: string | undefined;
}) {
  return (
    <section className="guided-recommendation" data-testid={testId}>
      <div className="rec-header">
        <div className="rec-pill-row">
          <span className="rec-badge">{badge}</span>
          {contextBadge ? <span className="rec-context-badge">{contextBadge}</span> : null}
        </div>
        <h3 className="rec-title">{title}</h3>
        <p className="rec-description">{description}</p>
      </div>
      <div className="rec-cta">
        <GuidedAction
          intent="primary"
          label={actionLabel}
          icon="arrow-right"
          size="lg"
          onClick={onAction}
          testId={actionTestId}
        />
      </div>
    </section>
  );
}

/**
 * Precision Scientific Metric Tile
 */
export function GuidedMetric({
  label,
  value,
  unit,
  sublabel,
  highlight = false,
  note,
}: {
  label: string;
  value: string;
  unit?: string | undefined;
  sublabel?: string | undefined;
  highlight?: boolean | undefined;
  note?: string | undefined;
}) {
  return (
    <div className={`guided-metric-card ${highlight ? "highlight" : ""}`}>
      <span className="metric-label">{label}</span>
      <div className="metric-value-wrap">
        <strong className="metric-value">{value}</strong>
        {unit ? <span className="metric-unit">{unit}</span> : null}
      </div>
      {sublabel ? <span className="metric-sublabel">{sublabel}</span> : null}
      {note ? <small className="metric-note">{note}</small> : null}
    </div>
  );
}

/**
 * Progressive Disclosure for Technical Details
 */
export function GuidedDisclosure({
  title = "Technical details & provenance",
  children,
  defaultOpen = false,
  testId,
}: {
  title?: string | undefined;
  children: ReactNode;
  defaultOpen?: boolean | undefined;
  testId?: string | undefined;
}) {
  return (
    <details className="guided-disclosure" open={defaultOpen} data-testid={testId}>
      <summary className="guided-disclosure-summary">
        <span className="summary-title">{title}</span>
        <span className="disclosure-chevron">
          <AppIcon icon="chevron-right" />
        </span>
      </summary>
      <div className="guided-disclosure-content">{children}</div>
    </details>
  );
}
