"use client";

import type { Locale } from "@chemdft/i18n";
import { useCallback, useRef, type KeyboardEvent, type RefObject } from "react";

import { REPRESENTATION_LABELS } from "../molecular-renderer/capabilities";
import type { Representation } from "../molecular-renderer/types";
import { Formula } from "./formula";
import { PrimaryAction } from "./header-actions";
import { useStage } from "./stage";
import { HOME_STRUCTURES, type HomeStructureId } from "./structures";
import { StructureStatic } from "./structure-static";

/** Roving-focus arrow-key handling for a radiogroup whose container ref the caller owns. */
function useRadioKeys<T extends string>(group: RefObject<HTMLDivElement | null>, values: readonly T[], current: T, choose: (value: T) => void) {
  return useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      const step = keys[event.key];
      if (event.key === "Home" || event.key === "End" || step !== undefined) {
        event.preventDefault();
        const index = values.indexOf(current);
        const next = event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : (index + (step ?? 0) + values.length) % values.length;
        choose(values[next]!);
        queueMicrotask(() => group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus());
      }
    },
    [group, values, current, choose],
  );
}

/** The four reference structures as a workstation-style sample strip: alignment and a line, not cards. */
export function StructureSelector() {
  const { selectedId, select } = useStage();
  const ids = HOME_STRUCTURES.map((entry) => entry.id) as HomeStructureId[];
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = useRadioKeys(group, ids, selectedId, select);
  return (
    <div ref={group} className="sample-strip interactive" role="radiogroup" aria-label="Reference structure" onKeyDown={onKeyDown}>
      {HOME_STRUCTURES.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="radio"
          aria-checked={selectedId === entry.id}
          tabIndex={selectedId === entry.id ? 0 : -1}
          className="sample"
          data-testid={`structure-${entry.id}`}
          onClick={() => select(entry.id)}
        >
          <StructureStatic entry={entry} mini />
          <span className="sample-text">
            <span className="sample-name">{entry.name}</span>
            <span className="sample-formula">
              <Formula formula={entry.formula} />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Only the representations that are scientifically meaningful for the shown structure are offered. */
export function RepresentationSelector() {
  const { entry, representation, setRepresentation, ready, handle, paused, togglePaused, reducedMotion } = useStage();
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = useRadioKeys<Representation>(group, entry.representations as Representation[], representation, setRepresentation);
  if (!ready) return null; // without the 3D scene (no WebGL, data saving, still loading) there is nothing to switch
  return (
    <div key={entry.id} className="viewport-toolbar interactive">
      <div ref={group} role="radiogroup" aria-label="Representation" className="segmented-line" onKeyDown={onKeyDown}>
        {entry.representations.map((value) => (
          <button key={value} type="button" role="radio" aria-checked={representation === value} tabIndex={representation === value ? 0 : -1} onClick={() => setRepresentation(value)}
            title={value === "space-fill" ? (entry.kind === "crystal" ? "Shannon effective ionic radii: Cr³⁺ CN 6 = 0.615 Å; O²⁻ CN 4 = 1.38 Å. Shannon, Acta Cryst. A32 (1976)." : "van der Waals radii from ChemDFT’s central element table; Bondi (1964) and commonly used values.") : undefined}>
            {REPRESENTATION_LABELS[value]}
          </button>
        ))}
      </div>
      <div className="view-actions" aria-label="View utilities">
        <button type="button" className="text-button" onClick={() => handle.current?.resetView(!reducedMotion)}>
          Reset view
        </button>
        {reducedMotion ? null : (
          <button type="button" className="text-button" onClick={togglePaused}>
            {paused ? "Resume rotation" : "Pause rotation"}
          </button>
        )}
      </div>
    </div>
  );
}

export function Hero({ locale }: { locale: Locale }) {
  const { entry, processing } = useStage();
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy interactive-text">
        <h1 id="hero-title">Computational chemistry, without the old workflow.</h1>
        <p className="hero-lede">
          Run DFT with real scientific engines, and keep every result tied to its method, inputs and artifacts. An AI scientist plans and explains the work, but it cannot write a result.
        </p>
        <div className="hero-actions interactive">
          <PrimaryAction locale={locale} className="bp6-button bp6-intent-primary bp6-large" testId="hero-primary" />
          <a className="bp6-button bp6-large" href="#how-it-works">
            <span>See how it works</span>
          </a>
        </div>
      </div>

      <RepresentationSelector />

      <p key={entry.id} className="figure-caption interactive-text" data-testid="figure-caption" data-structure={entry.id} data-context={processing ? "stored-run" : "reference"}>
        <span className="figure-label">Fig. 1</span>
        <strong>{entry.kindLabel}</strong>
        <span className="caption-source">
          {entry.sourceHref ? (
            <a href={entry.sourceHref} rel="noreferrer">
              {entry.sourceLine}
            </a>
          ) : (
            entry.sourceLine
          )}
        </span>
        <span className="caption-facts">{entry.facts}</span>
        <span className="caption-note">{entry.note}</span>
      </p>

      <StructureSelector />
      <p className="sr-only" aria-live="polite">
        Showing {entry.name}, {entry.formula}. {entry.kindLabel}.
      </p>
    </section>
  );
}
