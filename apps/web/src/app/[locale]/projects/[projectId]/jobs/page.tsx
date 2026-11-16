import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";

import { JobsWorkstation } from "@/app/_components/jobs/jobs-workstation";

export default async function JobsPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  if (!isLocale(locale)) notFound();
  return <JobsWorkstation projectId={projectId} locale={locale} />;
}
