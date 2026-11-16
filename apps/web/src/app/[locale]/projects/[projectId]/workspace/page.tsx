import { StructureWorkspaceClient } from "./structure-workspace-client";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StructureWorkspaceClient projectId={projectId} />;
}
