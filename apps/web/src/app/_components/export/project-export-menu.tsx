"use client";

import { ExportMenu, type ProjectExportProps } from "./export-menu";

export interface ProjectExportMenuProps {
  projectId: string;
  projectName?: string | undefined;
  structureLabel?: string | null | undefined;
  structureId?: string | null | undefined;
  structureVersionId?: string | null | undefined;
  formula?: string | undefined;
  atomCount?: number | undefined;
  authority?: "CALCULATED" | "USER_ENTERED · NOT OPTIMIZED" | undefined;
}

export function ProjectExportMenu(props: ProjectExportMenuProps) {
  const exportProps: ProjectExportProps = {
    context: "project",
    projectId: props.projectId,
    projectName: props.projectName,
    structureLabel: props.structureLabel,
    structureId: props.structureId,
    structureVersionId: props.structureVersionId,
    formula: props.formula,
    atomCount: props.atomCount,
    authority: props.authority,
    buttonTestId: "project-export-menu-btn",
    dropdownTestId: "project-export-menu-dropdown",
    shareTestId: "project-share-btn",
    testId: "project-export-controls",
  };

  return <ExportMenu {...exportProps} />;
}
