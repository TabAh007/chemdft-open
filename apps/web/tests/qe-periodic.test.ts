import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import ELEMENTS from "../src/content/qe-sssp-elements.json";
import {
  QE_BASIS_ID,
  QE_LIMITS,
  QE_LIBRARY_DOI,
  QE_LIBRARY_NAME,
  meshTuple,
  qeCutoffs,
  qeElementSupport,
  qeEstimateMemoryMb,
  qeEstimateSeconds,
  qeLibraries,
  qeRefusal,
} from "../src/lib/qe-periodic";

type ParityCase = {
  input: { atoms: number; ecutwfc_ry: number; scf_mesh: number[]; nspin: 1 | 2; relax: boolean; dos: boolean; dos_mesh: number[]; bands: boolean; band_points: number; relax_max_steps: number };
  estimate_total_s: number;
  estimate_stages_s: Record<string, number>;
  memory_mb: number;
  refusal: string | null;
};
const parity = JSON.parse(readFileSync(resolve(__dirname, "../../../services/api/tests/fixtures/contracts/qe_limits_parity.json"), "utf8")) as { cases: ParityCase[] };

describe("Quantum ESPRESSO limits and estimate match the Python golden record", () => {
  parity.cases.forEach((c, index) => {
    it(`case ${index}`, () => {
      const input = {
        atoms: c.input.atoms, ecutwfc: c.input.ecutwfc_ry, scfMesh: c.input.scf_mesh, nspin: c.input.nspin, relax: c.input.relax,
        dos: c.input.dos, dosMesh: c.input.dos_mesh, bands: c.input.bands, bandPoints: c.input.band_points, relaxMaxSteps: c.input.relax_max_steps,
      };
      const estimate = qeEstimateSeconds(input);
      expect(estimate.total).toBeCloseTo(c.estimate_total_s, 1);
      for (const [stage, seconds] of Object.entries(c.estimate_stages_s)) {
        if (stage !== "total") expect(estimate.stages[stage]).toBeCloseTo(seconds, 1);
      }
      expect(qeEstimateMemoryMb({ atoms: input.atoms, ecutwfc: input.ecutwfc, bandPoints: input.bandPoints, bands: input.bands, dos: input.dos })).toBeCloseTo(c.memory_mb, 1);
      expect(qeRefusal(input)).toBe(c.refusal);
    });
  });
});

describe("element table", () => {
  it("offers 92 elements and names the library exactly", () => {
    expect(Object.keys(ELEMENTS.elements)).toHaveLength(92);
    expect(QE_LIBRARY_NAME).toBe("SSSP PBE Efficiency v2.0");
    expect(QE_LIBRARY_DOI).toBe("10.24435/materialscloud:f3-ym");
    expect(QE_BASIS_ID).toBe("pw-sssp-pbe-eff-v2");
  });
  it("refuses U, Pa and La and takes the larger cutoffs of Cr and O", () => {
    expect(qeElementSupport(["Cr", "O", "U", "La"]).offending).toEqual(["La", "U"]);
    expect(qeElementSupport(["Cr", "O"]).usable).toBe(true);
    expect(qeCutoffs(["Cr", "O"])).toEqual({ ecutwfc: 45, ecutrho: 540 });
    expect(qeLibraries(["Cr", "O"])).toEqual({ Cr: "gbrv", O: "pslibrary-0" });
  });
  it("mesh strings map to tuples", () => {
    expect(meshTuple("3x3x3")).toEqual([3, 3, 3]);
  });
});

describe("release 0.0.45: the whole-job cap fits one AWS session", () => {
  const AWS_SESSION_SECONDS = 7140; // measured live 2026-11-12; overhead 300 s and admission margin 120 s as in aws_compute.py
  it("caps the whole job so that cap + overhead + margin fits the session", () => {
    expect(QE_LIMITS.totalSeconds).toBe(3600);
    expect(QE_LIMITS.totalSeconds + 300 + 120).toBeLessThanOrEqual(AWS_SESSION_SECONDS);
  });
  it("never lets an estimate above the cap through, for the largest allowed requests", () => {
    for (const atoms of [1, 5, 10, 15, 20]) {
      const input = { atoms, ecutwfc: 90, scfMesh: [4, 4, 4], nspin: 2 as const, relax: true, dos: true, dosMesh: [6, 6, 6], bands: true, bandPoints: 100 };
      const refusal = qeRefusal(input);
      if (refusal === null) expect(qeEstimateSeconds(input).total).toBeLessThanOrEqual(QE_LIMITS.totalSeconds);
      else expect(refusal).toMatch(/limit|cap|exceeds|mesh|path|steps|memory/i);
    }
  });
});
