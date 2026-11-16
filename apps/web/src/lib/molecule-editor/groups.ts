/**
 * Functional-group stamps for the Ketcher template tool. Each is a hand-built 2D MOL block whose FIRST atom is
 * the attachment atom (Ketcher merges it onto the atom you click). Only standard connectivity is encoded;
 * hydrogens stay implicit and are added by the server on Generate 3D.
 */
type GroupAtom = { symbol: string; x: number; y: number; charge?: 1 | -1 };
type GroupBond = [from: number, to: number, order: 1 | 2 | 3];

function chargeCode(charge: GroupAtom["charge"]): number {
  if (charge === 1) return 3;
  if (charge === -1) return 5;
  return 0;
}

export function buildGroupMolfile(name: string, atoms: readonly GroupAtom[], bonds: readonly GroupBond[]): string {
  const counts = `${String(atoms.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`;
  const atomLines = atoms.map((atom) =>
    `${atom.x.toFixed(4).padStart(10)}${atom.y.toFixed(4).padStart(10)}${(0).toFixed(4).padStart(10)} ${atom.symbol.padEnd(3)} 0${String(chargeCode(atom.charge)).padStart(3)}  0  0  0  0  0  0  0  0  0  0`,
  );
  const bondLines = bonds.map(([from, to, order]) => `${String(from + 1).padStart(3)}${String(to + 1).padStart(3)}${String(order).padStart(3)}  0`);
  return ["", `  ChemDFT ${name}`, "", counts, ...atomLines, ...bondLines, "M  END", ""].join("\n");
}

export type FunctionalGroup = { id: string; label: string; molfile: string; elements: readonly string[] };

function group(id: string, label: string, atoms: readonly GroupAtom[], bonds: readonly GroupBond[]): FunctionalGroup {
  return { id, label, molfile: buildGroupMolfile(label, atoms, bonds), elements: atoms.map((atom) => atom.symbol) };
}

export const FUNCTIONAL_GROUPS: readonly FunctionalGroup[] = [
  group("ch3", "CH3", [{ symbol: "C", x: 0, y: 0 }], []),
  group("oh", "OH", [{ symbol: "O", x: 0, y: 0 }], []),
  group("nh2", "NH2", [{ symbol: "N", x: 0, y: 0 }], []),
  group("cooh", "COOH", [{ symbol: "C", x: 0, y: 0 }, { symbol: "O", x: 0.866, y: 0.5 }, { symbol: "O", x: 0.866, y: -0.5 }], [[0, 1, 2], [0, 2, 1]]),
  group("no2", "NO2", [{ symbol: "N", x: 0, y: 0, charge: 1 }, { symbol: "O", x: 0.866, y: 0.5 }, { symbol: "O", x: 0.866, y: -0.5, charge: -1 }], [[0, 1, 2], [0, 2, 1]]),
  group("cn", "CN", [{ symbol: "C", x: 0, y: 0 }, { symbol: "N", x: 1, y: 0 }], [[0, 1, 3]]),
];
