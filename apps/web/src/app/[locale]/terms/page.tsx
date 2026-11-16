import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { createPublicMetadata } from "@/lib/seo";

import { TermsView } from "../../_components/public-doc/legal-views";
import { PublicDocShell } from "../../_components/public-doc/public-doc-shell";

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "Terms of use for the beta platform | ChemDFT",
    description:
      "Review the terms and conditions governing researcher access, compute usage limits, and account policies on the ChemDFT computational platform.",
    path: "/en/terms",
  });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <PublicDocShell locale={locale} active="none">
      <TermsView locale={locale} />
    </PublicDocShell>
  );
}
