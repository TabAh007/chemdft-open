import type { ThermochemistryResult } from "@chemdft/schemas";

/**
 * Thermochemistry presentation helpers.
 *
 * Authority: stored `chemdft.thermochemistry` records are authoritative. Everything here is either
 * a deterministic unit conversion (display only) or a deterministic evaluation of the stored
 * ideal-gas / rigid-rotor / harmonic-oscillator model at other conditions (labelled "preview" in
 * the UI, never persisted as a result). The evaluator mirrors `reference_rrho` in the API and
 * PySCF's `thermo()` and is parity-tested against stored records.
 */

export const THERMO_TEMPERATURE_RANGE_K = [50, 2000] as const;
export const THERMO_PRESSURE_RANGE_PA = [1e2, 1e8] as const;
export const STANDARD_ATMOSPHERE_PA = 101325;
export const DEFAULT_THERMO_TEMPERATURE_K = 298.15;

export type EnergyUnit = "Eh" | "kJ/mol" | "kcal/mol";
export const ENERGY_UNITS: readonly EnergyUnit[] = ["Eh", "kJ/mol", "kcal/mol"] as const;
export type PerKelvinUnit = "Eh/K" | "J/mol/K" | "cal/mol/K";

type Constants = ThermochemistryResult["constants"];

export interface UnitFactors {
  /** Eh -> kJ/mol */
  kjPerMol: number;
  /** Eh -> kcal/mol */
  kcalPerMol: number;
  /** Eh/K -> J/mol/K */
  jPerMolPerK: number;
  /** Eh/K -> cal/mol/K */
  calPerMolPerK: number;
}

export function unitFactors(constants: Constants): UnitFactors {
  const joulePerMol = constants.hartree_j * constants.avogadro_per_mol;
  const calorie = constants.thermochemical_calorie_j ?? 4.184;
  return {
    kjPerMol: joulePerMol / 1000,
    kcalPerMol: joulePerMol / 1000 / calorie,
    jPerMolPerK: joulePerMol,
    calPerMolPerK: joulePerMol / calorie,
  };
}

export function energyFactor(unit: EnergyUnit, factors: UnitFactors): number {
  return unit === "Eh" ? 1 : unit === "kJ/mol" ? factors.kjPerMol : factors.kcalPerMol;
}

export function perKelvinUnit(unit: EnergyUnit): PerKelvinUnit {
  return unit === "Eh" ? "Eh/K" : unit === "kJ/mol" ? "J/mol/K" : "cal/mol/K";
}

export function perKelvinFactor(unit: EnergyUnit, factors: UnitFactors): number {
  return unit === "Eh" ? 1 : unit === "kJ/mol" ? factors.jPerMolPerK : factors.calPerMolPerK;
}

/** Display formatting; a pure presentation step (no scientific meaning). */
export function formatEnergy(valueEh: number, unit: EnergyUnit, factors: UnitFactors): string {
  const value = valueEh * energyFactor(unit, factors);
  if (unit === "Eh") return Math.abs(value) < 5e-6 && value !== 0 ? value.toExponential(3) : value.toFixed(6);
  if (value !== 0 && Math.abs(value) < 0.005) return value.toExponential(2);
  return value.toFixed(Math.abs(value) >= 1000 ? 1 : Math.abs(value) >= 100 ? 2 : 3);
}

export function formatPerKelvin(valueEhK: number, unit: EnergyUnit, factors: UnitFactors): string {
  const value = valueEhK * perKelvinFactor(unit, factors);
  if (unit === "Eh") return value.toExponential(4);
  if (value !== 0 && Math.abs(value) < 0.005) return value.toExponential(2);
  return value.toFixed(3);
}

export function formatPressure(pressurePa: number): string {
  const atm = pressurePa / STANDARD_ATMOSPHERE_PA;
  const rounded = Number(atm.toPrecision(4));
  return `${rounded} atm`;
}

export function formatTemperature(temperatureK: number): string {
  return `${Number(temperatureK.toFixed(2))} K`;
}

export function conditionsLabel(temperatureK: number, pressurePa: number): string {
  return `${formatTemperature(temperatureK)} · ${formatPressure(pressurePa)}`;
}

