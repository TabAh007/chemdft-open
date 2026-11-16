import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { createPublicMetadata } from "@/lib/seo";

import { PublicDocShell } from "../../_components/public-doc/public-doc-shell";
import { ValidationView } from "../../_components/public-doc/site-pages-views";

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "Platform validation and benchmark agreement | ChemDFT",
    description:
      "Review measured benchmark comparisons between ChemDFT and standalone Quantum ESPRESSO runs, including energy differences and validation limits.",
    path: "/en/validation",
  });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <PublicDocShell locale={locale} active="none">
      <ValidationView locale={locale} />
    </PublicDocShell>
  );
}
