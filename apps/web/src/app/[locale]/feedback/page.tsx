import { isLocale } from "@chemdft/i18n";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getSession } from "../../../lib/auth/session";
import { requireWebSession } from "../../../lib/auth/web-session";
import { ProductHeader } from "../../_components/product-header";
import { FeedbackForm } from "./feedback-form";

export const metadata: Metadata = {
  title: "Feedback — ChemDFT",
  description: "Send feedback, report issues, or suggest calculation methods and features to the ChemDFT team.",
  robots: { index: false, follow: false },
};

export default async function FeedbackPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  await requireWebSession(locale);

  const headerList = await headers();
  const session = await getSession(headerList);
  const userEmail = session?.user?.email || "dev@chemdft.local";

  return (
    <div className="projects-index">
      <ProductHeader locale={locale} active="feedback" />
      <main id="main-content" className="projects-main">
        <FeedbackForm locale={locale} userEmail={userEmail} />
      </main>
    </div>
  );
}
