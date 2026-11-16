import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { createPublicMetadata } from "@/lib/seo";
import { HowToCiteContent } from "../../../_components/learn/cite-client";

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "How to cite ChemDFT in publications | ChemDFT",
    description:
      "Software citation in BibTeX and APA formats, author attribution rules, and calculation citation guidelines for ChemDFT.",
    path: "/en/learn/cite",
  });
}

export default async function HowToCitePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <HowToCiteContent locale={locale} />;
}
