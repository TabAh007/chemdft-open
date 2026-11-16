import { isLocale } from "@chemdft/i18n";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { isOwner } from "../../../../lib/auth/owner";
import { getSession } from "../../../../lib/auth/session";
import { isLocalDevelopment } from "../../../../lib/local-development";
import { ProductHeader } from "../../../_components/product-header";
import { FeedbackClient } from "./feedback-client";

export const metadata: Metadata = {
  title: "Feedback Reports — Owner Tools",
  robots: { index: false, follow: false },
};

export default async function OwnerFeedbackPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const headerList = await headers();
  const session = await getSession(headerList);
  const isDev = isLocalDevelopment(process.env);
  const user = session?.user ?? (isDev ? { id: "dev-owner", email: "tab@chemdft.com", name: "Dev Owner" } : null);

  if (!user || !isOwner(user)) {
    return (
      <div className="projects-index">
        <ProductHeader locale={locale} active="none" />
        <main id="main-content" className="projects-main auth-main">
          <section className="auth-card" aria-labelledby="owner-denied-title">
            <h1 id="owner-denied-title">Access Denied</h1>
            <p className="auth-error" data-testid="owner-access-denied">
              This console is restricted to the ChemDFT owner. If you are the owner, sign in with your configured owner account.
            </p>
            <p className="auth-notice">
              <Link href={`/${locale}/projects`}>Return to Projects</Link>
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="projects-index">
      <ProductHeader locale={locale} active="none" />
      <main id="main-content">
        <FeedbackClient locale={locale} />
      </main>
    </div>
  );
}
