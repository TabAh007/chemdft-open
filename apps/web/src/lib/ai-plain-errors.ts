import { aiErrorLabel } from "./scientific-labels";

/** A stored error code such as PROVIDER_TIMEOUT or ALLOWANCE_EXCEEDED (upper-case words joined by underscores). */
const CODE = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?:\s*[:·-]\s*([\s\S]*))?$/;
/** What `readJson` in ai-scientist-api.ts produces for a failed request: "HTTP 503 · CODE: message" or "HTTP 500: message". */
const HTTP_ERROR = /^HTTP (\d{3})(?:\s*·\s*([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+))?:\s*([\s\S]*)$/;
/** The fallback sentence `readJson` uses when the response body carried no message at all. */
const NO_MESSAGE = /^ChemDFT API request failed with HTTP \d{3}$/;

/**
 * A request error in the researcher's words. A message that starts with a stored error code (bare, or after the "HTTP nnn ·"
 * prefix of a failed request) is shown as that code's plain label plus any sentence the server sent, and the original text is
 * returned as `detail` for a Details disclosure. Any other message is already a sentence and is shown as it is. The raw text is
 * never discarded, and the server's own sentence is never dropped (it can state that no other provider or model was used).
 */
export function plainAiError(raw: string | null | undefined): { text: string; detail: string | null } {
  const message = (raw ?? "").trim();
  if (!message) return { text: "", detail: null };
  const http = HTTP_ERROR.exec(message);
  if (http) {
    const [, , code, body] = http;
    const sentence = body?.trim() ?? "";
    if (code) return { text: sentence ? `${aiErrorLabel(code)}. ${sentence}` : `${aiErrorLabel(code)}.`, detail: message };
    if (!sentence || NO_MESSAGE.test(sentence)) return { text: "The ChemDFT server could not complete this request.", detail: message };
    return { text: sentence, detail: message };
  }
  const match = CODE.exec(message);
  if (!match) return { text: message, detail: null };
  const [, code, rest] = match;
  const label = aiErrorLabel(code);
  const tail = rest?.trim();
  return { text: tail ? `${label}. ${tail}` : `${label}.`, detail: message };
}
