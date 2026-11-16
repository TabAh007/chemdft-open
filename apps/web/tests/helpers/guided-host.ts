import { createElement } from "react";
import { GuidedWorkspace, type GuidedWorkspaceProps } from "../../src/app/_components/guided/guided-workspace";
import { useGuidedJob } from "../../src/lib/use-guided-job";
import { useProjectRole } from "../../src/lib/use-project-role";

/** What the workspace client does: own the project role and the submitted job, and hand both to the Guided workspace. */
export function GuidedHost(props: Omit<GuidedWorkspaceProps, "job" | "canExecute">) {
  const { canExecute } = useProjectRole(props.projectId);
  const job = useGuidedJob({ projectId: props.projectId, versionId: props.detail.version.id, canWrite: canExecute });
  return createElement(GuidedWorkspace, { ...props, job, canExecute });
}
