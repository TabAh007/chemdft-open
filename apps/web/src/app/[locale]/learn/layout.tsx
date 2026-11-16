import type { ReactNode } from "react";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { ProductHeader } from "../../_components/product-header";
import { SiteFooter } from "../../_components/site-footer";
import styles from "../../_components/learn/learn-page.module.css";

export default async function LearnLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div className={`projects-index ${styles.page}`}>
      <ProductHeader locale={locale} active="learn" layout="content" />
      {children}
      <SiteFooter locale={locale} />
    </div>
  );
}
