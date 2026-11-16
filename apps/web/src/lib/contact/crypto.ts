import crypto from "node:crypto";

export class ContactSecretMissingError extends Error {
  constructor(message = "CHEMDFT_CONTACT_HASH_SECRET environment variable is missing.") {
    super(message);
    this.name = "ContactSecretMissingError";
  }
}

/**
 * Computes a keyed HMAC-SHA256 hash of a client IP address.
 * The raw IP is never persisted or logged.
 */
export function hashClientIp(ip: string, secret = process.env.CHEMDFT_CONTACT_HASH_SECRET): string {
  if (!secret || !secret.trim()) {
    throw new ContactSecretMissingError();
  }
  return crypto.createHmac("sha256", secret.trim()).update(ip.trim()).digest("hex");
}

/**
 * Extracts the connecting client IP address from trusted headers.
 * Documented header priority:
 * 1. x-vercel-forwarded-for: trusted header set by Vercel's edge proxy containing verified client IP.
 * 2. x-real-ip: standard proxy client IP header.
 * 3. x-forwarded-for: comma-separated list of proxies; first entry is the original client.
 * 4. Fallback: "127.0.0.1"
 */
export function getClientIp(headers: Headers): string {
  const vercelForwarded = headers.get("x-vercel-forwarded-for");
  if (vercelForwarded && vercelForwarded.trim()) {
    return vercelForwarded.split(",")[0]!.trim();
  }

  const realIp = headers.get("x-real-ip");
  if (realIp && realIp.trim()) {
    return realIp.split(",")[0]!.trim();
  }

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor && forwardedFor.trim()) {
    return forwardedFor.split(",")[0]!.trim();
  }

  return "127.0.0.1";
}

/**
 * Strips Carriage Return (\r) and Line Feed (\n) characters to prevent header injection.
 */
export function stripCrLf(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").trim();
}

/**
 * Neutralizes HTML characters to prevent HTML/XSS injection in rendered email bodies.
 */
export function htmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