export function validateConditions(temperatureK: number, pressurePa: number): string | null {
  if (!Number.isFinite(temperatureK) || !Number.isFinite(pressurePa)) return "Enter numeric temperature and pressure.";
  if (temperatureK <= 0) return "Temperature must be greater than 0 K.";
  if (pressurePa <= 0) return "Pressure must be greater than 0.";
  if (temperatureK < THERMO_TEMPERATURE_RANGE_K[0] || temperatureK > THERMO_TEMPERATURE_RANGE_K[1]) {
    return `Temperature must be between ${THERMO_TEMPERATURE_RANGE_K[0]} and ${THERMO_TEMPERATURE_RANGE_K[1]} K.`;
  }
  if (pressurePa < THERMO_PRESSURE_RANGE_PA[0] || pressurePa > THERMO_PRESSURE_RANGE_PA[1]) {
    return `Pressure must be between ${(THERMO_PRESSURE_RANGE_PA[0] / STANDARD_ATMOSPHERE_PA).toPrecision(2)} and ${Math.round(THERMO_PRESSURE_RANGE_PA[1] / STANDARD_ATMOSPHERE_PA)} atm.`;
  }
  return null;
}

export interface ThermoConditions {
  temperatureK: number;
  pressurePa: number;
}

export interface ConditionsDraftOutcome {
  /** Conditions the page may display/preview: the draft if it validates, otherwise the previous valid ones. */
  conditions: ThermoConditions;
  /** Validation message for the draft text, or null when the draft is valid. */
  error: string | null;
  /** Which fields of the draft are invalid (empty when valid). */
  invalidFields: Array<"temperature" | "pressure">;
}

/**
 * Temperature/pressure text is draft input. Only a draft that validates becomes the displayed
 * conditions; an invalid one leaves `lastValid` untouched so nothing is recomputed or requested
 * for it.
 */
export function resolveConditionsDraft(
  temperatureText: string,
  pressureAtmText: string,
  lastValid: ThermoConditions,
): ConditionsDraftOutcome {
  const temperatureK = Number(temperatureText);
  const pressurePa = Number(pressureAtmText) * STANDARD_ATMOSPHERE_PA;
  const error = validateConditions(temperatureK, pressurePa);
  if (!error) return { conditions: { temperatureK, pressurePa }, error: null, invalidFields: [] };
  const invalidFields: Array<"temperature" | "pressure"> = [];
  if (validateConditions(temperatureK, STANDARD_ATMOSPHERE_PA)) invalidFields.push("temperature");
  if (validateConditions(DEFAULT_THERMO_TEMPERATURE_K, pressurePa)) invalidFields.push("pressure");
  return { conditions: lastValid, error, invalidFields };
}

// ---------------------------------------------------------------------------------------------
// Deterministic RRHO evaluation of the stored model
// ---------------------------------------------------------------------------------------------

export interface RrhoModel {
  constants: Constants;
  totalMassAmu: number;
  rotationalConstantsGhz: readonly number[];
  rotorType: "LINEAR" | "NONLINEAR";
  sigma: number;
  multiplicity: number;
  frequenciesCm1: readonly number[];
  electronicEnergyHartree: number;
}

export function modelFromResult(result: ThermochemistryResult): RrhoModel {
  return {
    constants: result.constants,
    totalMassAmu: result.molecule.total_mass_amu,
    rotationalConstantsGhz: Array.from(result.molecule.rotational_constants_ghz as ArrayLike<number>),
    rotorType: result.molecule.rotor_type,
    sigma: result.symmetry.rotational_symmetry_number,
    multiplicity: result.molecule.multiplicity,
    frequenciesCm1: result.frequencies_cm1,
    electronicEnergyHartree: result.thermodynamics.electronic_energy_hartree,
  };
}

export interface Contribution {
  energy: number;
  enthalpy: number;
  entropy: number;
  gibbs: number;
  cv: number;
  cp: number;
}

export interface ModeContribution {
  index: number;
  frequencyCm1: number;
  zpe: number;
  thermalEnergy: number;
  entropy: number;
  cv: number;
  lowFrequency: boolean;
}

/** Everything the UI shows for one (T, P): from a stored record or from a preview evaluation. */
export interface ThermoView {
  origin: "authoritative" | "preview";
  temperatureK: number;
  pressurePa: number;
  e0: number;
  zpe: number;
  internalEnergy: number;
  enthalpy: number;
  gibbs: number;
  entropy: number;
  cv: number;
  cp: number;
  corrections: { internalEnergy: number; enthalpy: number; gibbs: number };
  components: { translational: Contribution; rotational: Contribution; vibrational: Contribution; electronic: Contribution };
  modes: ModeContribution[];
}

function contribution(value: ThermochemistryResult["components"]["translational"]): Contribution {
  return {
    energy: value.energy_hartree,
    enthalpy: value.enthalpy_hartree,
    entropy: value.entropy_hartree_per_k,
    gibbs: value.gibbs_hartree,
    cv: value.cv_hartree_per_k,
    cp: value.cp_hartree_per_k,
  };
}

