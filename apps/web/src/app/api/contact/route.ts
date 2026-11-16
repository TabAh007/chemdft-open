import { type NextRequest } from "next/server";

import { getClientIp } from "../../../lib/contact/crypto.ts";
import {
  ContactRateLimitedError,
  ContactUnavailableError,
  ContactValidationError,
  submitContactMessage,
} from "../../../lib/contact/service.ts";
import {
  MAX_BODY_BYTES,
  type ContactSubmissionInput,
  type ContactTopic,
} from "../../../lib/contact/types.ts";

export const runtime = "nodejs";

function checkSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Non-browser or direct requests without Origin header
    return true;
  }

  try {
    const originUrl = new URL(origin);
    const hostHeader = request.headers.get("x-forwarded-host") || request.headers.get("host");
    if (!hostHeader) return true;

    // Compare origin hostname to host header (strip port if matching standard)
    const hostName = hostHeader.split(":")[0]?.toLowerCase();
    const originHost = originUrl.hostname.toLowerCase();
    return hostName === originHost;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  // 1. CSRF same-origin check
  if (!checkSameOrigin(request)) {
    return Response.json(
      { error: "forbidden", code: "CSRF_FAILED", message: "Cross-site request forgery protection triggered." },
      { status: 403 },
    );
  }

  // 2. Body size check (cap ~16 KB)
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json(
      { error: "too_large", code: "PAYLOAD_TOO_LARGE", message: "Payload exceeds 16 KB size limit." },
      { status: 413 },
    );
  }

  // 3. Parse JSON or FormData payload
  let rawBody: Record<string, unknown>;
  const contentType = request.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) {
        return Response.json(
          { error: "too_large", code: "PAYLOAD_TOO_LARGE", message: "Payload exceeds 16 KB size limit." },
          { status: 413 },
        );
      }
      rawBody = JSON.parse(text);
    } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const entries: Record<string, unknown> = {};
      formData.forEach((val, key) => {
        entries[key] = typeof val === "string" ? val : "";
      });
      rawBody = entries;
    } else {
      return Response.json(
        { error: "unsupported_media_type", code: "UNSUPPORTED_MEDIA_TYPE", message: "Supported Content-Type: application/json or form-data." },
        { status: 415 },
      );
    }
  } catch {
    return Response.json(
      { error: "invalid_body", code: "INVALID_BODY", message: "Could not parse request body." },
      { status: 400 },
    );
  }

  // 4. Extract fields
  const name = String(rawBody.name || "");
  const email = String(rawBody.email || "");
  const organisation = rawBody.organisation ? String(rawBody.organisation) : undefined;
  const topic = String(rawBody.topic || "") as ContactTopic;
  const message = String(rawBody.message || "");
  const consent = rawBody.consent === true || rawBody.consent === "true" || rawBody.consent === "1" || rawBody.consent === "on";
  const turnstileToken = String(rawBody.turnstileToken || "");
  const website = rawBody.website ? String(rawBody.website) : undefined;
  const renderedAt = typeof rawBody.renderedAt === "number" ? rawBody.renderedAt : parseInt(String(rawBody.renderedAt || "0"), 10);
  const locale = rawBody.locale ? String(rawBody.locale) : "en";
  const ip = getClientIp(request.headers);

  const input: ContactSubmissionInput = {
    name,
    email,
    organisation,
    topic,
    message,
    consent,
    turnstileToken,
    website,
    renderedAt,
    locale,
    ip,
  };

  // 5. Submit through service
  try {
    const result = await submitContactMessage(input);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ContactUnavailableError) {
      return Response.json(
        {
          error: "service_unavailable",
          code: "CONTACT_UNAVAILABLE",
          message: "The form is temporarily unavailable. Please email tab@chemdft.com.",
        },
        { status: 503 },
      );
    }
    if (err instanceof ContactValidationError) {
      return Response.json(
        { error: "validation_failed", code: err.code, message: err.message },
        { status: 400 },
      );
    }
    if (err instanceof ContactRateLimitedError) {
      return Response.json(
        { error: "rate_limited", code: err.code, message: err.message },
        { status: 429 },
      );
    }

    console.error("[chemdft-contact] submit error", err);
    return Response.json(
      {
        error: "delivery_failed",
        code: "DELIVERY_FAILED",
        message: "We could not send your message. Please email tab@chemdft.com.",
      },
      { status: 500 },
    );
  }
}

