import type { ScientificScene } from "@chemdft/scientific-scene";
import { inferVisualBonds } from "@chemdft/scientific-scene";

export function structureConnectivity(scene: ScientificScene | null) {
  const authoritative = scene?.bonds.filter(bond => bond.source === "canonical") ?? [];
  const inferred = scene ? inferVisualBonds(scene) : [];
  const atoms = new Map(scene?.atoms.map(atom => [atom.index, atom.element]) ?? []);
  const pairs = [...new Set(inferred.map(bond => [atoms.get(bond.atomIndexA), atoms.get(bond.atomIndexB)].sort().join("–")))];
  if (authoritative.length && inferred.length) return {
    status: "MIXED", label: "Recorded connectivity with inferred display connections",
    text: `${authoritative.length} source-provided bonds are recorded. Additional ${pairs.join(", ")} connections are inferred from distances for visualization only.`,
    authoritativeCount: authoritative.length,
  };
  if (authoritative.length) return {
    status: "AUTHORITATIVE", label: "Source-provided authoritative connectivity",
    text: "The connections shown are recorded in this immutable structure version; they are not inferred from distances.",
    authoritativeCount: authoritative.length,
  };
  if (inferred.length) return {
    status: "INFERRED", label: "Inferred visualization; no authoritative connectivity",
    text: `The ${pairs.join(", ")} connections shown are inferred from distances for visualization only. No source-provided authoritative bonds are recorded.`,
    authoritativeCount: 0,
  };
  return { status: "UNKNOWN", label: "Connectivity unavailable", text: "No source-provided authoritative bonds or supported inferred display connections are available. Connectivity is unknown.", authoritativeCount: 0 };
}
