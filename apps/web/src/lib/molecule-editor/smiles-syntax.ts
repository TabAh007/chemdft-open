/**
 * Strict SMILES syntax check run BEFORE anything reaches Ketcher.
 *
 * Indigo's auto-loader is lenient: "C(C" loads as two atoms and "hello world" as an empty structure, with
 * no error. The editor must never silently accept such input, so syntax is verified here and Indigo is only
 * asked to interpret strings that are well formed. This checks syntax only; it does not judge chemistry.
 */

const ELEMENT_SYMBOLS = new Set(
  ("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe " +
    "Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr " +
    "Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og D T").split(" "),
);
const AROMATIC_SYMBOLS = new Set(["b", "c", "n", "o", "p", "s", "se", "as"]);
const ORGANIC_TWO = new Set(["Cl", "Br"]);
const ORGANIC_ONE = new Set(["B", "C", "N", "O", "P", "S", "F", "I"]);
const AROMATIC_ONE = new Set(["b", "c", "n", "o", "p", "s"]);
const BOND_CHARS = new Set(["-", "=", "#", "$", ":", "/", "\\", "~"]);

const BRACKET_ATOM = /^(\d{1,3})?(\*|[A-Z][a-z]?|[a-z]{1,2})(@{1,2})?(H\d?)?(\+\+|--|\+\d{0,2}|-\d{0,2})?(:\d+)?$/;

export type SmilesSyntaxResult = { ok: true; atoms: number } | { ok: false; reason: string; index: number };

export function validateSmilesSyntax(input: string): SmilesSyntaxResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: "The SMILES string is empty.", index: 0 };
  if (/\s/.test(text)) return { ok: false, reason: "A SMILES string has no spaces. Paste only the SMILES, or a full MOL block.", index: text.search(/\s/) };

  const open = new Map<string, number>();
  const branchStack: number[] = [];
  let atoms = 0;
  // "atom" = the previous token can take a branch, bond or ring closure.
  let previous: "start" | "atom" | "bond" | "dot" | "open" | "close" = "start";

  for (let i = 0; i < text.length; ) {
    const ch = text[i] as string;
    if (ch === "[") {
      const end = text.indexOf("]", i);
      if (end < 0) return { ok: false, reason: "A square bracket [ is never closed.", index: i };
      const body = text.slice(i + 1, end);
      const match = BRACKET_ATOM.exec(body);
      if (!match) return { ok: false, reason: `“[${body}]” is not a valid bracket atom.`, index: i };
      const symbol = match[2] as string;
      const known = symbol === "*" || ELEMENT_SYMBOLS.has(symbol) || AROMATIC_SYMBOLS.has(symbol);
      if (!known) return { ok: false, reason: `“${symbol}” is not a known element symbol.`, index: i };
      atoms += 1;
      previous = "atom";
      i = end + 1;
      continue;
    }
    if (ch === "]") return { ok: false, reason: "A closing bracket ] has no opening [.", index: i };
    const two = text.slice(i, i + 2);
    if (ORGANIC_TWO.has(two)) { atoms += 1; previous = "atom"; i += 2; continue; }
    if (ORGANIC_ONE.has(ch) || AROMATIC_ONE.has(ch) || ch === "*") { atoms += 1; previous = "atom"; i += 1; continue; }
    if (BOND_CHARS.has(ch)) {
      if (previous === "bond" || previous === "dot" || previous === "start") return { ok: false, reason: `The bond “${ch}” needs an atom before it.`, index: i };
      previous = "bond"; i += 1; continue;
    }
    if (ch === ".") {
      if (previous === "start" || previous === "bond" || previous === "dot" || previous === "open") return { ok: false, reason: "A “.” separates two parts and needs an atom before it.", index: i };
      previous = "dot"; i += 1; continue;
    }
    if (ch === "(") {
      if (previous !== "atom" && previous !== "close") return { ok: false, reason: "A branch “(” must follow an atom.", index: i };
      branchStack.push(i); previous = "open"; i += 1; continue;
    }
    if (ch === ")") {
      if (branchStack.length === 0) return { ok: false, reason: "A closing parenthesis “)” has no opening “(”.", index: i };
      if (previous === "open" || previous === "bond" || previous === "dot") return { ok: false, reason: "A branch “( )” must contain at least one atom.", index: i };
      branchStack.pop(); previous = "close"; i += 1; continue;
    }
    if (/[0-9]/.test(ch) || ch === "%") {
      let label = ch;
      let length = 1;
      if (ch === "%") {
        const digits = /^%(\d{2})/.exec(text.slice(i));
        if (!digits) return { ok: false, reason: "“%” must be followed by two digits (a ring closure number).", index: i };
        label = digits[1] as string; length = 3;
      }
      if (previous !== "atom" && previous !== "bond") return { ok: false, reason: `The ring closure ${label} must follow an atom.`, index: i };
      if (open.has(label)) open.delete(label); else open.set(label, i);
      previous = "atom"; i += length; continue;
    }
    return { ok: false, reason: `“${ch}” is not valid in a SMILES string.`, index: i };
  }

  if (branchStack.length > 0) return { ok: false, reason: "A branch “(” is never closed.", index: branchStack[0] as number };
  const unclosed = [...open.entries()][0];
  if (unclosed) return { ok: false, reason: `The ring closure ${unclosed[0]} is opened but never closed.`, index: unclosed[1] };
  if (previous === "bond" || previous === "dot" || previous === "open") return { ok: false, reason: "The SMILES string ends before the structure is complete.", index: text.length - 1 };
  if (atoms === 0) return { ok: false, reason: "The SMILES string contains no atoms.", index: 0 };
  return { ok: true, atoms };
}
