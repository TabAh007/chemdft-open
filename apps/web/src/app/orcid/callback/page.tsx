import type { Metadata } from "next";

import { OrcidCallback } from "./orcid-callback";

export const metadata: Metadata = { title: "ORCID", robots: { index: false, follow: false } };

// Registered with ORCID exactly as /orcid/callback (not localized): https://chemdft.com/orcid/callback.
export default function OrcidCallbackPage() {
  return (
    <main id="main-content" className="projects-main auth-main">
      <section className="auth-card" aria-labelledby="orcid-callback-title">
        <h1 id="orcid-callback-title">ORCID</h1>
        <OrcidCallback />
      </section>
    </main>
  );
}
