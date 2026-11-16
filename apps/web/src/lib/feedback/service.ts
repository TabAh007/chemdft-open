/**
 * Feedback service: validation, limits, rate-capping, email preparation,
 * and database lifecycle management.
 */

import { randomUUID } from "node:crypto";
import {
  ALLOWED_EXTENSIONS,
  DEFAULT_FEEDBACK_DAILY_CAP,
  DEFAULT_FEEDBACK_MINUTE_LIMIT,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPES,
  MAX_TITLE_LENGTH,
  MAX_TOTAL_ATTACHMENT_BYTES,
  MIN_TITLE_LENGTH,
  REJECTED_EXTENSIONS,
  type CreateFeedbackInput,
  type FeedbackAttachment,
  type FeedbackReportRecord,
  type FeedbackSubmissionResult,
} from "./types.ts";
import {
  countUserReportsInWindow,
  insertPendingFeedbackReport,
  updateFeedbackReportStatus,
} from "./db.ts";
import { getFeedbackMailer, FeedbackDeliveryError } from "./mailer.ts";
import { formatAttachmentSize } from "./format.ts";
import { LATEST_VERSION } from "@/content/releases";

export { formatAttachmentSize } from "./format.ts";

export const APP_VERSION = LATEST_VERSION;

export class FeedbackValidationError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FeedbackValidationError";
    this.code = code;
  }
}

export class FeedbackRateLimitedError extends Error {
  public readonly code = "rate_limited";
  constructor(message = "Rate limit exceeded. Please wait before submitting more feedback.") {
    super(message);
    this.name = "FeedbackRateLimitedError";
  }
}

/**
 * Sanitize attachment file names:
 * - Strip directory traversals (/ or \)
 * - Strip control characters
 * - Cap length to 100 characters while preserving extension
 */
export function sanitizeFilename(rawName: string, index = 0): string {
  if (!rawName || typeof rawName !== "string") {
    return `attachment_${index}.dat`;
  }

  // Strip path prefixes
  let clean = rawName.replace(/^[a-zA-Z]:[/\\]/, "").replace(/^.*[/\\]/, "");
  // Strip control chars
  clean = clean.replace(/[\x00-\x1f\x7f]/g, "").trim();

  if (!clean) {
    return `attachment_${index}.dat`;
  }

  const dotIdx = clean.lastIndexOf(".");
  if (dotIdx > 0) {
    const base = clean.slice(0, dotIdx);
    const ext = clean.slice(dotIdx + 1);
    if (base.length > 80) {
      clean = `${base.slice(0, 80)}.${ext}`;
    }
  } else if (clean.length > 80) {
    clean = clean.slice(0, 80);
  }

  return clean;
}

/**
 * Inspects a file extension and content to prevent script/executable uploads.
 * Gaussian inputs often use .com; MS-DOS executables also use .com.
 * We inspect extension, MIME type, and binary header content.
 */
export function validateAttachmentType(filename: string, contentType: string, base64Content: string) {
  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx >= 0 ? filename.slice(dotIdx + 1).toLowerCase() : "";

  if (REJECTED_EXTENSIONS.has(ext)) {
    throw new FeedbackValidationError("REJECTED_FILE_TYPE", `Executable and script files (.${ext}) are not allowed.`);
  }

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new FeedbackValidationError("INVALID_FILE_TYPE", `File type .${ext || "unknown"} is not allowed.`);
  }

  // Special rule for .com files:
  if (ext === "com") {
    const isDosExecutableMime =
      contentType.includes("x-msdownload") ||
      contentType.includes("x-dosexec") ||
      contentType.includes("octet-stream");

    // Decode first 256 bytes to inspect binary vs ASCII text
    const sampleBytes = Buffer.from(base64Content.slice(0, 512), "base64");
    let isBinary = false;
    for (let i = 0; i < Math.min(sampleBytes.length, 256); i++) {
      const byte = sampleBytes[i];
      // Check for DOS MZ header or non-printable binary chars (excluding CR, LF, TAB)
      if (byte !== undefined && (byte === 0 || (byte < 9 && byte !== 0) || (byte > 13 && byte < 32))) {
        isBinary = true;
        break;
      }
    }

    if (isDosExecutableMime && isBinary) {
      throw new FeedbackValidationError(
        "REJECTED_FILE_TYPE",
        "The attached .com file appears to be an executable rather than a Gaussian text input.",
      );
    }
  }
}

