import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";

import { PublicDocShell } from "../../_components/public-doc/public-doc-shell";
import { SeoPageView } from "../../_components/seo/seo-page-view";
import { SEO_PAGES } from "../../../content/seo-pages";
import { createPublicMetadata } from "../../../lib/seo";

const SLUG = "pyscf-online";
const pageData = SEO_PAGES[SLUG]!;

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: pageData.metaTitle,
    description: pageData.metaDescription,
    path: pageData.path,
  });
}

export default async function PyscfOnlinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <PublicDocShell locale={locale} active="none">
      <SeoPageView locale={locale} data={pageData} />
    </PublicDocShell>
  );
}
