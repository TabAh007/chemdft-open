import { isLocale } from "@chemdft/i18n";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandMark } from "../../_components/brand-mark";
import { SiteFooter } from "../../_components/site-footer";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false } };

export default async function ForgotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: candidate } = await params;
  if (!isLocale(candidate)) notFound();
  return (
    <div className="projects-index">
      <header className="project-header standalone-header"><Link href={`/${candidate}`} className="header-brand"><BrandMark /></Link></header>
      <main id="main-content" className="projects-main auth-main">
        <section className="auth-card" aria-labelledby="forgot-title">
          <h1 id="forgot-title">Reset your password</h1>
          <ForgotForm locale={candidate} />
        </section>
      </main>
      <SiteFooter locale={candidate} />
    </div>
  );
}
