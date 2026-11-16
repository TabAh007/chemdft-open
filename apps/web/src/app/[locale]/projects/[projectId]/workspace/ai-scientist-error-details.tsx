"use client";

/** The stored error text behind a plain-language message, kept one click away (never deleted). */
export function AiErrorDetails({ detail }: { detail: string | null | undefined }) {
  if (!detail) return null;
  return (
    <details className="ai-error-details" data-testid="ai-error-details">
      <summary>Details</summary>
      <code>{detail}</code>
    </details>
  );
}
