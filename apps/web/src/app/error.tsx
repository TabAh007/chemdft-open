"use client";

import { StatePage } from "./_components/state-page";
import { ErrorDetails } from "./_components/error-details";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <StatePage details={<ErrorDetails error={error} scope="app" />} code="ERR" title="The workspace could not load" description="The application encountered an unexpected error. Your source files and project records were not modified." actionLabel="Try again" onRetry={reset} />;
}
