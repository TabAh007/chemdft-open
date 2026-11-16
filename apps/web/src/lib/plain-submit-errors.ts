/** A server error as `apiError` formats it: "CODE: message" (a detail object with a code), or a bare sentence. */
const CODED = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+):\s*([\s\S]*)$/;

/** Codes `submitCalculation` can surface for the electronic state and engine choice. `keepServerSentence` appends the server's own sentence because it carries the numbers. */
const SUBMIT_CODES: Record<string, { text: string; keepServerSentence?: boolean }> = {
  ELECTRONIC_STATE_PARITY_INVALID: { text: "This total charge and multiplicity cannot exist for these atoms: the electron count and the number of unpaired electrons do not fit. Change the total charge or the multiplicity." },
  ELECTRONIC_STATE_INVALID: { text: "The total charge must be a whole number and the multiplicity a positive whole number." },
  CALCULATION_CHARGE_MISMATCH: { text: "The total charge differs from the charge stored with this structure, and the server only accepts the stored value.", keepServerSentence: true },
  CALCULATION_MULTIPLICITY_MISMATCH: { text: "The multiplicity differs from the one stored with this structure, and the server only accepts the stored value.", keepServerSentence: true },
  CALCULATION_ELECTRONIC_STATE_REQUIRED: { text: "This structure has no stored charge and spin, so you must state the total charge and multiplicity yourself." },
  STRUCTURE_ELECTRONIC_STATE_UNAVAILABLE: { text: "This structure does not store an authoritative charge and multiplicity, so it cannot be calculated as it is." },
  XYZ_ELECTRONIC_STATE_INVALID: { text: "The charge and multiplicity stated for this XYZ structure cannot exist for its atoms. Change the total charge or the multiplicity." },
  XYZ_ELECTRONIC_STATE_PROVENANCE_INVALID: { text: "The server could not confirm where this XYZ structure came from, so it will not accept a charge and multiplicity you state for it." },
  AWS_OPTIMIZATION_REFUSED: { text: "This geometry optimization cannot run on the hosted beta.", keepServerSentence: true },
  ENGINE_UNAVAILABLE: { text: "The selected engine is not available right now." },
};

/**
 * A calculation-submit error in the researcher's words. A message that starts with a stored code is shown as that code's plain
 * sentence (an unknown code gets a generic one), and the original text is returned as `detail` for a Details disclosure.
 * A message with no code is already a sentence and is shown as it is. The raw text is never discarded.
 */
export function plainSubmitError(raw: string | null | undefined): { text: string; detail: string | null } {
  const message = (raw ?? "").trim();
  if (!message) return { text: "", detail: null };
  const match = CODED.exec(message);
  if (!match) return { text: message, detail: null };
  const [, code, sentence] = match;
  const known = SUBMIT_CODES[code!];
  if (!known) return { text: "The server could not accept this calculation.", detail: message };
  const tail = sentence?.trim();
  return { text: known.keepServerSentence && tail ? `${known.text} ${tail}` : known.text, detail: message };
}
