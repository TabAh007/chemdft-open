import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";

import { CompareWorkstation } from "@/app/_components/compare/compare-workstation";

export default async function CalculationComparePage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  if (!isLocale(locale)) notFound();
  return <CompareWorkstation projectId={projectId} locale={locale} />;
}
