"use client";

import { ErrorDetails } from "./_components/error-details";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="state-page">
          <div className="state-code" aria-hidden="true">ERR</div>
          <div className="state-copy"><h1>ChemDFT could not start</h1><p>The application shell failed before project data was opened.</p><button className="bp6-button bp6-intent-primary" type="button" onClick={reset}>Try again</button><ErrorDetails error={error} scope="global" /></div>
        </main>
      </body>
    </html>
  );
}
