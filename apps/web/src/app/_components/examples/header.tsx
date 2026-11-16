"use client";
import Link from "next/link";
import type { Locale } from "@chemdft/i18n";
import { BrandMark } from "../brand-mark";
import { LocaleSwitcher } from "../locale-switcher";
import { HeaderActions } from "../home/header-actions";
import { exampleMessage } from "@/lib/example-messages";

export function ExampleHeader({ locale }: { locale: Locale }) {
  return (
    <header className="home-header">
      <Link
        href={`/${locale}`}
        className="header-brand"
        aria-label={exampleMessage(locale, "home")}
      >
        <BrandMark />
      </Link>
      <nav aria-label={exampleMessage(locale, "navigation")}>
        <Link href={`/${locale}/examples`}>
          {exampleMessage(locale, "catalogue")}
        </Link>
      </nav>
      <div className="home-header-end">
        <HeaderActions locale={locale} />
        <LocaleSwitcher locale={locale} />
      </div>
    </header>
  );
}
