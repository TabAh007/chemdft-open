import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SITE_URL } from "@/lib/site";
import "ketcher-react/dist/index.css";
import "./globals.css";
import "./landing.css";
import "./shell.css";
import "./external-import.css";
import "./experimental-spectra.css";
import "./auth.css";
import "./ai-scientist.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "ChemDFT",
    template: "%s | ChemDFT",
  },
  description: "A provenance-first scientific workstation for computational chemistry.",
  openGraph: {
    type: "website",
    siteName: "ChemDFT",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
