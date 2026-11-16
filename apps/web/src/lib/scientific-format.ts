/** Format saved scientific numbers for display without changing their stored value. */
export function formatScientificNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const displayValue = Math.abs(value) < 0.0000005 ? 0 : value;
  return displayValue.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

const SUBSCRIPT_DIGITS: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};

export function toSubscriptDigits(count: number): string {
  return String(count)
    .split("")
    .map((digit) => SUBSCRIPT_DIGITS[digit] ?? digit)
    .join("");
}

const VALID_ELEMENT_REGEX = /^[A-Z][a-z]?$/;

/**
 * Deterministically derives a Hill-system molecular formula from authoritative atoms.
 * Hill system rules:
 * - If Carbon (C) is present: C first, then H, then remaining elements in alphabetical order.
 * - If no Carbon (C): all elements in strict alphabetical order.
 * - Returns null if atoms are missing, empty, or contain unverified element symbols.
 * Never derives from structure or project names.
 */
export function deriveMolecularFormula(
  atoms: Array<{ element: string }> | undefined | null,
  options?: { useSubscripts?: boolean }
): string | null {
  if (!atoms || !Array.isArray(atoms) || atoms.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const atom of atoms) {
    if (!atom || typeof atom.element !== "string") return null;
    const raw = atom.element.trim();
    if (!raw) return null;
    // Standardize symbol capitalization (e.g. "cl" -> "Cl")
    const symbol = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    if (!VALID_ELEMENT_REGEX.test(symbol)) return null;
    counts[symbol] = (counts[symbol] ?? 0) + 1;
  }

  const elements = Object.keys(counts);
  if (elements.length === 0) return null;

  const hasCarbon = "C" in counts;
  let orderedElements: string[];

  if (hasCarbon) {
    const others = elements.filter((el) => el !== "C" && el !== "H").sort();
    orderedElements = ["C"];
    if ("H" in counts) orderedElements.push("H");
    orderedElements.push(...others);
  } else {
    orderedElements = [...elements].sort();
  }

  const useSubscripts = options?.useSubscripts ?? true;
  return orderedElements
    .map((el) => {
      const count = counts[el] ?? 0;
      if (count <= 1) return el;
      return `${el}${useSubscripts ? toSubscriptDigits(count) : count}`;
    })
    .join("");
}

/**
 * Return 1-based user-visible molecular orbital number from 0-based internal engine index.
 * Example: internal index 4 -> 5 (HOMO in water minimal basis STO-3G)
 */
export function formatOrbitalNumber(zeroBasedIndex: number): number {
  return zeroBasedIndex + 1;
}

export function formatOrbitalLabel(zeroBasedIndex: number): string {
  return `Orbital ${zeroBasedIndex + 1}`;
}

/** Conversion factor from Hartree (Eh) to electron-volts (eV) via CODATA. */
export const HARTREE_TO_EV = 27.211386245988;

export function hartreeToEv(hartree: number): number {
  return hartree * HARTREE_TO_EV;
}

/**
 * Format message timestamp consistently using standard locale time and UTC normalization.
 */
export function formatMessageTime(createdAt: string | Date | undefined | null): string {
  if (!createdAt) return "—";
  let date: Date;
  if (createdAt instanceof Date) {
    date = createdAt;
  } else {
    const raw = String(createdAt).trim();
    // If string is an ISO string without timezone indicator, treat as UTC
    const isIsoWithoutTz = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw);
    const normalized = isIsoWithoutTz ? `${raw}Z` : raw;
    date = new Date(normalized);
  }
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
