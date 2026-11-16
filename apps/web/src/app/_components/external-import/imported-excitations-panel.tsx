"use client";

import { useState } from "react";
import type { ImportedExcitationsPayload, ImportedExcitedState } from "@chemdft/schemas";
import { sentence } from "@/lib/imported-results";

const SPIN_COLOR: Record<string, string> = {
  singlet: "#2563eb",
  doublet: "#0f766e",
  triplet: "#c2410c",
  quartet: "#7c3aed",
  quintet: "#be123c",
  sextet: "#a16207",
  unknown: "#64748b",
};

function spinText(state: ImportedExcitedState): string {
  const label = state.spin_label === "unknown" ? "Spin not reported" : state.spin_label[0]!.toUpperCase() + state.spin_label.slice(1);
  return state.spin_multiplicity ? `${label} (2S+1 = ${state.spin_multiplicity})` : label;
}

/**
 * "Imported Electronic Excitations": reported excited states with their spin labels preserved. This is
 * deliberately not a ChemDFT UV/Vis absorption spectrum: spin-forbidden and spin-unknown states are not
 * coerced into a singlet TDDFT contract, and no broadening or intensity is synthesized.
 */
export function ImportedExcitationsPanel({
  payload,
  sourceLabel,
}: {
  payload: ImportedExcitationsPayload;
  sourceLabel: string;
}) {
  const [selected, setSelected] = useState(0);
  const states = payload.states;
  const state = states[selected];
  const withStrength = states.filter((item) => item.oscillator_strength !== null);
  const spins = Array.from(new Set(states.map((item) => item.spin_label)));

  const maxF = Math.max(1e-9, ...withStrength.map((item) => item.oscillator_strength ?? 0));
  const eMin = Math.min(...states.map((item) => item.energy_ev));
  const eMax = Math.max(...states.map((item) => item.energy_ev));
  const width = 720;
  const height = 220;
  const pad = { left: 56, right: 20, top: 16, bottom: 40 };
  const span = Math.max(eMax - eMin, 0.5);
  const x = (ev: number) => pad.left + ((ev - (eMin - span * 0.05)) / (span * 1.1)) * (width - pad.left - pad.right);
  const y = (f: number) => height - pad.bottom - (f / maxF) * (height - pad.top - pad.bottom);

  return (
    <div className="imported-excitations" data-testid="imported-excitations-panel">
      <header className="imported-section-head">
        <div>
          <h2>Imported electronic excitations</h2>
          <p>
            {payload.state_count} excited state{payload.state_count === 1 ? "" : "s"} reported by {sourceLabel} · {payload.method}
          </p>
        </div>
        <span className="import-chip import-chip--imported">Imported · {sourceLabel}</span>
      </header>

      <p className="imported-note" data-testid="imported-excitation-semantics">
        {sentence(payload.spin_semantics)} Not a ChemDFT UV/Vis calculation: states are listed in the order reported, with their own spin labels, and no
        broadening or absorption intensity is synthesized.
      </p>

      <figure className="imported-excitation-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Oscillator strength of imported excited states against excitation energy" data-testid="imported-excitation-chart">
          <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} stroke="currentColor" opacity="0.5" />
          <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} stroke="currentColor" opacity="0.5" />
          {states.map((item) => {
            const strength = item.oscillator_strength;
            const top = strength === null ? height - pad.bottom - 4 : y(strength);
            return (
              <g key={item.index} data-testid={`imported-excitation-stick-${item.index + 1}`}>
                <line
                  x1={x(item.energy_ev)}
                  x2={x(item.energy_ev)}
                  y1={height - pad.bottom}
                  y2={top}
                  stroke={SPIN_COLOR[item.spin_label] ?? SPIN_COLOR.unknown}
                  strokeWidth={selected === item.index ? 4 : 2}
                  strokeDasharray={strength === null ? "2 2" : undefined}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelected(item.index)}
                >
                  <title>{`State ${item.source_state_number}: ${item.energy_ev.toFixed(4)} eV, ${spinText(item)}, f = ${strength === null ? "not reported" : strength.toFixed(4)}`}</title>
                </line>
                <circle cx={x(item.energy_ev)} cy={height - pad.bottom} r={3} fill={SPIN_COLOR[item.spin_label] ?? SPIN_COLOR.unknown} />
              </g>
            );
          })}
          <text x={pad.left} y={height - 8} fontSize="11" fill="currentColor">{eMin.toFixed(2)} eV</text>
          <text x={width - pad.right} y={height - 8} fontSize="11" textAnchor="end" fill="currentColor">{eMax.toFixed(2)} eV</text>
          <text x={pad.left} y={pad.top - 4} fontSize="11" fill="currentColor">oscillator strength f</text>
          <text x={pad.left - 6} y={pad.top + 8} fontSize="10" textAnchor="end" fill="currentColor">{maxF.toFixed(3)}</text>
          <text x={pad.left - 6} y={height - pad.bottom} fontSize="10" textAnchor="end" fill="currentColor">0</text>
        </svg>
        <figcaption>
          Oscillator strength versus excitation energy, one marker per reported state; a dashed stick has no reported oscillator strength. Gauge: {sentence(payload.oscillator_strength_gauge)}{" "}
          {spins.map((spin) => (
            <span key={spin} className="imported-legend"><i style={{ background: SPIN_COLOR[spin] ?? SPIN_COLOR.unknown }} />{spin}</span>
          ))}
        </figcaption>
      </figure>

      <div className="imported-table-scroll">
        <table className="spectro-table" data-testid="imported-excitation-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Spin</th>
              <th>Symmetry</th>
              <th>Energy (eV)</th>
              <th>Energy (Eh)</th>
              <th>Wavelength (nm)</th>
              <th>Oscillator strength</th>
            </tr>
          </thead>
          <tbody>
            {states.map((item) => (
              <tr key={item.index} aria-selected={item.index === selected} onClick={() => setSelected(item.index)} data-testid={`imported-excitation-row-${item.index + 1}`}>
                <td>{`State ${item.source_state_number}`}{item.source_label ? ` · ${item.source_label}` : ""}</td>
                <td data-testid={`imported-excitation-spin-${item.index + 1}`}>{spinText(item)}</td>
                <td>{item.symmetry ?? "Not reported"}</td>
                <td>{item.energy_ev.toFixed(4)}</td>
                <td>{item.energy_hartree.toFixed(6)}</td>
                <td>{item.wavelength_nm.toFixed(1)}</td>
                <td>{item.oscillator_strength === null ? "Not reported" : item.oscillator_strength.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state && (state.transitions?.length ?? 0) > 0 ? (
        <section className="imported-transitions" aria-label={`Transitions of state ${state.source_state_number}`} data-testid="imported-excitation-transitions">
          <h3>Dominant orbital transitions · state {state.source_state_number}</h3>
          <ul>
            {state.transitions?.map((tr, index) => (
              <li key={index}>
                orbital {tr.from_orbital + 1}{payload.states.some((s) => s.transitions?.some((t) => t.from_spin === 1)) ? (tr.from_spin === 0 ? "α" : "β") : ""} →
                orbital {tr.to_orbital + 1}{payload.states.some((s) => s.transitions?.some((t) => t.to_spin === 1)) ? (tr.to_spin === 0 ? "α" : "β") : ""}
                {" "}· coefficient {tr.coefficient.toFixed(5)}
              </li>
            ))}
          </ul>
          {state.transitions_truncated ? <p className="imported-note">The source lists more transitions; only those cclib reported are shown.</p> : null}
        </section>
      ) : null}

      <p className="imported-note">{sentence(payload.energy_precision_note)} {sentence(payload.transition_amplitudes_note)}</p>
    </div>
  );
}
