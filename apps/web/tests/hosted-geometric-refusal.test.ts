import { describe, expect, it } from "vitest";
import { HOSTED_GEOMETRIC_MESSAGE, classifyEngineChoice } from "../src/lib/guided-capability-state";

const hostedPyscf = { engine: "pyscf", availability: "AVAILABLE", supported_tasks: ["ENERGY", "FREQUENCY"], supported_optimizers: [], supported_methods: ["hf"], supported_basis_sets: ["sto-3g"] };
const base = { capabilities: [hostedPyscf] as never, capabilityError: null, loading: false, canExecute: true };

describe("hosted geometry optimisation refusal (geomeTRIC not in the hosted image)", () => {
  it("names the hosted limit and Self-hosting for PySCF optimisation", () => {
    const c = classifyEngineChoice({ ...base, engine: "pyscf", task: "GEOMETRY_OPTIMIZATION" });
    expect(c.selectable).toBe(false);
    expect(c.reason).toBe(HOSTED_GEOMETRIC_MESSAGE);
    expect(c.reason).toMatch(/not available in the hosted version/);
    expect(c.reason).toMatch(/Self-hosting/);
  });
  it("leaves PySCF energy selectable", () => {
    expect(classifyEngineChoice({ ...base, engine: "pyscf", task: "ENERGY" }).selectable).toBe(true);
  });
});
