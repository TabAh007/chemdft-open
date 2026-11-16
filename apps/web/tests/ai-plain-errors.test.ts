import { describe, expect, it } from "vitest";

import { plainAiError } from "../src/lib/ai-plain-errors";

const NO_FALLBACK = "The selected provider request failed. No other provider, model or credential source was used.";

/** Every message shape `readJson` (ai-scientist-api.ts) can hand the dock, plus the stored run error codes. */
const CASES: Array<{ name: string; raw: string; text: string; detail: string | null }> = [
  {
    name: "JSON {code, message} from the AI foundation (HTTP 503)",
    raw: `HTTP 503 · PROVIDER_TIMEOUT: ${NO_FALLBACK}`,
    text: `The AI provider did not answer in time. ${NO_FALLBACK}`,
    detail: `HTTP 503 · PROVIDER_TIMEOUT: ${NO_FALLBACK}`,
  },
  {
    name: "JSON {code, message} on a 502",
    raw: "HTTP 502 · PROVIDER_TIMEOUT: The model did not answer in time (fixture).",
    text: "The AI provider did not answer in time. The model did not answer in time (fixture).",
    detail: "HTTP 502 · PROVIDER_TIMEOUT: The model did not answer in time (fixture).",
  },
  {
    name: "rate limit",
    raw: `HTTP 503 · PROVIDER_RATE_LIMIT: ${NO_FALLBACK}`,
    text: `The AI provider is limiting requests right now. ${NO_FALLBACK}`,
    detail: `HTTP 503 · PROVIDER_RATE_LIMIT: ${NO_FALLBACK}`,
  },
  {
    name: "rejected saved key says only that (no key value anywhere)",
    raw: "HTTP 503 · BYOK_KEY_INVALID: The saved key was rejected.",
    text: "The saved API key was rejected by the provider. The saved key was rejected.",
    detail: "HTTP 503 · BYOK_KEY_INVALID: The saved key was rejected.",
  },
  {
    name: "code with an empty message",
    raw: "HTTP 429 · ALLOWANCE_EXCEEDED: ",
    text: "The AI allowance for this period is used up.",
    detail: "HTTP 429 · ALLOWANCE_EXCEEDED:",
  },
  {
    name: "JSON detail string (no code)",
    raw: "HTTP 500: The conversation could not be saved.",
    text: "The conversation could not be saved.",
    detail: "HTTP 500: The conversation could not be saved.",
  },
  {
    name: "validation list (no code)",
    raw: "HTTP 422: Field required; Invalid request",
    text: "Field required; Invalid request",
    detail: "HTTP 422: Field required; Invalid request",
  },
  {
    name: "non-JSON body (readJson's own fallback sentence)",
    raw: "HTTP 502: ChemDFT API request failed with HTTP 502",
    text: "The ChemDFT server could not complete this request.",
    detail: "HTTP 502: ChemDFT API request failed with HTTP 502",
  },
  {
    name: "conflict with the appended recovery sentence",
    raw: "HTTP 409 · RUN_INVALID_STATE: The run is not waiting. Context retained. Inspect the requested candidate, then refresh status. No action was retried.",
    text: "Run invalid state. The run is not waiting. Context retained. Inspect the requested candidate, then refresh status. No action was retried.",
    detail: "HTTP 409 · RUN_INVALID_STATE: The run is not waiting. Context retained. Inspect the requested candidate, then refresh status. No action was retried.",
  },
  {
    name: "authorization denied keeps its recovery sentence",
    raw: "HTTP 403: Forbidden. Authorization denied. Sign in with an authorized researcher account.",
    text: "Forbidden. Authorization denied. Sign in with an authorized researcher account.",
    detail: "HTTP 403: Forbidden. Authorization denied. Sign in with an authorized researcher account.",
  },
  {
    name: "network failure (already a sentence)",
    raw: "Backend temporarily unavailable. Saved scientific context is retained. Refresh run status before repeating an action.",
    text: "Backend temporarily unavailable. Saved scientific context is retained. Refresh run status before repeating an action.",
    detail: null,
  },
  {
    name: "client timeout (already a sentence)",
    raw: "Request timed out. The synchronous backend may still be executing. Refresh run status before repeating this action; no request was retried.",
    text: "Request timed out. The synchronous backend may still be executing. Refresh run status before repeating this action; no request was retried.",
    detail: null,
  },
  { name: "stored run error code with detail", raw: "PROVIDER_RATE_LIMIT: Slow down.", text: "The AI provider is limiting requests right now. Slow down.", detail: "PROVIDER_RATE_LIMIT: Slow down." },
  { name: "bare stored run error code", raw: "ALLOWANCE_EXCEEDED", text: "The AI allowance for this period is used up.", detail: "ALLOWANCE_EXCEEDED" },
  { name: "unlisted code falls back to a sentence of the code", raw: "HTTP 503 · SOMETHING_NEW: Try later.", text: "Something new. Try later.", detail: "HTTP 503 · SOMETHING_NEW: Try later." },
  { name: "ordinary sentence", raw: "Not saved: the server rejected the preference.", text: "Not saved: the server rejected the preference.", detail: null },
  { name: "empty", raw: "", text: "", detail: null },
];

describe("plainAiError", () => {
  it.each(CASES)("$name", ({ raw, text, detail }) => {
    expect(plainAiError(raw)).toEqual({ text, detail });
  });

  it("never loses the raw text and never drops the server's no-fallback sentence", () => {
    for (const { raw } of CASES.filter((item) => item.raw.includes("No other provider"))) {
      const result = plainAiError(raw);
      expect(result.text).toContain("No other provider, model or credential source was used.");
      expect(result.detail).toBe(raw);
    }
  });

  it("is null-safe", () => {
    expect(plainAiError(null)).toEqual({ text: "", detail: null });
    expect(plainAiError(undefined)).toEqual({ text: "", detail: null });
  });
});
