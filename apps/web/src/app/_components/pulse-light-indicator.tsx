"use client";

import React, { useEffect, useState } from "react";
import { mapPulseLightState, type PulseLightInput, type PulseLightState } from "@/lib/pulse-light";
import { ActionButton } from "@chemdft/ui";

export interface PulseLightIndicatorProps extends PulseLightInput {
  onCancel?: (() => void | Promise<void>) | undefined;
  cancelDisabled?: boolean | undefined;
  className?: string | undefined;
  showDetail?: boolean | undefined;
}

/**
 * Pulse light indicator: small pulse light plus a WORD (never colour alone).
 * Built strictly from persisted and reported signals (lease, execution, heartbeat).
 * Never fakes progress or decorative animations.
 */
export function PulseLightIndicator({
  onCancel,
  cancelDisabled = false,
  className = "",
  showDetail = true,
  ...input
}: PulseLightIndicatorProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const terminal = ["SUCCEEDED", "FAILED", "CANCELED"].includes((input.jobState ?? "").toUpperCase());
    if (terminal) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setNowMs(Date.now());
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [input.jobState]);

  const state: PulseLightState = mapPulseLightState({
    ...input,
    nowMs,
  });

  return (
    <div
      className={`cdf-pulse-light-container ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={state.ariaLabel}
      data-testid="pulse-light-indicator"
      data-stage={state.stage}
      data-color={state.color}
      data-pulsing={state.pulsing}
    >
      <span
        className={`cdf-pulse-light-dot ${state.pulsing ? "is-pulsing" : ""}`}
        data-color={state.color}
        aria-hidden="true"
        data-testid="pulse-light-dot"
      />
      <span className="cdf-pulse-light-word" data-testid="pulse-light-word">{state.word}</span>
      {showDetail ? (
        <span className="cdf-pulse-light-detail" data-testid="pulse-light-detail">
          {state.detail}
        </span>
      ) : null}
      {state.canCancel && onCancel ? (
        <ActionButton
          small
          minimal
          icon="disable"
          text="Cancel"
          className="cdf-pulse-light-cancel-btn"
          disabled={cancelDisabled}
          onClick={() => void onCancel()}
          data-testid="pulse-light-cancel"
        />
      ) : null}
    </div>
  );
}
