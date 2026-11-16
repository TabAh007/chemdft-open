import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { createPublicMetadata } from "@/lib/seo";

import { BetaNoticeView } from "../../_components/public-doc/legal-views";
import { PublicDocShell } from "../../_components/public-doc/public-doc-shell";

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "Beta notice and research guidelines | ChemDFT",
    description:
      "Read important guidance regarding beta usage, platform availability, computational resource limits, and independent verification of results.",
    path: "/en/beta",
  });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <PublicDocShell locale={locale} active="none">
      <BetaNoticeView locale={locale} />
    </PublicDocShell>
  );
}
