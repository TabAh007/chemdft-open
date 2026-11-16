import { describe, expect, it } from "vitest";
import { plainSubmitError } from "../src/lib/plain-submit-errors";

describe("plainSubmitError", () => {
  it("explains the parity code in plain words and keeps the raw text for Details", () => {
    const raw = "ELECTRONIC_STATE_PARITY_INVALID: Electron count and multiplicity have an impossible parity relationship";
    const out = plainSubmitError(raw);
    expect(out.text).toMatch(/multiplicity/);
    expect(out.text).not.toMatch(/ELECTRONIC_STATE_PARITY_INVALID/);
    expect(out.detail).toBe(raw);
  });
  it("keeps the server's numbers for a stored-value mismatch", () => {
    const out = plainSubmitError("CALCULATION_CHARGE_MISMATCH: Requested charge 1 must match accepted StructureVersion charge 0.");
    expect(out.text).toContain("Requested charge 1 must match");
    expect(out.text).not.toContain("CALCULATION_CHARGE_MISMATCH");
  });
  it("covers every known code without leaking it", () => {
    for (const code of ["ELECTRONIC_STATE_INVALID", "CALCULATION_MULTIPLICITY_MISMATCH", "CALCULATION_ELECTRONIC_STATE_REQUIRED", "STRUCTURE_ELECTRONIC_STATE_UNAVAILABLE", "XYZ_ELECTRONIC_STATE_INVALID", "XYZ_ELECTRONIC_STATE_PROVENANCE_INVALID", "ENGINE_UNAVAILABLE", "AWS_OPTIMIZATION_REFUSED"]) {
      const out = plainSubmitError(`${code}: x`);
      expect(out.text).not.toContain(code);
      expect(out.detail).toBe(`${code}: x`);
    }
  });
  it("gives an unknown code a generic sentence plus Details", () => {
    const out = plainSubmitError("SOMETHING_NEW: odd");
    expect(out.text).toBe("The server could not accept this calculation.");
    expect(out.detail).toBe("SOMETHING_NEW: odd");
  });
  it("passes sentences through untouched with no Details", () => {
    expect(plainSubmitError("network lost")).toEqual({ text: "network lost", detail: null });
    expect(plainSubmitError(null)).toEqual({ text: "", detail: null });
  });
});

describe("hosted optimization refusal", () => {
  it("keeps the server's sentence (it carries the atom limit) and the raw text under details", () => {
    const raw = "AWS_OPTIMIZATION_REFUSED: Hosted geometry optimization is limited to 12 atoms while it is being accepted; this structure has 20.";
    const out = plainSubmitError(raw);
    expect(out.text).toContain("cannot run on the hosted beta");
    expect(out.text).toContain("limited to 12 atoms");
    expect(out.detail).toBe(raw);
  });
});
