import { describe, expect, it } from "vitest";
import type { ThermochemistryResult } from "@chemdft/schemas";
import reference from "./fixtures/thermochemistry-water-b3lyp-def2svp-298k.json";
import pyscfReference from "./fixtures/thermochemistry-water-pyscf-reference-conditions.json";
import {
  ENERGY_UNITS,
  STANDARD_ATMOSPHERE_PA,
  conditionsLabel,
  energyFactor,
  evaluateRrho,
  familyOf,
  formatEnergy,
  formatPerKelvin,
  formatPressure,
  isThermochemistryPayload,
  modelFromResult,
  perKelvinUnit,
  preferredRecord,
  resolveConditionsDraft,
  sampleTrend,
  sameConditions,
  trendValue,
  unitFactors,
  validateConditions,
  viewFromResult,
  type ThermoRecord,
} from "../src/lib/thermochemistry";

const payload = reference as unknown as ThermochemistryResult;
const factors = unitFactors(payload.constants);

describe("thermochemistry unit conversion (display only)", () => {
  it("derives kJ/mol and kcal/mol factors from the recorded constants", () => {
    expect(factors.kjPerMol).toBeCloseTo(2625.4996, 3);
    expect(factors.kcalPerMol).toBeCloseTo(627.5095, 3);
    expect(factors.jPerMolPerK).toBeCloseTo(2625499.6, 0);
    expect(factors.calPerMolPerK).toBeCloseTo(627509.5, 0);
    expect(energyFactor("Eh", factors)).toBe(1);
    expect(ENERGY_UNITS).toEqual(["Eh", "kJ/mol", "kcal/mol"]);
    expect(perKelvinUnit("Eh")).toBe("Eh/K");
    expect(perKelvinUnit("kJ/mol")).toBe("J/mol/K");
    expect(perKelvinUnit("kcal/mol")).toBe("cal/mol/K");
  });

  it("formats stored Water quantities consistently across units", () => {
    const view = viewFromResult(payload);
    expect(formatEnergy(view.e0, "Eh", factors)).toBe(view.e0.toFixed(6));
    expect(Number(formatEnergy(view.zpe, "kcal/mol", factors))).toBeCloseTo(13.319, 2);
    expect(Number(formatEnergy(view.corrections.internalEnergy, "kcal/mol", factors))).toBeCloseTo(15.098, 2);
    expect(Number(formatEnergy(view.corrections.enthalpy, "kcal/mol", factors))).toBeCloseTo(15.691, 2);
    expect(Number(formatEnergy(view.corrections.gibbs, "kcal/mol", factors))).toBeCloseTo(2.235, 2);
    expect(Number(formatPerKelvin(view.entropy, "kJ/mol", factors))).toBeCloseTo(188.83, 2);
    expect(Number(formatPerKelvin(view.cv, "kJ/mol", factors))).toBeCloseTo(25.135, 2);
    expect(Number(formatPerKelvin(view.cp, "kJ/mol", factors))).toBeCloseTo(33.449, 2);
    // kJ and kcal agree through the thermochemical calorie
    expect(Number(formatEnergy(view.zpe, "kJ/mol", factors)) / 4.184).toBeCloseTo(Number(formatEnergy(view.zpe, "kcal/mol", factors)), 2);
    // tiny non-zero terms are never rounded to a misleading 0.000
    expect(formatEnergy(1e-9, "kJ/mol", factors)).toMatch(/e-/);
    expect(formatEnergy(0, "kJ/mol", factors)).toBe("0.000");
  });
});

