import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { requireWebSession } from "@/lib/auth/web-session";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function WelcomeLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireWebSession(locale);
  return children;
}
