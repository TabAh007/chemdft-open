import type { BillingSnapshot } from "@chemdft/schemas";

const API_ROOT = process.env.NEXT_PUBLIC_CHEMDFT_API_ROOT ?? "/api/chemdft";

/** Not called by the UI during the beta: the server creates the billing account row on first read. */
export async function getBillingSnapshot(): Promise<BillingSnapshot> {
  const response = await fetch(`${API_ROOT}/v1/billing`, { cache: "no-store" });
  return readJson<BillingSnapshot>(response);
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `ChemDFT API request failed with ${response.status}`;
    try {
      detail = ((await response.json()) as { detail?: string }).detail ?? detail;
    } catch {
      /* preserve the status fallback */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}