describe("authoritative record view", () => {
  it("exposes corrections relative to E0 and totals that include E0", () => {
    const view = viewFromResult(payload);
    expect(view.origin).toBe("authoritative");
    expect(view.corrections.internalEnergy).toBeCloseTo(view.internalEnergy - view.e0, 12);
    expect(view.corrections.enthalpy).toBeCloseTo(view.enthalpy - view.e0, 12);
    expect(view.corrections.gibbs).toBeCloseTo(view.gibbs - view.e0, 12);
    expect(view.e0).toBeCloseTo(-76.358315351, 6);
    expect(view.modes).toHaveLength(3);
    expect(view.modes.some((mode) => mode.lowFrequency)).toBe(false);
  });

  it("component decomposition sums to the totals", () => {
    const view = viewFromResult(payload);
    const parts = Object.values(view.components);
    expect(parts.reduce((s, p) => s + p.energy, 0)).toBeCloseTo(view.internalEnergy, 9);
    expect(parts.reduce((s, p) => s + p.enthalpy, 0)).toBeCloseTo(view.enthalpy, 9);
    expect(parts.reduce((s, p) => s + p.gibbs, 0)).toBeCloseTo(view.gibbs, 9);
    expect(parts.reduce((s, p) => s + p.entropy, 0)).toBeCloseTo(view.entropy, 14);
    expect(parts.reduce((s, p) => s + p.cv, 0)).toBeCloseTo(view.cv, 14);
    expect(view.modes.reduce((s, m) => s + m.entropy, 0)).toBeCloseTo(view.components.vibrational.entropy, 14);
  });
});

describe("deterministic RRHO evaluation of the stored model (preview)", () => {
  const model = modelFromResult(payload);

  it("reproduces the authoritative record at its own conditions", () => {
    const stored = viewFromResult(payload);
    const evaluated = evaluateRrho(model, payload.conditions.temperature_k, payload.conditions.pressure_pa);
    expect(evaluated.origin).toBe("preview");
    for (const key of ["internalEnergy", "enthalpy", "gibbs"] as const) {
      expect(evaluated[key]).toBeCloseTo(stored[key], 9);
    }
    for (const key of ["zpe", "entropy", "cv", "cp"] as const) {
      expect(evaluated[key]).toBeCloseTo(stored[key], 13);
    }
    expect(evaluated.components.translational.entropy).toBeCloseTo(stored.components.translational.entropy, 13);
    expect(evaluated.components.rotational.entropy).toBeCloseTo(stored.components.rotational.entropy, 13);
  });

  it("matches PySCF thermo() at other temperatures and pressures (no SCF/Hessian needed)", () => {
    for (const ref of pyscfReference) {
      const evaluated = evaluateRrho(model, ref.temperature_k, ref.pressure_pa);
      expect(evaluated.internalEnergy).toBeCloseTo(ref.internal_energy, 9);
      expect(evaluated.enthalpy).toBeCloseTo(ref.enthalpy, 9);
      expect(evaluated.gibbs).toBeCloseTo(ref.gibbs, 9);
      expect(evaluated.entropy).toBeCloseTo(ref.entropy, 12);
      expect(evaluated.cv).toBeCloseTo(ref.cv, 12);
      expect(evaluated.cp).toBeCloseTo(ref.cp, 12);
      expect(evaluated.zpe).toBeCloseTo(ref.zpe, 13);
      expect(evaluated.components.translational.entropy).toBeCloseTo(ref.s_trans, 12);
      expect(evaluated.components.rotational.entropy).toBeCloseTo(ref.s_rot, 12);
      expect(evaluated.components.vibrational.entropy).toBeCloseTo(ref.s_vib, 14);
    }
  });

  it("keeps E0 and ZPE temperature/pressure independent; pressure moves entropy and G only", () => {
    const base = evaluateRrho(model, 298.15, STANDARD_ATMOSPHERE_PA);
    const hot = evaluateRrho(model, 500, STANDARD_ATMOSPHERE_PA);
    const compressed = evaluateRrho(model, 298.15, 10 * STANDARD_ATMOSPHERE_PA);
    expect(hot.e0).toBe(base.e0);
    expect(hot.zpe).toBeCloseTo(base.zpe, 15);
    expect(hot.enthalpy).toBeGreaterThan(base.enthalpy);
    expect(hot.entropy).toBeGreaterThan(base.entropy);
    expect(compressed.enthalpy).toBeCloseTo(base.enthalpy, 12);
    expect(compressed.cp).toBeCloseTo(base.cp, 15);
    expect(compressed.entropy).toBeLessThan(base.entropy);
    const k = payload.constants.boltzmann_j_per_k / payload.constants.hartree_j;
    expect(compressed.entropy - base.entropy).toBeCloseTo(-k * Math.log(10), 12);
  });

  it("identities hold at arbitrary conditions", () => {
    const view = evaluateRrho(model, 421.3, 0.37 * STANDARD_ATMOSPHERE_PA);
    const k = payload.constants.boltzmann_j_per_k / payload.constants.hartree_j;
    expect(view.enthalpy - view.internalEnergy).toBeCloseTo(k * 421.3, 12);
    expect(view.gibbs).toBeCloseTo(view.enthalpy - 421.3 * view.entropy, 12);
    expect(view.cp - view.cv).toBeCloseTo(k, 14);
  });

  it("samples trends deterministically from the stored model", () => {
    const series = sampleTrend(model, STANDARD_ATMOSPHERE_PA, "gibbs-correction");
    expect(series[0]?.x).toBe(100);
    expect(series.at(-1)?.x).toBe(1000);
    // G - E0 decreases with temperature (-TS dominates)
    expect(series.at(-1)!.y).toBeLessThan(series[0]!.y);
    const at298 = evaluateRrho(model, 298.15, STANDARD_ATMOSPHERE_PA);
    expect(trendValue(at298, "gibbs-correction")).toBeCloseTo(payload.corrections.thermal_correction_gibbs_hartree, 9);
    expect(trendValue(at298, "cp")).toBeCloseTo(payload.thermodynamics.cp_hartree_per_k, 13);
  });

  it("flags low-frequency modes below 100 cm^-1 without altering the pure RRHO values", () => {
    const soft = { ...model, frequenciesCm1: [...model.frequenciesCm1, 40] };
    const view = evaluateRrho(soft, 298.15, STANDARD_ATMOSPHERE_PA, 100);
    expect(view.modes.filter((mode) => mode.lowFrequency).map((mode) => mode.frequencyCm1)).toEqual([40]);
    const base = evaluateRrho(model, 298.15, STANDARD_ATMOSPHERE_PA);
    expect(view.entropy).toBeGreaterThan(base.entropy);
    expect(view.entropy - base.entropy).toBeCloseTo(view.modes[3]!.entropy, 14);
  });
});

