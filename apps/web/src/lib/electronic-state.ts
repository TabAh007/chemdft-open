import { deriveMolecularFormula } from "./scientific-format";

type Atom = { element: string; atomic_number: number };

export type ElectronicStateCheck =
  | { status: "unchecked"; reason: string }
  | { status: "ok"; electrons: number }
  | { status: "invalid"; electrons: number; message: string };

function signed(charge: number): string {
  return charge > 0 ? `+${charge}` : String(charge);
}

/** Multiplicities (up to `limit`) whose parity fits `electrons`: odd electron count needs even multiplicity and vice versa. */
function fittingMultiplicities(electrons: number, limit = 4): number[] {
  const first = electrons % 2 === 0 ? 1 : 2;
  const list: number[] = [];
  for (let m = first; m <= electrons + 1 && list.length < limit; m += 2) list.push(m);
  return list;
}

/**
 * Mirror of the server's `validate_electronic_state_composition`: electrons = sum(Z) - charge, and
 * (electrons - (multiplicity - 1)) must be even and non-negative, with at least one electron. This only
 * finds impossible states. Passing it says nothing about whether the state is chemically right
 * (O2 singlet passes). Anything the rule cannot count reliably (missing or non-positive atomic number,
 * periodic cell) is "unchecked": the server stays the authority.
 */
export function checkElectronicState(
  atoms: readonly Atom[] | null | undefined,
  charge: number | null | undefined,
  multiplicity: number,
  options: { periodic?: boolean } = {},
): ElectronicStateCheck {
  if (options.periodic) return { status: "unchecked", reason: "Periodic structures are not checked here." };
  if (!atoms || atoms.length === 0) return { status: "unchecked", reason: "No atoms to count electrons from." };
  if (atoms.some((atom) => !Number.isInteger(atom.atomic_number) || atom.atomic_number < 1)) {
    return { status: "unchecked", reason: "An atom has no usable atomic number." };
  }
  if (charge === null || charge === undefined || !Number.isInteger(charge)) {
    return { status: "unchecked", reason: "Enter a total charge." };
  }
  if (!Number.isInteger(multiplicity) || multiplicity < 1) {
    return { status: "unchecked", reason: "Multiplicity must be a positive whole number." };
  }
  const electrons = atoms.reduce((sum, atom) => sum + atom.atomic_number, 0) - charge;
  const unpaired = multiplicity - 1;
  if (electrons > 0 && unpaired <= electrons && (electrons - unpaired) % 2 === 0) return { status: "ok", electrons };

  const formula = deriveMolecularFormula([...atoms], { useSubscripts: false });
  const subject = `${formula ?? "This structure"} with total charge ${signed(charge)}`;
  let message: string;
  if (electrons <= 0) {
    message = `${subject} has no electrons left, so no calculation is possible. Change the total charge.`;
  } else {
    const fits = fittingMultiplicities(electrons);
    const reason = unpaired > electrons
      ? `Multiplicity ${multiplicity} needs ${unpaired} unpaired electrons, more than the ${electrons} there are.`
      : multiplicity === 1
        ? `Multiplicity 1 means every electron is paired, which needs an even number.`
        : `Multiplicity ${multiplicity} means ${unpaired} unpaired electron${unpaired === 1 ? "" : "s"}, which does not fit ${electrons} electrons.`;
    const more = (fits[fits.length - 1] ?? 0) + 2 <= electrons + 1;
    message = `${subject} has ${electrons} electrons. ${reason} Use multiplicity ${fits.join(", ")}${more ? ", …" : ""} or change the total charge.`;
  }
  return { status: "invalid", electrons, message };
}

/**
 * The server lets a calculation request differ from a structure's stored charge/multiplicity only when its
 * `electronic_state_authority` is CALCULATION_USER_DECLARED. A server that does not send the field (older
 * deployment) leaves the boxes editable and the server stays the authority.
 */
export function isElectronicStateLocked(authority: string | null | undefined): boolean {
  return authority !== null && authority !== undefined && authority !== "CALCULATION_USER_DECLARED";
}
