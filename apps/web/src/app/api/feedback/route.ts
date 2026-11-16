import { type NextRequest } from "next/server";

import { isUserDisabled } from "../../../lib/auth/owner.ts";
import { getAuth } from "../../../lib/auth/server.ts";
import { getSession } from "../../../lib/auth/session.ts";
import { FeedbackTableMissingError } from "../../../lib/feedback/db.ts";
import { FeedbackMailerNotConfiguredError } from "../../../lib/feedback/mailer.ts";
import {
  FeedbackRateLimitedError,
  FeedbackValidationError,
  submitFeedback,
} from "../../../lib/feedback/service.ts";
import type { FeedbackAttachment, FeedbackType } from "../../../lib/feedback/types.ts";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Session authentication
  const session = await getSession(request.headers);
  if (!session?.user) {
    return Response.json({ error: "unauthorized", message: "Sign in required to submit feedback." }, { status: 401 });
  }

  // 2. Reject disabled accounts
  try {
    const { auth } = await getAuth();
    const context = await auth.$context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = context.adapter as any;
    const disabled = await isUserDisabled(adapter, session.user.id);
    if (disabled) {
      return Response.json({ error: "account_disabled", message: "This account has been disabled." }, { status: 403 });
    }
  } catch {
    console.error("[chemdft-feedback] disabled-check-failed");
    return Response.json(
      { error: "service_unavailable", code: "FEEDBACK_UNAVAILABLE", message: "Feedback is temporarily unavailable." },
      { status: 503 },
    );
  }

  // 3. Parse multipart payload
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "invalid_form", message: "Expected multipart/form-data body." }, { status: 400 });
  }

  const type = (formData.get("type") as FeedbackType) || "not_working";
  const title = (formData.get("title") as string) || "";
  const details = (formData.get("details") as string) || "";
  const replyConsentRaw = formData.get("replyConsent");
  const replyConsent = replyConsentRaw === "true" || replyConsentRaw === "1" || replyConsentRaw === "on";
  const pagePath = (formData.get("pagePath") as string) || "/feedback";
  const locale = (formData.get("locale") as string) || "en";

  const attachments: FeedbackAttachment[] = [];
  const files = formData.getAll("files");

  for (const item of files) {
    if (item instanceof File && item.size > 0) {
      const arrayBuffer = await item.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      attachments.push({
        filename: item.name,
        content: buffer.toString("base64"),
        contentType: item.type || "application/octet-stream",
        sizeBytes: item.size,
      });
    }
  }

  // 4. Submit feedback through service
  try {
    const result = await submitFeedback({
      userId: session.user.id,
      userEmail: session.user.email,
      type,
      title,
      details,
      replyConsent,
      pagePath,
      locale,
      userAgent: request.headers.get("user-agent") || undefined,
      attachments,
    });

    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof FeedbackTableMissingError) {
      return Response.json(
        { error: "service_unavailable", code: "FEEDBACK_UNAVAILABLE", message: "Feedback is temporarily unavailable." },
        { status: 503 },
      );
    }
    if (err instanceof FeedbackMailerNotConfiguredError) {
      return Response.json(
        { error: "service_unavailable", code: "MAILER_NOT_CONFIGURED", message: "Feedback delivery is temporarily unavailable." },
        { status: 503 },
      );
    }
    if (err instanceof FeedbackValidationError) {
      const status = err.code === "TOO_LARGE" ? 413 : 400;
      return Response.json({ error: err.code.toLowerCase(), code: err.code, message: err.message }, { status });
    }
    if (err instanceof FeedbackRateLimitedError) {
      return Response.json({ error: "rate_limited", code: "RATE_LIMITED", message: err.message }, { status: 429 });
    }

    console.error("[chemdft-feedback] delivery failure", err);
    return Response.json(
      { error: "delivery_failed", code: "DELIVERY_FAILED", message: "We could not deliver your report. Please try again in a minute." },
      { status: 500 },
    );
  }
}