describe("conditions validation and labels", () => {
  it("rejects nonsensical temperature and pressure", () => {
    expect(validateConditions(298.15, STANDARD_ATMOSPHERE_PA)).toBeNull();
    expect(validateConditions(0, STANDARD_ATMOSPHERE_PA)).toMatch(/greater than 0 K/);
    expect(validateConditions(-10, STANDARD_ATMOSPHERE_PA)).toMatch(/greater than 0 K/);
    expect(validateConditions(298.15, 0)).toMatch(/greater than 0/);
    expect(validateConditions(298.15, -1)).toMatch(/greater than 0/);
    expect(validateConditions(10, STANDARD_ATMOSPHERE_PA)).toMatch(/between/);
    expect(validateConditions(5000, STANDARD_ATMOSPHERE_PA)).toMatch(/between/);
    expect(validateConditions(298.15, 1e12)).toMatch(/between/);
    expect(validateConditions(Number.NaN, 1)).toMatch(/numeric/);
  });

  it("labels conditions without implying solution or liquid models", () => {
    expect(conditionsLabel(298.15, STANDARD_ATMOSPHERE_PA)).toBe("298.15 K · 1 atm");
    expect(formatPressure(2 * STANDARD_ATMOSPHERE_PA)).toBe("2 atm");
    expect(conditionsLabel(350, 2 * STANDARD_ATMOSPHERE_PA)).toBe("350 K · 2 atm");
  });
});

