import { isLocale } from "@chemdft/i18n";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { authModeFromEnv, isLocalDevelopment } from "../../../lib/local-development";
import { ProductHeader } from "../../_components/product-header";
import { AccountClient } from "./account-client";

export const metadata: Metadata = { title: "Account", robots: { index: false, follow: false } };

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div className="projects-index">
      <ProductHeader locale={locale} active="account" />
      <main id="main-content" className="projects-main auth-main account-main">
        <AccountClient locale={locale} signOutAvailable={authModeFromEnv() === "jwt"} localDevelopment={isLocalDevelopment()} />
      </main>
    </div>
  );
}
