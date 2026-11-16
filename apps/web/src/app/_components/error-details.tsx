"use client";

import { useEffect } from "react";

/** Stable log prefix so a captured console line can be found again. Nothing is sent to a server. */
export const BOUNDARY_LOG_PREFIX = "[chemdft-boundary]";

/** Best-effort component name from a React component stack (first frame), or null. */
export function componentNameFromStack(stack: string | undefined | null): string | null {
  if (!stack) return null;
  const match = /\n\s*at\s+([A-Za-z_$][\w$.]*)/.exec(`\n${stack}`);
  return match?.[1] ?? null;
}

export function describeBoundaryError(error: { message?: string; name?: string; stack?: string | undefined; digest?: string | undefined }) {
  return {
    message: error.message || String(error),
    name: error.name || "Error",
    component: componentNameFromStack(error.stack),
    digest: error.digest ?? null,
  };
}

export function ErrorDetails({ error, scope }: { error: { message?: string; name?: string; stack?: string | undefined; digest?: string | undefined }; scope: string }) {
  const info = describeBoundaryError(error);
  useEffect(() => {
    console.error(BOUNDARY_LOG_PREFIX, scope, info.name, info.message, info.component ?? "unknown-component", info.digest ?? "", error.stack ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
  return (
    <details className="error-details" data-testid="error-details">
      <summary>Details</summary>
      <dl>
        <dt>Message</dt><dd data-testid="error-message">{info.message}</dd>
        <dt>Component</dt><dd data-testid="error-component">{info.component ?? "unknown"}</dd>
        <dt>Type</dt><dd>{info.name}</dd>
      </dl>
      <p>Shown only on this screen and in the browser console; nothing is sent anywhere.</p>
    </details>
  );
}
