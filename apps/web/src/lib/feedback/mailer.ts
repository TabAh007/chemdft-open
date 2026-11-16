/**
 * Provider-neutral email transport for in-app feedback.
 *
 * Implements Resend via HTTPS fetch (no heavy SDK).
 * Includes an in-memory FakeFeedbackMailer for automated tests.
 */

import type { FeedbackAttachment } from "./types";

export interface FeedbackEmailPayload {
  to: string;
  from: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  html: string;
  attachments?: FeedbackAttachment[];
}

export interface FeedbackSendResult {
  messageId: string;
}

export interface FeedbackMailer {
  send(payload: FeedbackEmailPayload): Promise<FeedbackSendResult>;
}

export class FeedbackMailerNotConfiguredError extends Error {
  constructor(message = "Feedback email delivery is not configured.") {
    super(message);
    this.name = "FeedbackMailerNotConfiguredError";
  }
}

export class FeedbackDeliveryError extends Error {
  public readonly errorCode: string;
  constructor(errorCode: string, message = "Failed to deliver feedback email.") {
    super(message);
    this.name = "FeedbackDeliveryError";
    this.errorCode = errorCode;
  }
}

/**
 * Resend email mailer implementation using native fetch over HTTPS.
 * Never logs API keys, message bodies, or attachment content.
 */
export class ResendFeedbackMailer implements FeedbackMailer {
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(apiKey: string, fetchFn: typeof fetch = fetch) {
    if (!apiKey || !apiKey.trim()) {
      throw new FeedbackMailerNotConfiguredError("RESEND_API_KEY is not configured.");
    }
    this.apiKey = apiKey.trim();
    this.fetchFn = fetchFn;
  }

  async send(payload: FeedbackEmailPayload): Promise<FeedbackSendResult> {
    const body: Record<string, unknown> = {
      from: payload.from,
      to: [payload.to],
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    };

    if (payload.replyTo) {
      body.reply_to = payload.replyTo;
    }

    if (payload.attachments && payload.attachments.length > 0) {
      body.attachments = payload.attachments.map((att) => ({
        filename: att.filename,
        content: att.content, // base64 string
      }));
    }

    let response: Response;
    try {
      response = await this.fetchFn("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "ChemDFT-Feedback/0.0.32",
        },
        body: JSON.stringify(body),
      });
    } catch (networkError) {
      console.error("[chemdft-feedback] delivery network failure");
      throw new FeedbackDeliveryError(
        "NETWORK_ERROR",
        networkError instanceof Error ? networkError.message : "Network error contacting mail provider.",
      );
    }

    if (!response.ok) {
      const status = response.status;
      console.error(`[chemdft-feedback] provider returned HTTP ${status}`);
      throw new FeedbackDeliveryError(`PROVIDER_HTTP_${status}`, `Mail provider returned HTTP ${status}.`);
    }

    try {
      const data = (await response.json()) as { id?: string };
      const messageId = data?.id || `resend_${Date.now()}`;
      return { messageId };
    } catch {
      return { messageId: `resend_ok_${Date.now()}` };
    }
  }
}

/**
 * In-memory test mailer for unit tests. Never sends real emails.
 */
export class FakeFeedbackMailer implements FeedbackMailer {
  public outbox: FeedbackEmailPayload[] = [];
  public shouldFail = false;
  public failErrorCode = "SIMULATED_FAILURE";

  async send(payload: FeedbackEmailPayload): Promise<FeedbackSendResult> {
    if (this.shouldFail) {
      throw new FeedbackDeliveryError(this.failErrorCode, "Simulated delivery failure");
    }
    this.outbox.push(payload);
    return { messageId: `fake_msg_${this.outbox.length}_${Date.now()}` };
  }

  clear() {
    this.outbox = [];
    this.shouldFail = false;
  }
}

// Process-wide fake mailer instance for tests
let globalFakeMailer: FakeFeedbackMailer | null = null;

export function getFakeFeedbackMailer(): FakeFeedbackMailer {
  if (!globalFakeMailer) {
    globalFakeMailer = new FakeFeedbackMailer();
  }
  return globalFakeMailer;
}

export function setGlobalFakeFeedbackMailer(mailer: FakeFeedbackMailer | null) {
  globalFakeMailer = mailer;
}

/**
 * Factory for getting the active feedback mailer.
 */
export function getFeedbackMailer(
  env: Record<string, string | undefined> = process.env,
  fetchFn: typeof fetch = fetch,
): FeedbackMailer {
  // If explicitly configured for test/fake mode
  if (env.CHEMDFT_FEEDBACK_MAILER === "fake" || env.NODE_ENV === "test") {
    if (globalFakeMailer) return globalFakeMailer;
    // If RESEND_API_KEY is not set in test environment, default to fake
    if (!env.RESEND_API_KEY) {
      return getFakeFeedbackMailer();
    }
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new FeedbackMailerNotConfiguredError("RESEND_API_KEY is missing. Feedback email provider is not configured.");
  }

  return new ResendFeedbackMailer(apiKey, fetchFn);
}
