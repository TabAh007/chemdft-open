import { isLocale } from "@chemdft/i18n";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandMark } from "../../_components/brand-mark";
import { SiteFooter } from "../../_components/site-footer";
import { selfServiceSignupEnabled } from "../../../lib/auth/config";
import { getAuth } from "../../../lib/auth/server";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an account", robots: { index: false, follow: false } };

export default async function SignupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: candidate } = await params;
  if (!isLocale(candidate)) notFound();
  const locale = candidate;
  let open = false;
  try {
    // The real state: the switch AND a working email transport AND a migrated authentication database.
    const { config } = await getAuth();
    open = selfServiceSignupEnabled(config);
  } catch {
    open = false;
  }
  return (
    <div className="projects-index">
      <header className="project-header standalone-header">
        <Link href={`/${locale}`} className="header-brand"><BrandMark /></Link>
      </header>
      <main id="main-content" className="projects-main auth-main">
        <section className="auth-card" aria-labelledby="signup-title">
          <h1 id="signup-title">Create a ChemDFT account</h1>
          {open ? (
            <SignupForm locale={locale} />
          ) : (
            <p className="auth-notice" role="status" data-testid="signup-closed">
              Signup is closed. ChemDFT is in a private beta and accounts are created by invitation only. <Link href={`/${locale}/login`}>Sign in</Link>
            </p>
          )}
        </section>
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
