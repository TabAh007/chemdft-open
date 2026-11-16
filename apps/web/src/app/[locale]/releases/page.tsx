import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { createPublicMetadata } from "@/lib/seo";

import { PublicDocShell } from "../../_components/public-doc/public-doc-shell";
import { ReleasesView } from "../../_components/public-doc/releases-view";

export async function generateMetadata(): Promise<Metadata> {
  const meta = createPublicMetadata({
    title: "Release notes and version history | ChemDFT",
    description:
      "Track verified scientific capabilities, engine updates, and platform features across every versioned release of the ChemDFT workstation.",
    path: "/en/releases",
  });
  return {
    ...meta,
    alternates: {
      ...meta.alternates,
      types: { "application/atom+xml": "releases/feed.xml" },
    },
  };
}

export default async function ReleasesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <PublicDocShell locale={locale} active="releases">
      <ReleasesView locale={locale} />
    </PublicDocShell>
  );
}
