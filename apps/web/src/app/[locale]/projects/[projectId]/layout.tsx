import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { isLocalDevelopment } from "../../../../lib/local-development";
import { LocalDevelopmentProvider } from "../../../_components/local-development-context";
import { ProjectShell } from "../../../_components/project-shell";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale: candidate, projectId } = await params;
  if (!isLocale(candidate)) notFound();
  return <LocalDevelopmentProvider value={isLocalDevelopment()}><ProjectShell locale={candidate} projectId={projectId}>{children}</ProjectShell></LocalDevelopmentProvider>;
}
