import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";

import { ResultInspector } from "@/app/_components/results/result-inspector";
import { parseSection } from "@/lib/results-model";

export default async function ProjectResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; projectId: string; resultId: string }>;
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  const { locale, projectId, resultId } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const section = parseSection(Array.isArray(query.section) ? query.section[0] : query.section);
  return <ResultInspector projectId={projectId} resultId={resultId} locale={locale} initialSection={section} />;
}
