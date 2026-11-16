import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { createPublicMetadata } from "@/lib/seo";

import { PublicDocShell } from "../../_components/public-doc/public-doc-shell";
import { CostSupportView } from "../../_components/public-doc/site-pages-views";

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "Cost, support, and researcher access | ChemDFT",
    description:
      "Learn about ChemDFT access during the public beta: free for scientific research, compute resource policies, and support response channels.",
    path: "/en/cost-and-support",
  });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <PublicDocShell locale={locale} active="none">
      <CostSupportView locale={locale} />
    </PublicDocShell>
  );
}