export function viewFromResult(result: ThermochemistryResult): ThermoView {
  const t = result.thermodynamics;
  return {
    origin: "authoritative",
    temperatureK: result.conditions.temperature_k,
    pressurePa: result.conditions.pressure_pa,
    e0: t.electronic_energy_hartree,
    zpe: t.zpe_hartree,
    internalEnergy: t.internal_energy_hartree,
    enthalpy: t.enthalpy_hartree,
    gibbs: t.gibbs_free_energy_hartree,
    entropy: t.entropy_hartree_per_k,
    cv: t.cv_hartree_per_k,
    cp: t.cp_hartree_per_k,
    corrections: {
      internalEnergy: result.corrections.thermal_correction_internal_energy_hartree,
      enthalpy: result.corrections.thermal_correction_enthalpy_hartree,
      gibbs: result.corrections.thermal_correction_gibbs_hartree,
    },
    components: {
      translational: contribution(result.components.translational),
      rotational: contribution(result.components.rotational),
      vibrational: contribution(result.components.vibrational),
      electronic: contribution(result.components.electronic),
    },
    modes: result.vibrational_modes.map((mode) => ({
      index: mode.index,
      frequencyCm1: mode.frequency_cm1,
      zpe: mode.zpe_hartree,
      thermalEnergy: mode.thermal_energy_hartree,
      entropy: mode.entropy_hartree_per_k,
      cv: mode.cv_hartree_per_k,
      lowFrequency: mode.low_frequency,
    })),
  };
}

export function evaluateRrho(
  model: RrhoModel,
  temperatureK: number,
  pressurePa: number,
  lowFrequencyCm1 = 100,
): ThermoView {
  const { constants } = model;
  const kb = constants.boltzmann_j_per_k;
  const h = constants.planck_j_s;
  const eh = constants.hartree_j;
  const c = constants.speed_of_light_m_per_s;
  const amu = constants.atomic_mass_kg;
  const t = temperatureK;
  const r = kb / eh; // Eh/K

  const qTrans = ((2 * Math.PI * model.totalMassAmu * amu * kb * t) / h ** 2) ** 1.5 * (kb * t) / pressurePa;
  const sTrans = r * (2.5 + Math.log(qTrans));
  const translational: Contribution = {
    energy: 1.5 * r * t,
    enthalpy: 2.5 * r * t,
    entropy: sTrans,
    gibbs: 2.5 * r * t - t * sTrans,
    cv: 1.5 * r,
    cp: 2.5 * r,
  };

  const abc = model.rotationalConstantsGhz.map((value) => value * 1e9);
  let rotational: Contribution;
  if (model.rotorType === "LINEAR") {
    const qRot = (kb * t) / (model.sigma * h * (abc[1] ?? 1));
    const sRot = r * (1 + Math.log(qRot));
    rotational = { energy: r * t, enthalpy: r * t, entropy: sRot, gibbs: r * t - t * sRot, cv: r, cp: r };
  } else {
    const qRot =
      (((kb * t) / h) ** 1.5 * Math.sqrt(Math.PI)) /
      (model.sigma * Math.sqrt((abc[0] ?? 1) * (abc[1] ?? 1) * (abc[2] ?? 1)));
    const sRot = r * (1.5 + Math.log(qRot));
    rotational = { energy: 1.5 * r * t, enthalpy: 1.5 * r * t, entropy: sRot, gibbs: 1.5 * r * t - t * sRot, cv: 1.5 * r, cp: 1.5 * r };
  }

  const theta = model.frequenciesCm1.map((nu) => (nu * 1e2 * c * h) / kb);
  const modes: ModeContribution[] = theta.map((th, index) => {
    const x = th / t;
    const e = Math.exp(-x);
    return {
      index,
      frequencyCm1: model.frequenciesCm1[index] ?? 0,
      zpe: r * 0.5 * th,
      thermalEnergy: r * t * (x * e / (1 - e)),
      entropy: r * ((x * e) / (1 - e) - Math.log(1 - e)),
      cv: r * ((e * x ** 2) / (1 - e) ** 2),
      lowFrequency: (model.frequenciesCm1[index] ?? 0) < lowFrequencyCm1,
    };
  });
  const zpe = modes.reduce((sum, mode) => sum + mode.zpe, 0);
  const vibEnergy = modes.reduce((sum, mode) => sum + mode.zpe + mode.thermalEnergy, 0);
  const sVib = modes.reduce((sum, mode) => sum + mode.entropy, 0);
  const cvVib = modes.reduce((sum, mode) => sum + mode.cv, 0);
  const vibrational: Contribution = {
    energy: vibEnergy,
    enthalpy: vibEnergy,
    entropy: sVib,
    gibbs: vibEnergy - t * sVib,
    cv: cvVib,
    cp: cvVib,
  };
  const sElec = r * Math.log(model.multiplicity);
  const electronic: Contribution = {
    energy: model.electronicEnergyHartree,
    enthalpy: model.electronicEnergyHartree,
    entropy: sElec,
    gibbs: model.electronicEnergyHartree - t * sElec,
    cv: 0,
    cp: 0,
  };
  const parts = [translational, rotational, vibrational, electronic];
  const sum = (pick: (part: Contribution) => number) => parts.reduce((total, part) => total + pick(part), 0);
  const e0 = model.electronicEnergyHartree;
  const internalEnergy = sum((part) => part.energy);
  const enthalpy = sum((part) => part.enthalpy);
  const gibbs = sum((part) => part.gibbs);
  return {
    origin: "preview",
    temperatureK,
    pressurePa,
    e0,
    zpe,
    internalEnergy,
    enthalpy,
    gibbs,
    entropy: sum((part) => part.entropy),
    cv: sum((part) => part.cv),
    cp: sum((part) => part.cp),
    corrections: { internalEnergy: internalEnergy - e0, enthalpy: enthalpy - e0, gibbs: gibbs - e0 },
    components: { translational, rotational, vibrational, electronic },
    modes,
  };
}

