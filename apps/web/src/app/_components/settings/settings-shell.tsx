import type { SettingsSection } from "@chemdft/domain";
import { StatusTag } from "@chemdft/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { railSections, SECTION_LABEL, type SettingsScope } from "../../../lib/settings-model";
import styles from "./settings.module.css";

/** Rail plus pane for a global (`/settings/...`) or project (`/projects/{id}/settings/...`) section. One URL per section. */
export function SettingsShell({ scope, locale, projectId, section, children }: { scope: SettingsScope; locale: string; projectId?: string; section: SettingsSection; children?: ReactNode }) {
  const base = scope === "global" ? `/${locale}/settings` : `/${locale}/projects/${projectId}/settings`;
  return (
    <div className={styles.shell} data-testid="settings-shell" data-scope={scope}>
      <nav className={styles.rail} aria-label={scope === "global" ? "Settings sections" : "Project settings"}>
        <p className={styles.railTitle}>{scope === "global" ? "Account" : "Project"}</p>
        {railSections(scope).map((entry) => (
          <Link key={entry.section} href={`${base}/${entry.section}`} aria-current={entry.section === section ? "page" : undefined}
            className={`${styles.railLink} ${entry.unavailable ? styles.railLinkUnavailable : ""}`} data-section={entry.section} data-unavailable={entry.unavailable || undefined}>
            <span>{entry.label}</span>
            {entry.unavailable ? <span className={styles.railNote}>Not in beta</span> : null}
          </Link>
        ))}
      </nav>
      <div className={styles.pane}>
        <div className={styles.paneInner}>{children}</div>
      </div>
    </div>
  );
}

export function SectionHead({ title, lead, tag, id }: { title: string; lead?: ReactNode; tag?: ReactNode; id?: string }) {
  return (
    <header className={`${styles.head} ${tag ? styles.headRow : ""}`}>
      <div><h2 id={id}>{title}</h2>{lead ? <p>{lead}</p> : null}</div>
      {tag}
    </header>
  );
}

/** Compute, Scientific, Privacy and Advanced: no server data exists for them, so say so once and show nothing editable. */
export function UnavailableSection({ section, scope }: { section: SettingsSection; scope: SettingsScope }) {
  const title = SECTION_LABEL[section];
  return (
    <div data-testid="settings-unavailable" data-section={section}>
      <SectionHead title={title} tag={<StatusTag>Not available yet</StatusTag>}
        lead={scope === "project" && section === "billing"
          ? "Billing belongs to your account, not to a project. It is not available during the beta."
          : `${title} settings are not available yet. Nothing here can be changed.`} />
    </div>
  );
}
