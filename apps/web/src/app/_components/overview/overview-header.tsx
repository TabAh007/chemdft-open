"use client";

import { useState } from "react";
import { AppIcon } from "@chemdft/ui";
import type { ProjectRead } from "@/lib/project-api";
import { parseUtc } from "@/lib/timestamps";
import { ProjectExportMenu } from "../export/project-export-menu";
import styles from "./overview.module.css";

function date(value: string | null | undefined): string {
  const time = parseUtc(value);
  return time === null ? "—" : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(time);
}

/**
 * What project and structure am I looking at? The name and the active structure only; role, dates, slug and the
 * project ID are administrative and sit behind "Project details". Navigation to Workspace, Results, Jobs and Settings
 * is the top bar's job, so none is repeated here. The API has no project description field, so none is shown.
 */
export function OverviewHeader({
  project,
  projectId,
  structureLabel,
  structureId,
  structureVersionId,
}: {
  project: ProjectRead | null;
  projectId: string;
  structureLabel: string | null;
  structureId?: string | null;
  structureVersionId?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(projectId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable: the ID stays selectable */ }
  }
  return (
    <header className={styles.header} data-testid="overview-identity">
      <span className={styles.projectTile} aria-hidden="true"><AppIcon icon="lab-test" /></span>
      <div className={styles.headerMain}>
        <h1>{project?.name ?? "…"}</h1>
        <p className={styles.metaLine}>
          <span>Project overview</span>
          {structureLabel ? <span>Active structure · <strong>{structureLabel}</strong></span> : null}
        </p>
      </div>
      <ProjectExportMenu
        projectId={projectId}
        projectName={project?.name}
        structureLabel={structureLabel}
        structureId={structureId}
        structureVersionId={structureVersionId}
      />
      <details className={styles.details}>
        <summary>
          <AppIcon icon="info-sign" />
          <span>Project details</span>
        </summary>
        <dl className={styles.detailsBody}>
          <div><dt>Role</dt><dd><span className={styles.roleTag}>{project?.role ?? "—"}</span></dd></div>
          <div><dt>Created</dt><dd>{date(project?.created_at)}</dd></div>
          <div><dt>Last updated</dt><dd>{date(project?.updated_at)}</dd></div>
          <div><dt>Slug</dt><dd><span className={styles.mono}>{project?.slug ?? "—"}</span></dd></div>
          <div>
            <dt>Project ID</dt>
            <dd>
              <span className={styles.mono} title={projectId}>{projectId.slice(0, 8)}…{projectId.slice(-4)}</span>
              <button type="button" className={styles.copy} onClick={copy} aria-label="Copy project ID"><AppIcon icon={copied ? "tick" : "duplicate"} /></button>
              <span className={styles.visuallyHidden} role="status">{copied ? "Project ID copied" : ""}</span>
            </dd>
          </div>
        </dl>
      </details>
    </header>
  );
}
