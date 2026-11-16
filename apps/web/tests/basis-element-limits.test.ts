import { describe, expect, it } from "vitest";
import { basisCoverage, coverageMessage } from "../src/lib/basis-element-limits";

// Limits equal the backend's PYSCF_MAX_ATOMIC_NUMBER (tied to the pinned library by test_pf8f_capability_conformance).
const pyscf = { max_atomic_number_by_basis: { "sto-3g": 53, "6-31g": 30, "def2-svp": 36, "def2-svpd": 36 } };
const WATER = [8, 1, 1];
const IODOMETHANE = [6, 1, 1, 1, 53];
const TIN = [50];

describe("advisory basis/element coverage from capability metadata", () => {
  it("accepts organic and light-element structures in every PySCF basis", () => {
    for (const basis of Object.keys(pyscf.max_atomic_number_by_basis)) expect(basisCoverage(pyscf, basis, WATER).usable).toBe(true);
  });
  it("blocks def2 bases beyond Z = 36, where no ECP is supplied", () => {
    const coverage = basisCoverage(pyscf, "def2-svp", IODOMETHANE);
    expect(coverage).toEqual({ usable: false, limit: 36, offending: [53] });
    expect(coverageMessage("def2-svp", coverage)).toBe("DEF2-SVP is supported only through atomic number 36; this structure contains element with Z = 53.");
  });
  it("keeps the boundary exact: the limit itself is usable, one beyond is not", () => {
    expect(basisCoverage(pyscf, "6-31g", [30]).usable).toBe(true);
    expect(basisCoverage(pyscf, "6-31g", [31]).usable).toBe(false);
    expect(basisCoverage(pyscf, "sto-3g", IODOMETHANE).usable).toBe(true);
    expect(basisCoverage(pyscf, "sto-3g", TIN).usable).toBe(true);
    expect(basisCoverage(pyscf, "sto-3g", [54]).usable).toBe(false);
  });
  it("lists each offending element once", () => {
    expect(basisCoverage(pyscf, "6-31g", [53, 35, 53, 1]).offending).toEqual([35, 53]);
  });
  it("never blocks when the API reports no limits (older API, xTB, Psi4)", () => {
    expect(basisCoverage(undefined, "def2-svp", IODOMETHANE).usable).toBe(true);
    expect(basisCoverage({ max_atomic_number_by_basis: {} }, "def2-svp", IODOMETHANE).usable).toBe(true);
    expect(basisCoverage({}, "def2-svp", IODOMETHANE).usable).toBe(true);
    expect(coverageMessage("def2-svp", basisCoverage(undefined, "def2-svp", IODOMETHANE))).toBeNull();
  });
});
