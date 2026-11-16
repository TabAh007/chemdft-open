"use client";

import Link from "next/link";
import type { Locale } from "@chemdft/i18n";
import { recentActivity, selectionHref } from "@/lib/overview-model";
import { formatTimestamp, parseUtc } from "@/lib/timestamps";
import type { WorkspaceCatalogItem } from "../workspace-state-provider";
import styles from "./overview.module.css";

function shortTime(value: string): string {
  const time = parseUtc(value);
  if (time === null) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(time);
}

export function OverviewActivity({ projectId, locale, catalog, ready }: { projectId: string; locale: Locale; catalog: readonly WorkspaceCatalogItem[]; ready: boolean }) {
  if (!ready) return null;
  const entries = recentActivity(catalog, 5);
  return (
    <section className={styles.panel} aria-labelledby="overview-activity-title">
      <h2 id="overview-activity-title">Recent activity</h2>
      {entries.length ? (
        <ol className={styles.activity}>
          {entries.map((entry) => (
            <li key={entry.key}>
              {entry.selection ? <Link href={selectionHref(locale, projectId, entry.selection)}>{entry.label}</Link> : <span>{entry.label}</span>}
              <time dateTime={entry.occurredAt} title={formatTimestamp(entry.occurredAt)}>{shortTime(entry.occurredAt)}</time>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.muted}>No recorded activity yet.</p>
      )}
    </section>
  );
}
