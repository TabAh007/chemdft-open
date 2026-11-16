import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";

import { ProductHeader } from "../../_components/product-header";
import { GlobalJobsClient } from "./jobs-client";

export const metadata: Metadata = {
  title: "Jobs",
  robots: { index: false, follow: false },
};

export default async function GlobalJobsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: candidate } = await params;
  if (!isLocale(candidate)) notFound();
  const locale = candidate;

  return (
    <div className="projects-index">
      <ProductHeader locale={locale} active="jobs" />
      <main id="main-content" className="projects-main">
        <GlobalJobsClient locale={locale} />
      </main>
    </div>
  );
}
