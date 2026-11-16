import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { createPublicMetadata } from "@/lib/seo";

import { PrivacyView } from "../../_components/public-doc/legal-views";
import { PublicDocShell } from "../../_components/public-doc/public-doc-shell";

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "Privacy policy and data retention | ChemDFT",
    description:
      "Understand how ChemDFT stores, processes, exports, and protects researcher data, project files, and authentication details with full transparency.",
    path: "/en/privacy",
  });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <PublicDocShell locale={locale} active="none">
      <PrivacyView locale={locale} />
    </PublicDocShell>
  );
}
