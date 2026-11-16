import crypto from "node:crypto";

import { LATEST_VERSION } from "@/content/releases";
import { emailDomain } from "../auth/signup-policy.ts";
import { isDisposableEmailDomain } from "../auth/disposable-domains.ts";
import { FeedbackMailerNotConfiguredError, getFeedbackMailer, type FeedbackMailer } from "../feedback/mailer.ts";
import {
  ContactTableMissingError,
  countRecentGlobalMessages,
  countRecentMessagesByIpHash,
  insertPendingContactMessage,
  purgeOldContactMessages,
  updateContactMessageStatus,
} from "./db.ts";
import {
  ContactSecretMissingError,
  hashClientIp,
  htmlEscape,
  stripCrLf,
} from "./crypto.ts";
import {
  TurnstileKeysMissingError,
  TurnstileVerificationUnavailableError,
  verifyTurnstileToken,
} from "./turnstile.ts";
import {
  CONTACT_TOPICS,
  DEFAULT_CONTACT_DAILY_CAP,
  MAX_EMAIL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_ORGANISATION_LENGTH,
  MAX_URL_COUNT,
  MIN_FILL_TIME_MS,
  MIN_MESSAGE_LENGTH,
  PURGE_BATCH_LIMIT,
  RATE_LIMIT_10_MIN,
  RATE_LIMIT_24_HR,
  RETENTION_DAYS,
  type ContactSubmissionInput,
  type ContactSubmissionResult,
} from "./types.ts";

export class ContactValidationError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ContactValidationError";
    this.code = code;
  }
}

export class ContactRateLimitedError extends Error {
  public readonly code = "RATE_LIMITED";
  constructor(message = "Too many requests. Please try again later.") {
    super(message);
    this.name = "ContactRateLimitedError";
  }
}

