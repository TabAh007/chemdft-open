import { describe, expect, it } from "vitest";
import { plainEngineReason } from "../src/lib/engine-reason-text";
import { ENGINE_INFO } from "../src/lib/guided-engine-info";

describe("Calculation setup wording (0.0.25 follow-up)", () => {
  it("rewrites only reasons it understands and keeps the raw wording for Technical details", () => {
    expect(plainEngineReason("No accepted native Psi4 CLI is configured.")).toEqual({ plain: "Psi4 is not set up on this server, so Psi4 calculations cannot be run here.", technical: "No accepted native Psi4 CLI is configured." });
    expect(plainEngineReason("Worker unavailable")).toEqual({ plain: "Worker unavailable", technical: null });
    expect(plainEngineReason(undefined)).toEqual({ plain: "", technical: null });
  });
  it("the xTB scale caution and the Psi4 restriction stay verbatim and belong to their own engine", () => {
    expect(ENGINE_INFO.xtb!.caveat).toBe("Its total energies are on a different scale from ab initio energies and must not be compared with them directly.");
    expect(ENGINE_INFO.psi4!.caveat).toContain("neutral closed-shell singlets");
    expect(ENGINE_INFO.pyscf!.caveat).toBeNull();
  });
});