describe("record grouping", () => {
  const make = (id: string, t: number, p: number, frequencyResultId = payload.frequency_result_id): ThermoRecord => ({
    calculationId: `calc-${id}`,
    resultId: id,
    payload: {
      ...payload,
      frequency_result_id: frequencyResultId,
      conditions: { ...payload.conditions, temperature_k: t, pressure_pa: p, pressure_atm: p / STANDARD_ATMOSPHERE_PA },
    },
  });

  it("groups by frequency result and prefers 298.15 K / 1 atm", () => {
    const records = [make("a", 350, STANDARD_ATMOSPHERE_PA), make("b", 298.15, STANDARD_ATMOSPHERE_PA), make("c", 200, STANDARD_ATMOSPHERE_PA, "other")];
    expect(familyOf(records, payload.frequency_result_id).map((r) => r.resultId)).toEqual(["b", "a"]);
    expect(preferredRecord(records)?.resultId).toBe("b");
    expect(preferredRecord(records.filter((r) => r.resultId === "a"))?.resultId).toBe("a");
    expect(preferredRecord([])).toBeNull();
    expect(sameConditions({ temperatureK: 298.15, pressurePa: 101325 }, { temperatureK: 298.15 + 1e-12, pressurePa: 101325 })).toBe(true);
    expect(sameConditions({ temperatureK: 298.15, pressurePa: 101325 }, { temperatureK: 299, pressurePa: 101325 })).toBe(false);
  });

  it("recognises thermochemistry payloads only", () => {
    expect(isThermochemistryPayload(payload)).toBe(true);
    expect(isThermochemistryPayload({ payload_schema: "chemdft.vibrational-analysis" })).toBe(false);
    expect(isThermochemistryPayload(null)).toBe(false);
  });
});

describe("temperature/pressure draft input", () => {
  const last = { temperatureK: 748.15, pressurePa: STANDARD_ATMOSPHERE_PA };

  it("adopts a valid draft as the displayed conditions", () => {
    const outcome = resolveConditionsDraft("350", "2", last);
    expect(outcome.error).toBeNull();
    expect(outcome.invalidFields).toEqual([]);
    expect(outcome.conditions.temperatureK).toBe(350);
    expect(outcome.conditions.pressurePa).toBeCloseTo(2 * STANDARD_ATMOSPHERE_PA, 6);
  });

  it("keeps the last valid conditions when the temperature draft is invalid (no recompute)", () => {
    for (const text of ["10", "0", "-5", "5000", "", "abc"]) {
      const outcome = resolveConditionsDraft(text, "1", last);
      expect(outcome.error, text).not.toBeNull();
      expect(outcome.invalidFields, text).toEqual(["temperature"]);
      expect(outcome.conditions, text).toBe(last);
    }
  });

  it("keeps the last valid conditions when the pressure draft is invalid", () => {
    for (const text of ["0", "-1", "", "x", "1e9"]) {
      const outcome = resolveConditionsDraft("300", text, last);
      expect(outcome.error, text).not.toBeNull();
      expect(outcome.invalidFields, text).toEqual(["pressure"]);
      expect(outcome.conditions, text).toBe(last);
    }
  });

  it("reports both fields when both drafts are invalid", () => {
    const outcome = resolveConditionsDraft("10", "0", last);
    expect(outcome.invalidFields).toEqual(["temperature", "pressure"]);
    expect(outcome.conditions).toBe(last);
  });

  it("never changes the stored record: the last valid conditions evaluate to the same view", () => {
    const stored = { temperatureK: payload.conditions.temperature_k, pressurePa: payload.conditions.pressure_pa };
    const before = viewFromResult(payload);
    const outcome = resolveConditionsDraft("10", "1", stored);
    expect(outcome.conditions).toBe(stored);
    expect(viewFromResult(payload)).toEqual(before);
    expect(before.origin).toBe("authoritative");
  });
});
