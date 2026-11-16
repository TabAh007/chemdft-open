import { isLocale } from "@chemdft/i18n";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { isOwner } from "../../../../lib/auth/owner";
import { getSession } from "../../../../lib/auth/session";
import { ProductHeader } from "../../../_components/product-header";
import { AccountsClient } from "./accounts-client";

export const metadata: Metadata = {
  title: "Beta Accounts — Owner Tools",
  robots: { index: false, follow: false },
};

export default async function OwnerAccountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const headerList = await headers();
  const session = await getSession(headerList);

  if (!session?.user || !isOwner(session.user)) {
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
        <AccountsClient currentUserId={session.user.id} />
      </main>
    </div>
  );
}

