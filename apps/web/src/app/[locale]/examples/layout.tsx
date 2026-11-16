import type { ReactNode } from "react";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { SessionProvider } from "../../_components/home/header-actions";
import { ExampleHeader } from "../../_components/examples/header";
import { SiteFooter } from "../../_components/site-footer";
import "../../landing.css";

export default async function ExamplesLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const authMode =
    (process.env.CHEMDFT_AUTH_MODE ?? "dev").trim().toLowerCase() === "jwt"
      ? "jwt"
      : "dev";
  return (
    <div className="home">
      <SessionProvider authMode={authMode}>
        <ExampleHeader locale={locale} />
        {children}
        <SiteFooter locale={locale} />
      </SessionProvider>
    </div>
  );
}