/** Strip CRLF from single-line headers to prevent email header injection */
export function stripHeaderInjection(val: string): string {
  return val.replace(/[\r\n\t]/g, " ").trim();
}

/** Simple HTML entity escaping */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function submitFeedback(
  input: CreateFeedbackInput,
  env: Record<string, string | undefined> = process.env,
): Promise<FeedbackSubmissionResult> {
  // 1. Validate fields
  if (!FEEDBACK_TYPES.includes(input.type)) {
    throw new FeedbackValidationError("TYPE_INVALID", "Invalid feedback type.");
  }

  const title = input.title ? input.title.trim() : "";
  if (title.length < MIN_TITLE_LENGTH) {
    throw new FeedbackValidationError("EMPTY_TITLE", "Title cannot be empty.");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new FeedbackValidationError("TITLE_TOO_LONG", `Title cannot exceed ${MAX_TITLE_LENGTH} characters.`);
  }

  const details = input.details ? input.details.trim() : "";
  if (details.length < 1) {
    throw new FeedbackValidationError("EMPTY_DETAILS", "Details cannot be empty.");
  }

  const attachments: FeedbackAttachment[] = (input.attachments || []).map((att, i) => {
    const cleanName = sanitizeFilename(att.filename, i);
    validateAttachmentType(cleanName, att.contentType, att.content);
    return {
      filename: cleanName,
      content: att.content,
      contentType: att.contentType,
      sizeBytes: att.sizeBytes,
    };
  });

  const totalBytes = attachments.reduce((sum, a) => sum + a.sizeBytes, 0);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new FeedbackValidationError("TOO_LARGE", "Total attachments exceed the 4 MB limit.");
  }

  // 2. Enforce Rate Limits
  const dailyCap = Number(env.CHEMDFT_FEEDBACK_DAILY_CAP) || DEFAULT_FEEDBACK_DAILY_CAP;
  const reportsLast24h = await countUserReportsInWindow(input.userId, 24 * 60 * 60 * 1000);
  if (reportsLast24h >= dailyCap) {
    throw new FeedbackRateLimitedError(`Daily limit of ${dailyCap} reports per 24 hours reached. Please wait before submitting again.`);
  }

  const minuteLimit = Number(env.CHEMDFT_FEEDBACK_MINUTE_LIMIT) || DEFAULT_FEEDBACK_MINUTE_LIMIT;
  const reportsLastMinute = await countUserReportsInWindow(input.userId, 60 * 1000);
  if (reportsLastMinute >= minuteLimit) {
    throw new FeedbackRateLimitedError("Too many reports in a short time. Please wait a minute before submitting again.");
  }

  // 3. Resolve Mailer BEFORE Database Insert (prevent stale pending rows on unconfigured mailer)
  const mailer = getFeedbackMailer(env);

  // 4. Insert Pending Database Record
  const reportId = randomUUID();
  const createdAt = new Date().toISOString();

  const reportRecord: Omit<FeedbackReportRecord, "providerMessageId" | "errorCode" | "sentAt"> = {
    id: reportId,
    userId: input.userId,
    type: input.type,
    title,
    details,
    status: "pending",
    replyConsent: Boolean(input.replyConsent),
    pagePath: input.pagePath || "/feedback",
    locale: input.locale || "en",
    appVersion: APP_VERSION,
    attachmentCount: attachments.length,
    attachmentBytes: totalBytes,
    createdAt,
  };

  await insertPendingFeedbackReport(reportRecord);

  // 5. Construct Email
  const toAddress = stripHeaderInjection(env.CHEMDFT_FEEDBACK_TO || "tab@chemdft.com");
  const fromAddress = stripHeaderInjection(env.CHEMDFT_FEEDBACK_FROM || "ChemDFT Feedback <feedback@chemdft.com>");
  const cleanTitle = stripHeaderInjection(title);
  const typeLabel = FEEDBACK_TYPE_LABELS[input.type] || input.type;
  const subject = `[ChemDFT feedback] ${typeLabel}: ${cleanTitle}`;

  const cleanEmail = stripHeaderInjection(input.userEmail);
  const replyTo = input.replyConsent && cleanEmail ? cleanEmail : null;

  const attachmentListText =
    attachments.length === 0
      ? "None"
      : attachments.map((a) => `${a.filename} (${formatAttachmentSize(a.sizeBytes)})`).join(", ");

  const textBody = `${details}

--------------------------------------------------
Feedback Metadata:
Report ID: ${reportId}
Type: ${typeLabel} (${input.type})
User ID: ${input.userId}
Account Email: ${cleanEmail}
Reply Consent: ${input.replyConsent ? "YES" : "NO"}
App Version: ${APP_VERSION}
Locale: ${input.locale}
Page Path: ${input.pagePath}
User Agent: ${input.userAgent || "Unknown"}
Submitted: ${createdAt} (UTC)
Attachments: ${attachmentListText}
`;

  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1c2127; line-height: 1.5; padding: 20px;">
  <div style="max-width: 680px; margin: 0 auto; background: #ffffff; border: 1px solid #d8e1e8; border-radius: 8px; padding: 24px;">
    <h2 style="margin-top: 0; color: #106ba3; font-size: 20px;">[${escapeHtml(typeLabel)}] ${escapeHtml(cleanTitle)}</h2>
    <div style="white-space: pre-wrap; font-size: 15px; margin-bottom: 24px; padding: 16px; background: #f6f8fa; border-radius: 6px; border: 1px solid #ebf1f5;">
