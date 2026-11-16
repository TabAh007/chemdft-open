import type { Metadata } from "next";
import { isLocale, usesEnglishFallback } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { createPublicMetadata } from "@/lib/seo";

import { PublicDocShell } from "../../_components/public-doc/public-doc-shell";
import { ContactForm } from "./contact-form";

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "Contact the ChemDFT scientific team | ChemDFT",
    description:
      "Get in touch with the ChemDFT engineering team to ask technical questions, propose scientific collaborations, or report issues directly.",
    path: "/en/contact",
  });
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const showEnglishNotice = usesEnglishFallback(locale);

  return (
    <PublicDocShell locale={locale} active="none">
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 0" }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: "24px", fontWeight: 700, margin: "0 0 8px 0", color: "var(--cdf-ink, #0f172a)" }}>
            Contact ChemDFT
          </h1>
          <p style={{ fontSize: "14.5px", color: "var(--cdf-ink-muted, #475569)", margin: 0, lineHeight: 1.5 }}>
            Ask a question, propose research collaboration, or discuss partnerships with the ChemDFT engineering team. Messages are delivered directly to the ChemDFT team (<a href="mailto:tab@chemdft.com" style={{ color: "#2563eb", textDecoration: "underline" }}>tab@chemdft.com</a>).
          </p>
        </header>

        {showEnglishNotice ? (
          <div
            role="note"
            style={{
              padding: "10px 14px",
              background: "#f8fafc",
              border: "1px solid #cbd5e1",
              borderRadius: "4px",
              fontSize: "12.5px",
              color: "#475569",
              marginBottom: "20px",
            }}
          >
            Notice: This page is provided in English. In the event of any conflict or inconsistency, the English version applies.
          </div>
        ) : null}

        <ContactForm locale={locale} />
      </div>
    </PublicDocShell>
  );
}

