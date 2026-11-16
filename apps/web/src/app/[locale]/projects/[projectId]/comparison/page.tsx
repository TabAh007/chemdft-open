import { Suspense } from "react";

import { ComparisonWorkstation } from "@/app/_components/comparison/comparison-workstation";

export default async function ProjectComparisonPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  return <Suspense fallback={null}><ComparisonWorkstation projectId={projectId} locale={locale} /></Suspense>;
}