export type TrendQuantity = "gibbs-correction" | "enthalpy-correction" | "entropy" | "cp" | "cv";

export const TREND_QUANTITIES: ReadonlyArray<{ id: TrendQuantity; label: string; short: string }> = [
  { id: "gibbs-correction", label: "G − E₀ (thermal correction to G)", short: "G − E₀" },
  { id: "enthalpy-correction", label: "H − E₀ (thermal correction to H)", short: "H − E₀" },
  { id: "entropy", label: "Entropy S", short: "S" },
  { id: "cp", label: "Heat capacity Cp", short: "Cp" },
  { id: "cv", label: "Heat capacity Cv", short: "Cv" },
];

export function trendValue(view: ThermoView, quantity: TrendQuantity): number {
  switch (quantity) {
    case "gibbs-correction":
      return view.corrections.gibbs;
    case "enthalpy-correction":
      return view.corrections.enthalpy;
    case "entropy":
      return view.entropy;
    case "cp":
      return view.cp;
    case "cv":
      return view.cv;
  }
}

export function isPerKelvin(quantity: TrendQuantity): boolean {
  return quantity === "entropy" || quantity === "cp" || quantity === "cv";
}

/** Sampled deterministic evaluations (not independent calculations). */
export function sampleTrend(
  model: RrhoModel,
  pressurePa: number,
  quantity: TrendQuantity,
  tMin = 100,
  tMax = 1000,
  points = 46,
): Array<{ x: number; y: number }> {
  return Array.from({ length: points }, (_, i) => {
    const temperature = tMin + ((tMax - tMin) * i) / (points - 1);
    return { x: temperature, y: trendValue(evaluateRrho(model, temperature, pressurePa), quantity) };
  });
}

// ---------------------------------------------------------------------------------------------
// Record grouping
// ---------------------------------------------------------------------------------------------

export interface ThermoRecord {
  calculationId: string;
  resultId: string;
  payload: ThermochemistryResult;
  createdAt?: string | undefined;
}

export function sameConditions(a: { temperatureK: number; pressurePa: number }, b: { temperatureK: number; pressurePa: number }): boolean {
  return Math.abs(a.temperatureK - b.temperatureK) < 1e-9 && Math.abs(a.pressurePa - b.pressurePa) < 1e-6;
}

/** Records computed from the same frequency result form one family sharing geometry, E0 and modes. */
export function familyOf(records: readonly ThermoRecord[], frequencyResultId: string): ThermoRecord[] {
  return records
    .filter((record) => record.payload.frequency_result_id === frequencyResultId)
    .sort((a, b) => a.payload.conditions.temperature_k - b.payload.conditions.temperature_k);
}

export function preferredRecord(records: readonly ThermoRecord[]): ThermoRecord | null {
  if (records.length === 0) return null;
  const standard = records.find(
    (record) =>
      sameConditions(
        { temperatureK: record.payload.conditions.temperature_k, pressurePa: record.payload.conditions.pressure_pa },
        { temperatureK: DEFAULT_THERMO_TEMPERATURE_K, pressurePa: STANDARD_ATMOSPHERE_PA },
      ),
  );
  return standard ?? records[0] ?? null;
}

export function isThermochemistryPayload(payload: unknown): payload is ThermochemistryResult {
  return Boolean(payload) && (payload as { payload_schema?: string }).payload_schema === "chemdft.thermochemistry";
}
