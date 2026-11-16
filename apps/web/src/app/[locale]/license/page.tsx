import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { createPublicMetadata } from "@/lib/seo";

import { LicenseView } from "../../_components/public-doc/license-view";
import { PublicDocShell } from "../../_components/public-doc/public-doc-shell";

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "Open-core licensing and software notices | ChemDFT",
    description:
      "Review ChemDFT licensing details: Apache-2.0 core code, proprietary application components, and third-party scientific engine open-source licenses.",
    path: "/en/license",
  });
}

export default async function LicensePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <PublicDocShell locale={locale} active="none">
      <LicenseView />
    </PublicDocShell>
  );
}
