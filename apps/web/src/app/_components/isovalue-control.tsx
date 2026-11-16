"use client";
import { useEffect, useState } from "react";
import { formatThreshold, parsePositiveThreshold, sliderThreshold } from "@/lib/workstation-ux";
export function IsovalueControl({ density, value, onChange, bounds, disabled, id }: {
  density: boolean; value: number; onChange: (value: number) => void;
  bounds: { minimum: number; maximum: number; defaultValue: number }; disabled: boolean; id: string;
}) {
  const [draft, setDraft] = useState(formatThreshold(value));
  useEffect(() => { queueMicrotask(() => setDraft(formatThreshold(value))); }, [value]);
  const invalid = parsePositiveThreshold(draft) === null;
  return <div className="electronic-isovalue-controls">
    <label htmlFor={id}>{density ? "Electron-density isovalue ρ(r)" : "± Orbital amplitude"} <span>{density ? "e/a₀³" : "a₀⁻³ᐟ²"}</span></label>
    <div className="isovalue-inputs">
      <input aria-label={density ? "Electron-density isovalue slider" : "Orbital-amplitude isovalue slider"} type="range"
        min={Math.log10(bounds.minimum)} max={Math.log10(bounds.maximum)} step="0.01"
        value={Math.log10(Math.min(bounds.maximum, Math.max(bounds.minimum, value)))} disabled={disabled}
        onChange={event => onChange(sliderThreshold(Number(event.currentTarget.value)))} />
      <input id={id} aria-label={density ? "Electron-density isovalue" : "Orbital-amplitude isovalue"} type="text" inputMode="decimal"
        value={draft} disabled={disabled} aria-invalid={invalid} onChange={event => {
          setDraft(event.currentTarget.value); const next = parsePositiveThreshold(event.currentTarget.value); if (next !== null) onChange(next);
        }} onBlur={() => { if (!invalid) setDraft(formatThreshold(value)); }} />
      <button type="button" disabled={disabled} onClick={() => { setDraft(formatThreshold(bounds.defaultValue)); onChange(bounds.defaultValue); }}>Reset isovalue</button>
    </div>
    {density ? <small>Log scale · 0.0001 · 0.001 · 0.01 · 0.1</small> : null}
    {invalid ? <small role="status">Enter a positive, finite threshold.</small> : null}
  </div>;
}