${escapeHtml(details)}
    </div>

    <hr style="border: none; border-top: 1px solid #ebf1f5; margin: 20px 0;" />
    <h3 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #5c7080;">Submission Metadata</h3>
    <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
      <tr><td style="padding: 4px 8px; color: #5c7080; width: 140px;">Report ID:</td><td style="padding: 4px 8px;"><code>${escapeHtml(reportId)}</code></td></tr>
      <tr><td style="padding: 4px 8px; color: #5c7080;">User ID:</td><td style="padding: 4px 8px;"><code>${escapeHtml(input.userId)}</code></td></tr>
      <tr><td style="padding: 4px 8px; color: #5c7080;">Account Email:</td><td style="padding: 4px 8px;"><strong>${escapeHtml(cleanEmail)}</strong></td></tr>
      <tr><td style="padding: 4px 8px; color: #5c7080;">Reply Consent:</td><td style="padding: 4px 8px;">${input.replyConsent ? "<strong>YES</strong> (Reply-To set)" : "NO"}</td></tr>
      <tr><td style="padding: 4px 8px; color: #5c7080;">App Version:</td><td style="padding: 4px 8px;">${escapeHtml(APP_VERSION)}</td></tr>
      <tr><td style="padding: 4px 8px; color: #5c7080;">Locale / Page:</td><td style="padding: 4px 8px;">${escapeHtml(input.locale)} &middot; ${escapeHtml(input.pagePath)}</td></tr>
      <tr><td style="padding: 4px 8px; color: #5c7080;">User Agent:</td><td style="padding: 4px 8px;">${escapeHtml(input.userAgent || "Unknown")}</td></tr>
      <tr><td style="padding: 4px 8px; color: #5c7080;">UTC Timestamp:</td><td style="padding: 4px 8px;">${escapeHtml(createdAt)}</td></tr>
      <tr><td style="padding: 4px 8px; color: #5c7080;">Attachments:</td><td style="padding: 4px 8px;">${escapeHtml(attachmentListText)}</td></tr>
    </table>
  </div>
</body>
</html>`;

  // 6. Send via Mailer and Update DB status
  try {
    const sendResult = await mailer.send({
      to: toAddress,
      from: fromAddress,
      replyTo,
      subject,
      text: textBody,
      html: htmlBody,
      attachments,
    });

    const sentAt = new Date().toISOString();
    await updateFeedbackReportStatus(reportId, "sent", {
      providerMessageId: sendResult.messageId,
      sentAt,
    });

    return {
      ok: true,
      reportId,
      attachmentCount: attachments.length,
      replyConsent: Boolean(input.replyConsent),
    };
  } catch (error) {
    const errorCode = error instanceof FeedbackDeliveryError ? error.errorCode : "DELIVERY_ERROR";
    console.error(`[chemdft-feedback] delivery failure report=${reportId} code=${errorCode}`);

    await updateFeedbackReportStatus(reportId, "failed", {
      errorCode,
    });

    throw error;
  }
}
