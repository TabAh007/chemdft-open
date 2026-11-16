import { ProjectOverview } from "@/app/_components/overview/project-overview";

export default async function ProjectOverviewPage({ params, searchParams }: {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ structure_version_id?: string }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  // `.project-overview` marks the Overview as a document route for the shell's scroll ownership; its content is full width.
  return <div className="project-overview"><ProjectOverview projectId={projectId} structureVersionId={query.structure_version_id} /></div>;
}
