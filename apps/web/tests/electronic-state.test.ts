import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkElectronicState } from "../src/lib/electronic-state";

const SYMBOL: Record<number, string> = { 1: "H", 7: "N", 8: "O" };
const cases = JSON.parse(readFileSync(new URL("./fixtures/electronic-state-cases.json", import.meta.url), "utf8")).cases as Array<{
  label: string; z: number[]; charge: number; multiplicity: number; ok: boolean;
}>;
const atoms = (z: number[]) => z.map((atomic_number) => ({ atomic_number, element: SYMBOL[atomic_number] ?? "H" }));

describe("checkElectronicState", () => {
  it.each(cases)("$label", ({ z, charge, multiplicity, ok }) => {
    const result = checkElectronicState(atoms(z), charge, multiplicity);
    // Multiplicity 0 cannot be typed (the input clamps to 1), so it is "unchecked" here and refused by the server.
    if (ok) expect(result.status).toBe("ok");
    else expect(result.status).not.toBe("ok");
  });

  it("explains the F8 case in plain language with the computed formula", () => {
    const result = checkElectronicState(atoms([8, 1, 1]), 1, 1);
    expect(result).toMatchObject({ status: "invalid", electrons: 9 });
    expect(result.status === "invalid" && result.message).toBe(
      "H2O with total charge +1 has 9 electrons. Multiplicity 1 means every electron is paired, which needs an even number. Use multiplicity 2, 4, 6, 8, … or change the total charge.",
    );
  });

  it("does not claim to check what it cannot count", () => {
    expect(checkElectronicState(atoms([8, 1, 1]), 1, 1, { periodic: true }).status).toBe("unchecked");
    expect(checkElectronicState([{ element: "Bq", atomic_number: 0 }], 0, 1).status).toBe("unchecked");
    expect(checkElectronicState([], 0, 1).status).toBe("unchecked");
    expect(checkElectronicState(atoms([1]), 0.5, 1).status).toBe("unchecked");
  });
});
