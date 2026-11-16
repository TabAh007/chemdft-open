/**
 * Cloudflare Turnstile server-side token verification.
 * Spec: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

import { LATEST_VERSION } from "@/content/releases";

export class TurnstileKeysMissingError extends Error {
  constructor(message = "TURNSTILE_SECRET_KEY is not configured.") {
    super(message);
    this.name = "TurnstileKeysMissingError";
  }
}

export class TurnstileVerificationUnavailableError extends Error {
  constructor(message = "Turnstile verification service is currently unreachable.") {
    super(message);
    this.name = "TurnstileVerificationUnavailableError";
  }
}

export interface TurnstileVerifyResult {
  ok: boolean;
  errorCodes?: string[] | undefined;
}

export async function verifyTurnstileToken(
  token: string,
  ip?: string,
  secret = process.env.TURNSTILE_SECRET_KEY,
  fetchFn: typeof fetch = fetch,
): Promise<TurnstileVerifyResult> {
  if (!secret || !secret.trim()) {
    throw new TurnstileKeysMissingError();
  }

  if (!token || !token.trim()) {
    return { ok: false, errorCodes: ["missing-input-response"] };
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secret.trim());
    formData.append("response", token.trim());
    if (ip && ip.trim()) {
      formData.append("remoteip", ip.trim());
    }

    const res = await fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": `ChemDFT-Contact/${LATEST_VERSION}`,
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.error(`[chemdft-contact] turnstile verify HTTP ${res.status}`);
      throw new TurnstileVerificationUnavailableError();
    }

    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (!data || typeof data.success !== "boolean") {
      throw new TurnstileVerificationUnavailableError();
    }

    if (!data.success) {
      return { ok: false, errorCodes: data["error-codes"] || ["invalid-input-response"] };
    }

    return { ok: true };
  } catch (err) {
    if (err instanceof TurnstileKeysMissingError) throw err;
    if (err instanceof TurnstileVerificationUnavailableError) throw err;
    console.error("[chemdft-contact] turnstile verify network error", err);
    throw new TurnstileVerificationUnavailableError();
  }
}

