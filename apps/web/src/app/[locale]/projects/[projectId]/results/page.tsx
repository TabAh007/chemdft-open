import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";

import { ResultsLibrary } from "@/app/_components/results/results-library";

export default async function ProjectResultsPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  if (!isLocale(locale)) notFound();
  return <ResultsLibrary projectId={projectId} locale={locale} />;
}
