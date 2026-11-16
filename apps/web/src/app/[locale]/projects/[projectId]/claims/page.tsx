import { Suspense } from "react";

import { ClaimsWorkstation } from "@/app/_components/claims/claims-workstation";

export default async function ProjectClaimsPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  return <Suspense fallback={null}><ClaimsWorkstation projectId={projectId} locale={locale} /></Suspense>;
}
