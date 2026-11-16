import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { createPublicMetadata } from "@/lib/seo";

import { PublicDocShell } from "../../_components/public-doc/public-doc-shell";
import { PrinciplesView } from "../../_components/public-doc/site-pages-views";

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "Scientific principles and AI boundaries | ChemDFT",
    description:
      "Explore the core principles guiding ChemDFT: the Scientific Result Firewall, real open-source engines, reproducibility, and transparent AI limits.",
    path: "/en/principles",
  });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <PublicDocShell locale={locale} active="none">
      <PrinciplesView locale={locale} />
    </PublicDocShell>
  );
}