export class ContactUnavailableError extends Error {
  public readonly code = "CONTACT_UNAVAILABLE" as const;
  constructor(message = "Contact form is temporarily unavailable. Please email tab@chemdft.com.", code = "CONTACT_UNAVAILABLE" as const) {
    super(message);
    this.name = "ContactUnavailableError";
    this.code = code;
  }
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+/gi;

export function isDisposableEmail(email: string): boolean {
  const domain = emailDomain(email);
  return domain ? isDisposableEmailDomain(domain) : false;
}

export function validateContactInput(input: ContactSubmissionInput): void {
  // Name
  if (!input.name || !input.name.trim()) {
    throw new ContactValidationError("INVALID_NAME", "Please provide your name.");
  }
  if (input.name.trim().length > MAX_NAME_LENGTH) {
    throw new ContactValidationError("NAME_TOO_LONG", `Name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  }

  // Email
  if (!input.email || !input.email.trim()) {
    throw new ContactValidationError("INVALID_EMAIL", "Please provide your email address.");
  }
  const cleanEmail = input.email.trim().toLowerCase();
  if (cleanEmail.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(cleanEmail)) {
    throw new ContactValidationError("INVALID_EMAIL", "Please provide a valid email address.");
  }
  if (isDisposableEmail(cleanEmail)) {
    throw new ContactValidationError("DISPOSABLE_EMAIL", "Please provide a permanent email address (disposable domains are not accepted).");
  }

  // Organisation (optional)
  if (input.organisation && input.organisation.trim().length > MAX_ORGANISATION_LENGTH) {
    throw new ContactValidationError("ORGANISATION_TOO_LONG", `Organisation must be ${MAX_ORGANISATION_LENGTH} characters or fewer.`);
  }

  // Topic
  if (!input.topic || !CONTACT_TOPICS.includes(input.topic)) {
    throw new ContactValidationError("INVALID_TOPIC", "Please select a valid topic.");
  }

  // Message
  if (!input.message || !input.message.trim()) {
    throw new ContactValidationError("INVALID_MESSAGE", "Please write a message.");
  }
  const msgTrimmed = input.message.trim();
  if (msgTrimmed.length < MIN_MESSAGE_LENGTH) {
    throw new ContactValidationError("MESSAGE_TOO_SHORT", `Message must be at least ${MIN_MESSAGE_LENGTH} characters.`);
  }
  if (msgTrimmed.length > MAX_MESSAGE_LENGTH) {
    throw new ContactValidationError("MESSAGE_TOO_LONG", `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }

  // Consent
  if (!input.consent) {
    throw new ContactValidationError("CONSENT_REQUIRED", "Consent to receive a reply is required.");
  }

  // Content URL checks
  const urlMatches = msgTrimmed.match(URL_REGEX) || [];
  if (urlMatches.length > MAX_URL_COUNT) {
    throw new ContactValidationError("TOO_MANY_LINKS", `Message may not contain more than ${MAX_URL_COUNT} links.`);
  }
  if (urlMatches.length > 0) {
    const totalUrlLength = urlMatches.reduce((acc, u) => acc + u.length, 0);
    if (totalUrlLength > msgTrimmed.length * 0.5) {
      throw new ContactValidationError("LINK_SPAM", "Message contains too many links relative to text length (link spam).");
    }
  }
}

export async function submitContactMessage(
  input: ContactSubmissionInput,
  env: Record<string, string | undefined> = process.env,
  fetchFn: typeof fetch = fetch,
  mailerOverride?: FeedbackMailer,
): Promise<ContactSubmissionResult> {
  const genericSuccess = {
    ok: true,
    message: "Thank you. Your message has been sent. If you asked for a reply, we usually answer within a few working days.",
  };

  // 1. Honeypot check (hidden field)
  if (input.website && input.website.trim().length > 0) {
    console.warn("[chemdft-contact] honeypot-triggered");
    return genericSuccess;
  }

  // 2. Minimum fill time check (anti-bot)
  const now = Date.now();
  if (!input.renderedAt || typeof input.renderedAt !== "number" || input.renderedAt > now || now - input.renderedAt < MIN_FILL_TIME_MS) {
    console.warn("[chemdft-contact] too-fast-submission");
    return genericSuccess;
  }

  // 3. Field validation
  validateContactInput(input);

  // 4. Turnstile token verification
  try {
    const verifyResult = await verifyTurnstileToken(input.turnstileToken, input.ip, env.TURNSTILE_SECRET_KEY, fetchFn);
    if (!verifyResult.ok) {
      console.warn("[chemdft-contact] turnstile-verification-failed", verifyResult.errorCodes);
      throw new ContactValidationError("TURNSTILE_FAILED", "Verification failed. Please complete the security check.");
    }
  } catch (err) {
    if (err instanceof TurnstileKeysMissingError || err instanceof TurnstileVerificationUnavailableError) {
      console.error("[chemdft-contact] turnstile-fail-closed", err);
      throw new ContactUnavailableError();
    }
    throw err;
  }

  // 5. Rate limiting by HMAC-hashed client IP
  let ipHash: string;
  try {
    ipHash = hashClientIp(input.ip, env.CHEMDFT_CONTACT_HASH_SECRET);
  } catch (err) {
    if (err instanceof ContactSecretMissingError) {
      console.error("[chemdft-contact] hash-secret-missing");
      throw new ContactUnavailableError();
    }
    throw err;
  }

  const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const dailyCap = parseInt(env.CHEMDFT_CONTACT_DAILY_CAP || `${DEFAULT_CONTACT_DAILY_CAP}`, 10);

  try {
    // 3 per 10 minutes
    const recent10m = await countRecentMessagesByIpHash(ipHash, tenMinutesAgo);
    if (recent10m >= RATE_LIMIT_10_MIN) {
      console.warn("[chemdft-contact] rate-limited-10m");
      throw new ContactRateLimitedError("You have sent several messages recently. Please wait a few minutes before trying again.");
    }

    // 5 per day
    const recent24h = await countRecentMessagesByIpHash(ipHash, oneDayAgo);
    if (recent24h >= RATE_LIMIT_24_HR) {
      console.warn("[chemdft-contact] rate-limited-daily");
      throw new ContactRateLimitedError("You have reached the daily message limit. Please try again tomorrow.");
    }

    // Global daily cap
    const global24h = await countRecentGlobalMessages(oneDayAgo);
    if (global24h >= dailyCap) {
      console.warn("[chemdft-contact] global-cap-reached");
      throw new ContactRateLimitedError("The contact service has reached its daily limit. Please email tab@chemdft.com directly.");
    }
  } catch (err) {
    if (err instanceof ContactTableMissingError) {
      console.error("[chemdft-contact] contact-table-missing");
      throw new ContactUnavailableError();
    }
    throw err;
  }

  // 6. Resolve mailer BEFORE any DB insert
  let mailer: FeedbackMailer;
  try {
    mailer = mailerOverride ?? getFeedbackMailer(env, fetchFn);
  } catch (err) {
    if (err instanceof FeedbackMailerNotConfiguredError) {
      console.error("[chemdft-contact] mailer-not-configured");
      throw new ContactUnavailableError();
    }
    throw err;
  }

  // 7. Format email
  const cleanName = stripCrLf(input.name.trim());
  const cleanEmail = stripCrLf(input.email.trim().toLowerCase());
  const cleanOrg = input.organisation ? stripCrLf(input.organisation.trim()) : "";
  const cleanTopic = stripCrLf(input.topic);
  const cleanLocale = stripCrLf(input.locale || "en");
  const appVersion = LATEST_VERSION;
  const submittedAt = new Date().toISOString();

  const toEmail = env.CHEMDFT_CONTACT_TO || "tab@chemdft.com";
  const fromEmail = env.CHEMDFT_CONTACT_FROM || "ChemDFT Contact <feedback@chemdft.com>";
  const subject = `[ChemDFT contact] ${cleanTopic} — ${cleanName}`;

  const textBody = [
    `ChemDFT Contact Message`,
    `=======================`,
    `Topic:        ${cleanTopic}`,
    `From:         ${cleanName} <${cleanEmail}>`,
    cleanOrg ? `Organisation: ${cleanOrg}` : null,
    `Submitted:    ${submittedAt}`,
    `Locale:       ${cleanLocale}`,
    `Page:         /${cleanLocale}/contact`,
    `App Version:  ${appVersion}`,
    ``,
    `Message:`,
    `-----------------------`,
    input.message.trim(),
    `-----------------------`,
  ]
    .filter(Boolean)
    .join("\n");

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8" /></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1e293b; max-width: 640px; margin: 0 auto; padding: 24px;">
      <h2 style="margin-top: 0; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">[ChemDFT Contact] ${htmlEscape(cleanTopic)}</h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
        <tr><td style="padding: 4px 8px; font-weight: bold; width: 120px; color: #475569;">From:</td><td style="padding: 4px 8px;">${htmlEscape(cleanName)} &lt;<a href="mailto:${htmlEscape(cleanEmail)}">${htmlEscape(cleanEmail)}</a>&gt;</td></tr>
        ${cleanOrg ? `<tr><td style="padding: 4px 8px; font-weight: bold; color: #475569;">Organisation:</td><td style="padding: 4px 8px;">${htmlEscape(cleanOrg)}</td></tr>` : ""}
        <tr><td style="padding: 4px 8px; font-weight: bold; color: #475569;">Topic:</td><td style="padding: 4px 8px;">${htmlEscape(cleanTopic)}</td></tr>
        <tr><td style="padding: 4px 8px; font-weight: bold; color: #475569;">Submitted:</td><td style="padding: 4px 8px;">${submittedAt}</td></tr>
        <tr><td style="padding: 4px 8px; font-weight: bold; color: #475569;">Locale / Page:</td><td style="padding: 4px 8px;">/${htmlEscape(cleanLocale)}/contact (v${appVersion})</td></tr>
      </table>
      <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 16px; white-space: pre-wrap; font-size: 14px; color: #0f172a;">${htmlEscape(input.message.trim())}</div>
    </body>
    </html>
  `.trim();

  // 8. Insert pending tracking row (zero PII stored)
  const messageId = crypto.randomUUID();
  try {
    await insertPendingContactMessage({
      id: messageId,
      topic: input.topic,
      status: "pending",
      ipHash,
      locale: cleanLocale,
      appVersion,
      createdAt: submittedAt,
    });
  } catch (err) {
    if (err instanceof ContactTableMissingError) {
      console.error("[chemdft-contact] table-missing-on-insert");
      throw new ContactUnavailableError();
    }
    throw err;
  }

  // 9. Send email
  try {
    const sendResult = await mailer.send({
      to: toEmail,
      from: fromEmail,
      replyTo: cleanEmail,
      subject,
      text: textBody,
      html: htmlBody,
    });

    await updateContactMessageStatus(messageId, "sent", sendResult.messageId);
  } catch (deliveryErr) {
    const errorCode = deliveryErr instanceof Error ? deliveryErr.name : "DELIVERY_ERROR";
    console.error("[chemdft-contact] delivery-failure", deliveryErr);
    await updateContactMessageStatus(messageId, "failed", null, errorCode).catch(() => {});
    throw new Error("We could not send your message. Please email tab@chemdft.com.");
  }

  // 10. Opportunistic purge older than 90 days (bounded, never blocks)
  try {
    const purgeThreshold = new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await purgeOldContactMessages(purgeThreshold, PURGE_BATCH_LIMIT);
  } catch (purgeErr) {
    console.warn("[chemdft-contact] opportunistic-purge-failed", purgeErr);
  }

  return genericSuccess;
}
