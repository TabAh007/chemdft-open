import { fractionalToCartesian, latticeVectors } from "../lattice";
import type { LatticeParameters, ScientificStructure, StructureSite, Vec3 } from "../types";

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

type PeriodicInput = Omit<ScientificStructure, "kind" | "lattice" | "sites"> & {
  readonly parameters: LatticeParameters;
  readonly sites: readonly { readonly element: string; readonly fractional: Vec3 }[];
};

/** Builds a crystal from fractional sites and cell parameters. Cartesian positions are derived, never stored independently. */
export function periodicStructure(input: PeriodicInput): ScientificStructure {
  const { parameters, sites, ...rest } = input;
  const vectors = latticeVectors(parameters);
  const built: StructureSite[] = sites.map((site) => ({ element: site.element, fractional: site.fractional, position: fractionalToCartesian(site.fractional, vectors) }));
  return deepFreeze({ ...rest, kind: "periodic" as const, lattice: { parameters, vectors }, sites: built });
}

export function hillFormula(elements: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const element of elements) counts.set(element, (counts.get(element) ?? 0) + 1);
  const names = [...counts.keys()].sort();
  const hasCarbon = counts.has("C");
  const order = hasCarbon ? ["C", "H", ...names.filter((name) => name !== "C" && name !== "H")].filter((name) => counts.has(name)) : names;
  return order.map((name) => `${name}${counts.get(name)! > 1 ? counts.get(name) : ""}`).join("");
}
