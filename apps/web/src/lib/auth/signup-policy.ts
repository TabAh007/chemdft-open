import { createHash } from "node:crypto";

import { isDisposableEmailDomain } from "./disposable-domains.ts";

/**
 * The version of the Terms of Use and Privacy Policy a new account accepts. Bump it when either text
 * changes. While the documents are marked DRAFT the version says so; the owner removes "-draft" with the
 * approval of the final text.
 */
export const TERMS_VERSION = "2026-11-10";

export const SIGNUP_LIMITS = {
  /** Sign-up requests per IP per hour (Better Auth rate limiter, shared database storage). */
  perIpWindowSeconds: 3600,
  perIpMax: 5,
  /** Verification / reset emails per address per hour (own counter, see `consumeEmailAllowance`). */
  perEmailWindowSeconds: 3600,
  perEmailMax: 3,
} as const;

export type SignupRefusal = "invalid_email" | "disposable_email" | "terms_not_accepted" | "rate_limited_email";

export function emailDomain(email: string): string | null {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  return at > 0 && at < email.length - 1 ? email.trim().toLowerCase().slice(at + 1) : null;
}

export function checkSignupInput(input: { email: string; termsAccepted: unknown }): SignupRefusal | null {
  const domain = emailDomain(input.email);
  if (!domain || !domain.includes(".")) return "invalid_email";
  if (isDisposableEmailDomain(domain)) return "disposable_email";
  if (input.termsAccepted !== true) return "terms_not_accepted";
  return null;
}

/** A stable, non-reversible reference for logs: never the address itself. */
export function hashRef(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export type SignupEvent = { event: "signup" | "verification_sent" | "reset_requested" | "signup_existing_email"; outcome: "ACCEPTED" | "REFUSED"; reason?: string; emailRef: string; ipRef?: string };

/** Signup attempt audit event: one structured line (Vercel runtime log), no address, no IP, no free text. */
export function logSignupEvent(event: SignupEvent, sink: (line: string) => void = (line) => console.info(line)): void {
  sink(JSON.stringify({ chemdft_audit: "signup", at: new Date().toISOString(), ...event }));
}

/**
 * Per-address allowance, stored in Better Auth's own rate-limit table so it is shared across serverless
 * instances. Returns false once the address used `perEmailMax` messages inside the window.
 */
export async function consumeEmailAllowance(
  adapter: { findOne: (q: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>; create: (q: { model: string; data: Record<string, unknown> }) => Promise<unknown>; update: (q: { model: string; where: { field: string; value: unknown }[]; update: Record<string, unknown> }) => Promise<unknown> },
  email: string,
  now: number = Date.now(),
): Promise<boolean> {
  const key = `chemdft-email:${hashRef(email)}`;
  const where = [{ field: "key", value: key }];
  const row = (await adapter.findOne({ model: "rateLimit", where })) as { count: number; lastRequest: number | string | bigint } | null;
  const windowMs = SIGNUP_LIMITS.perEmailWindowSeconds * 1000;
  if (!row || now - Number(row.lastRequest) > windowMs) {
    if (row) await adapter.update({ model: "rateLimit", where, update: { count: 1, lastRequest: now } });
    else await adapter.create({ model: "rateLimit", data: { key, count: 1, lastRequest: now } });
    return true;
  }
  if (row.count >= SIGNUP_LIMITS.perEmailMax) return false;
  await adapter.update({ model: "rateLimit", where, update: { count: row.count + 1, lastRequest: Number(row.lastRequest) } });
  return true;
}
