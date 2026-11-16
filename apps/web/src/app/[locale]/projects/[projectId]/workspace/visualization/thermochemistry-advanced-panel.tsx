"use client";

import type { CalculationResult, ThermochemistryResult } from "@chemdft/schemas";
import { conditionsLabel } from "@/lib/thermochemistry";
import { describeScientificState } from "@/lib/scientific-state";

/**
 * Advanced Workbench view of one authoritative `chemdft.thermochemistry` record: every canonical
 * stored quantity, input reference, provenance field, diagnostic and constant, unmodified.
 */
export function ThermochemistryAdvancedPanel({ result }: { result: CalculationResult }) {
  const payload = result.payload as ThermochemistryResult;
  // Current standing comes only from the server's read-time effective state; stored fields are history.
  const state = describeScientificState(result);
  const t = payload.thermodynamics;
  const c = payload.conditions;
  const components = payload.components;
  const rows = (entries: Array<[string, string | number | boolean | null | undefined]>) => (
    <dl className="thermo-adv-dl">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value === null || value === undefined ? "—" : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
  const compRow = (name: string, part: ThermochemistryResult["components"]["translational"]) => (
    <tr key={name}>
      <th scope="row">{name}</th>
      <td>{part.energy_hartree}</td>
      <td>{part.enthalpy_hartree}</td>
      <td>{part.entropy_hartree_per_k}</td>
      <td>{part.gibbs_hartree}</td>
      <td>{part.cv_hartree_per_k}</td>
      <td>{part.cp_hartree_per_k}</td>
    </tr>
  );

  return (
    <div className="thermo-advanced" data-testid="thermochemistry-advanced-panel" data-currently-authoritative={state.currentlyAuthoritative ? "true" : "false"}>
      <header className="thermo-adv-header">
        <h2>Thermochemistry result</h2>
        <p data-testid="thermo-adv-standing">
          {payload.method.toUpperCase()} / {payload.basis} · {conditionsLabel(c.temperature_k, c.pressure_pa)} · {c.thermo_model} ·{" "}
          {state.currentlyAuthoritative
            ? `Authoritative · ${state.validation.label} · ${state.verification.label}`
            : state.effectiveKnown ? "Historical record · not currently authoritative" : "Current authority not established"}
        </p>
        {state.currentlyAuthoritative ? null : (
          <p role="note" data-testid="thermo-adv-historical">
            {state.headline}. {state.notes[0]} The values below are recorded historical evidence and must not be used as current results.
            {state.stored ? ` Recorded at publication: ${state.stored.authority} / ${state.stored.validation} / ${state.stored.verification}.` : ""}
          </p>
        )}
      </header>

      <section>
        <h3>Conditions</h3>
        {rows([
          ["Temperature (K)", c.temperature_k],
          ["Pressure (Pa)", c.pressure_pa],
          ["Pressure (atm)", c.pressure_atm],
          ["Gas model", c.gas_model],
          ["Thermo model", c.thermo_model],
          ["Standard state", c.standard_state],
          ["Reference pressure (Pa)", c.reference_pressure_pa],
          ["Assumptions", c.assumptions.join(" · ")],
        ])}
      </section>

      <section>
        <h3>Canonical quantities (Eh, Eh/K)</h3>
        {rows([
          ["Electronic energy E0 (Eh)", t.electronic_energy_hartree],
          ["Zero-point energy (Eh)", t.zpe_hartree],
          ["E0 + ZPE (Eh)", t.e0_plus_zpe_hartree],
          ["Internal energy U (Eh)", t.internal_energy_hartree],
          ["Enthalpy H (Eh)", t.enthalpy_hartree],
          ["Gibbs free energy G (Eh)", t.gibbs_free_energy_hartree],
          ["Entropy S (Eh/K)", t.entropy_hartree_per_k],
          ["Cv (Eh/K)", t.cv_hartree_per_k],
          ["Cp (Eh/K)", t.cp_hartree_per_k],
          ["Thermal correction to U (Eh)", payload.corrections.thermal_correction_internal_energy_hartree],
          ["Thermal correction to H (Eh)", payload.corrections.thermal_correction_enthalpy_hartree],
          ["Thermal correction to G (Eh)", payload.corrections.thermal_correction_gibbs_hartree],
          ["Correction reference", `${payload.corrections.reference} (includes ZPE: ${payload.corrections.includes_zpe})`],
        ])}
      </section>

      <section>
        <h3>Contribution breakdown (PySCF terms)</h3>
        <table className="spectro-table thermo-adv-table">
          <thead>
            <tr>
              <th>Term</th>
              <th>U (Eh)</th>
              <th>H (Eh)</th>
              <th>S (Eh/K)</th>
              <th>G (Eh)</th>
              <th>Cv (Eh/K)</th>
              <th>Cp (Eh/K)</th>
            </tr>
          </thead>
          <tbody>
            {compRow("Translational", components.translational)}
            {compRow("Rotational", components.rotational)}
            {compRow("Vibrational", components.vibrational)}
            {compRow("Electronic", components.electronic)}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Harmonic modes (exact decomposition of the vibrational terms)</h3>
        <table className="spectro-table thermo-adv-table">
          <thead>
            <tr>
              <th>#</th>
              <th>ν̃ (cm⁻¹)</th>
              <th>θ_vib (K)</th>
              <th>ZPE (Eh)</th>
              <th>Thermal E (Eh)</th>
              <th>S (Eh/K)</th>
              <th>Cv (Eh/K)</th>
              <th>Low freq.</th>
            </tr>
          </thead>
          <tbody>
            {payload.vibrational_modes.map((mode) => (
              <tr key={mode.index}>
                <td>{mode.index + 1}</td>
                <td>{mode.frequency_cm1}</td>
                <td>{mode.vibrational_temperature_k}</td>
                <td>{mode.zpe_hartree}</td>
                <td>{mode.thermal_energy_hartree}</td>
                <td>{mode.entropy_hartree_per_k}</td>
                <td>{mode.cv_hartree_per_k}</td>
                <td>{mode.low_frequency ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Molecule and symmetry</h3>
        {rows([
          ["Charge / multiplicity", `${payload.molecule.charge} / ${payload.molecule.multiplicity}`],
          ["Atoms", payload.molecule.atom_identities.join(" ")],
          ["Rotor type", payload.molecule.rotor_type],
          ["Rotational constants (GHz)", Array.from(payload.molecule.rotational_constants_ghz as ArrayLike<number>).join(", ")],
          ["Total mass (amu)", payload.molecule.total_mass_amu],
          ["Mass convention", payload.molecule.mass_convention],
          ["Rotational symmetry number σ", payload.symmetry.rotational_symmetry_number],
          ["σ source", payload.symmetry.source],
          ["σ method", payload.symmetry.method],
          ["σ algorithm / version", `${payload.symmetry.algorithm} ${payload.symmetry.algorithm_version}`],
          ["σ tolerance (Å)", payload.symmetry.tolerance_angstrom],
          ["σ stability tolerances (Å)", (payload.symmetry.stability_tolerances_angstrom ?? []).join(", ")],
          ["PySCF point-group σ (cross-check)", payload.symmetry.pyscf_point_group_sigma],
          ["Cross-check agrees", payload.symmetry.pyscf_cross_check_agrees],
          ["Override reason", payload.symmetry.override_reason],
        ])}
      </section>

      <section>
        <h3>Diagnostics</h3>
        {rows([
          ["Imaginary-mode policy", `${payload.diagnostics.imaginary_mode_policy} (count ${payload.diagnostics.imaginary_mode_count})`],
          ["Lowest real frequency (cm⁻¹)", payload.diagnostics.lowest_real_frequency_cm1],
          ["Low-frequency policy", payload.diagnostics.low_frequency_policy],
          ["Low-frequency threshold (cm⁻¹)", payload.diagnostics.low_frequency_threshold_cm1],
          ["Low-frequency modes (index)", (payload.diagnostics.low_frequency_mode_indices ?? []).join(", ") || "none"],
          ["Low-frequency entropy (Eh/K)", payload.diagnostics.low_frequency_entropy_hartree_per_k],
          ["Low-frequency −T·S (Eh)", payload.diagnostics.low_frequency_minus_ts_hartree],
          ["Stationarity source", payload.diagnostics.stationarity.source],
          ["Gradient RMS (Eh/bohr)", payload.diagnostics.stationarity.gradient_rms_hartree_per_bohr],
          ["Gradient norm (Eh/bohr)", payload.diagnostics.stationarity.gradient_norm_hartree_per_bohr],
          ["Criterion RMS (Eh/bohr)", payload.diagnostics.stationarity.criterion_rms_hartree_per_bohr],
          ["Trajectory step", payload.diagnostics.stationarity.trajectory_step_index],
          ["Warnings", (payload.diagnostics.warnings ?? []).join(" | ") || "none"],
        ])}
      </section>

      <section>
        <h3>Input references and provenance</h3>
        {rows([
          ["Optimized StructureVersion", payload.input_structure_version_id],
          ["Structure", payload.input_structure_id],
          ["Structure artifact SHA-256", payload.input_structure_hash],
          ["Geometry hash", payload.geometry_hash],
          ["Optimization calculation", payload.optimization_calculation_id],
          ["Optimization result", payload.optimization_result_id],
          ["Optimization result SHA-256", payload.optimization_result_sha256],
          ["Frequency calculation", payload.frequency_calculation_id],
          ["Frequency result", payload.frequency_result_id],
          ["Frequency result SHA-256", payload.frequency_result_sha256],
          ["E0 artifact", payload.energy_artifact.artifact_id],
          ["E0 artifact SHA-256", payload.energy_artifact_sha256],
          ["E0 source field", payload.energy_source_field],
          ["Calculation input SHA-256", payload.calculation_input_hash],
          ["Result SHA-256", payload.result_sha256],
        ])}
      </section>

      <section>
        <h3>Engine, constants and conventions</h3>
        {rows([
          ["Engine", `${payload.engine} ${payload.engine_version}`],
          ["Thermo API", payload.thermo_api],
          ["Constants source", payload.constants.source],
          ["k_B (J/K)", payload.constants.boltzmann_j_per_k],
          ["h (J·s)", payload.constants.planck_j_s],
          ["N_A (1/mol)", payload.constants.avogadro_per_mol],
          ["E_h (J)", payload.constants.hartree_j],
          ["amu (kg)", payload.constants.atomic_mass_kg],
          ["a₀ (m)", payload.constants.bohr_m],
          ["c (m/s)", payload.constants.speed_of_light_m_per_s],
          ["Thermochemical calorie (J)", payload.constants.thermochemical_calorie_j],
          ["Energy / entropy units", `${payload.energy_unit} / ${payload.entropy_unit}`],
          ["Producer", payload.producer],
          ["Producer attestation", result.producer_attestation_id],
          ["Schema / payload version", `${payload.payload_schema} ${payload.payload_schema_version}`],
          ["Adapter / parser / validator", `${payload.adapter_version} / ${payload.parser_version} / ${payload.validator_version}`],
          ["Raw artifacts", result.raw_artifacts.length],
        ])}
      </section>
    </div>
  );
}
