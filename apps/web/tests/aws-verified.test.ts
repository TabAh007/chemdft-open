import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AWS_VERIFIED_ENERGY_PAIRS, AWS_VERIFIED_FREQUENCY_PAIRS, AWS_VERIFIED_OPTIMIZATION_PAIRS, AWS_VERIFIED_TDDFT_PAIRS, AWS_VERIFIED_THERMOCHEMISTRY_PAIRS, AWS_VERIFIED_XTB_ENERGY_PAIRS, AWS_VERIFIED_XTB_OPTIMIZATION_PAIRS, verifiedEnergyPairsText, verifiedFrequencyPairsText, verifiedOptimizationPairsText, verifiedTddftPairsText, verifiedThermochemistryPairsText, verifiedXtbEnergyPairsText, verifiedXtbOptimizationPairsText } from "../src/lib/aws-verified";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/aws-verified-pairs.json", import.meta.url), "utf8"));

describe("AWS verified pairs", () => {
  it("match the shared fixture that the server test also checks", () => {
    expect(AWS_VERIFIED_ENERGY_PAIRS).toEqual(fixture.energy);
  });
  it("optimization pairs match the shared fixture and render only the executed pair", () => {
    expect(AWS_VERIFIED_OPTIMIZATION_PAIRS).toEqual(fixture.optimization);
    expect(verifiedOptimizationPairsText()).toBe("B3LYP/def2-SVP (water)");
  });
  it("frequency pairs match the shared fixture and render only the executed pair", () => {
    expect(AWS_VERIFIED_FREQUENCY_PAIRS).toEqual(fixture.frequency);
    expect(verifiedFrequencyPairsText()).toBe("B3LYP/def2-SVP (water)");
  });
  it("thermochemistry pairs match the shared fixture and render only the executed pair", () => {
    expect(AWS_VERIFIED_THERMOCHEMISTRY_PAIRS).toEqual(fixture.thermochemistry);
    expect(verifiedThermochemistryPairsText()).toBe("B3LYP/def2-SVP (water)");
  });
  it("TDDFT and xTB energy pairs match the shared fixture and render only the executed pair", () => {
    expect(AWS_VERIFIED_TDDFT_PAIRS).toEqual(fixture.tddft);
    expect(verifiedTddftPairsText()).toBe("B3LYP/def2-SVP (water)");
    expect(AWS_VERIFIED_XTB_ENERGY_PAIRS).toEqual(fixture.xtb_energy);
    expect(verifiedXtbEnergyPairsText()).toBe("GFN2-xTB (water)");
  });
  it("xTB optimization pairs match the shared fixture and render only the executed pair", () => {
    expect(AWS_VERIFIED_XTB_OPTIMIZATION_PAIRS).toEqual(fixture.xtb_optimization);
    expect(verifiedXtbOptimizationPairsText()).toBe("GFN2-xTB (water)");
  });
  it("renders every pair and no other", () => {
    expect(verifiedEnergyPairsText()).toBe("HF/STO-3G (H2), B3LYP/def2-SVP (water), HF/STO-3G (water) and PBE/6-31G (water)");
  });
});
