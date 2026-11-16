import { isLocale, usesEnglishFallback } from "@chemdft/i18n";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createPublicMetadata, getHomeJsonLd } from "@/lib/seo";
import { SiteFooter } from "../_components/site-footer";
import { Engines } from "../_components/home/engines";
import { WorkedExample } from "../_components/home/worked-example";
import { Licences } from "../_components/home/licences";
import { Firewall } from "../_components/home/firewall";
import { HomeHeader } from "../_components/home/home-header";
import { HomeShell } from "../_components/home/home-shell";
import { Journey } from "../_components/home/journey";
import { Record } from "../_components/home/record";
import { Workstation } from "../_components/home/workstation";

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "ChemDFT: free online DFT calculations in your browser",
    description:
      "Run DFT, xTB and periodic Quantum ESPRESSO calculations in your browser. Free during the beta. An AI Scientist plans; real engines calculate.",
    path: "/en",
  });
}

export default async function LandingPage({ params }: PageProps) {
  const { locale: candidate } = await params;
  if (!isLocale(candidate)) notFound();
  const locale = candidate;
  // `jwt` mode has real sessions to look up; the local development identity has none, so the page never asks.
  const authMode = (process.env.CHEMDFT_AUTH_MODE ?? "dev").trim().toLowerCase() === "jwt" ? "jwt" : "dev";

  return (
    <div className="home">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(getHomeJsonLd()) }}
      />
      <HomeShell authMode={authMode}>
        <HomeHeader locale={locale} />
        <main id="main-content">
          <Journey locale={locale} />
          <Engines locale={locale} />
          <WorkedExample />
          <Licences locale={locale} />
          <Firewall />
          <Workstation />
          <Record locale={locale} />
        </main>

        <SiteFooter
          locale={locale}
          className="home-footer"
          note={
            <>
              Provenance-first computational chemistry.
              {usesEnglishFallback(locale) ? " This page is shown in English." : ""}
            </>
          }
          lead={
            <>
              <Link href={`/${locale}/login`}>Sign in</Link>
              <a href="#engines">What works today</a>
              <Link href={`/${locale}/examples`}>Explore examples</Link>
            </>
          }
        />
      </HomeShell>
    </div>
  );
}
