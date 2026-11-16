"use client";

import type { ImportedQuantity, ImportedThermochemistryPayload } from "@chemdft/schemas";
import { sentence } from "@/lib/imported-results";

function Row({ label, quantity, digits = 8 }: { label: string; quantity: ImportedQuantity; digits?: number }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{quantity.value.toFixed(digits)} {quantity.unit}</td>
      <td className="imported-raw">{quantity.raw_value} {quantity.raw_unit}</td>
      <td className="imported-raw">{quantity.conversion}</td>
    </tr>
  );
}

/**
 * Read-only thermochemistry exactly as the source program reported it. There are no temperature or
 * pressure controls here: ChemDFT does not re-evaluate imported thermochemistry, and the values are not
 * produced by (or comparable to) ChemDFT's own RRHO calculation.
 */
export function ImportedThermochemistryPanel({ payload, sourceLabel }: { payload: ImportedThermochemistryPayload; sourceLabel: string }) {
  return (
    <div className="imported-thermo" data-testid="imported-thermochemistry-panel">
      <header className="imported-section-head">
        <div>
          <h2>Thermochemistry reported by {payload.reported_by}</h2>
          <p>
            T = {payload.temperature_k} K
            {payload.pressure_atm !== null ? ` · P = ${payload.pressure_atm} atm` : " · pressure not reported"}
          </p>
        </div>
        <span className="import-chip import-chip--imported">Imported · {sourceLabel}</span>
      </header>
      <p className="imported-note" data-testid="imported-thermo-note">
        Reported by {payload.reported_by}. Values are shown as printed in the output; ChemDFT did not recompute them and offers no temperature or
        pressure controls for imported thermochemistry.
      </p>
      <details className="imported-semantics">
        <summary>Source semantics</summary>
        <ul>
          <li>{sentence(payload.model)}</li>
          <li>Temperature/pressure re-evaluation: {sentence(payload.temperature_pressure_preview)}</li>
          <li>Component breakdown: {sentence(payload.component_breakdown)}</li>
        </ul>
      </details>
      <table className="imported-quantity-table" data-testid="imported-thermo-table">
        <thead>
          <tr>
            <th>Quantity</th>
            <th>Value (Hartree)</th>
            <th>Raw as parsed</th>
            <th>Conversion</th>
          </tr>
        </thead>
        <tbody>
          <Row label="Zero-point energy" quantity={payload.zero_point_energy_hartree} />
          <Row label="Enthalpy (H)" quantity={payload.enthalpy_hartree} />
          <Row label="Gibbs free energy (G)" quantity={payload.gibbs_free_energy_hartree} />
          <Row label="Entropy (S)" quantity={payload.entropy_hartree_per_k} digits={10} />
        </tbody>
      </table>
      {payload.electronic_energy_hartree !== null ? (
        <p className="imported-note">
          Electronic energy in this file: {payload.electronic_energy_hartree.toFixed(8)} Eh.
          {payload.plausibility.h_minus_e0_hartree !== null ? ` H − E₀ = ${payload.plausibility.h_minus_e0_hartree.toFixed(6)} Eh.` : ""}
          {payload.plausibility.g_minus_e0_hartree !== null ? ` G − E₀ = ${payload.plausibility.g_minus_e0_hartree.toFixed(6)} Eh.` : ""}
        </p>
      ) : null}
    </div>
  );
}
