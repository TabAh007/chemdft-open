import { isLocale } from "@chemdft/i18n";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandMark } from "../../_components/brand-mark";
import { SiteFooter } from "../../_components/site-footer";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default async function ResetPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string; error?: string }> }) {
  const { locale: candidate } = await params;
  if (!isLocale(candidate)) notFound();
  const { token, error } = await searchParams;
  return (
    <div className="projects-index">
      <header className="project-header standalone-header"><Link href={`/${candidate}`} className="header-brand"><BrandMark /></Link></header>
      <main id="main-content" className="projects-main auth-main">
        <section className="auth-card" aria-labelledby="reset-title">
          <h1 id="reset-title">Choose a new password</h1>
          {token && !error ? <ResetForm locale={candidate} token={token} /> : (
            <p role="alert" className="auth-error" data-testid="reset-invalid">This reset link is invalid or has expired. <Link href={`/${candidate}/forgot-password`}>Request a new one</Link></p>
          )}
        </section>
      </main>
      <SiteFooter locale={candidate} />
    </div>
  );
}
