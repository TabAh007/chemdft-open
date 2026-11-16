"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FEEDBACK_TYPE_LABELS, type FeedbackReportRecord } from "../../../../lib/feedback/types";
import { formatAttachmentSize } from "../../../../lib/feedback/format";
import styles from "./feedback.module.css";

interface OwnerFeedbackResponse {
  reports: Array<FeedbackReportRecord & { accountEmail?: string }>;
  failedLast7Days: number;
  tableMissing?: boolean;
  notice?: string;
}

export function FeedbackClient({ locale }: { locale: string }) {
  const [reports, setReports] = useState<Array<FeedbackReportRecord & { accountEmail?: string }>>([]);
  const [failedLast7Days, setFailedLast7Days] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/owner/feedback", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(res.status === 403 ? "Access denied: Owner role required." : "Failed to load feedback reports.");
        }
        return (await res.json()) as OwnerFeedbackResponse;
      })
      .then((data) => {
        if (!cancelled) {
          setReports(data.reports || []);
          setFailedLast7Days(data.failedLast7Days || 0);
          if (data.tableMissing) setTableMissing(true);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load feedback reports.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function formatTime(isoString: string): string {
    try {
      const d = new Date(isoString);
      return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
    } catch {
      return isoString;
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Feedback Reports (Owner Tools)</h1>
        <p>
          Read-only audit list of in-app feedback, bug reports, and method requests received from beta researchers.
          All reports and attachments are delivered directly to the owner mailbox.
        </p>

        <div className={styles.navRow}>
          <Link href={`/${locale}/owner/accounts`} className={styles.navLink}>
            Beta Accounts
          </Link>
          <Link href={`/${locale}/owner/feedback`} className={`${styles.navLink} ${styles.navLinkActive}`}>
            Feedback Reports
          </Link>
        </div>
      </header>

      {error ? (
        <div role="alert" className="bp6-callout bp6-intent-danger" data-testid="owner-feedback-error" style={{ marginBottom: 16 }}>
          <h4 className="bp6-heading">Error</h4>
          <p>{error}</p>
        </div>
      ) : null}

      {tableMissing ? (
        <div className="bp6-callout bp6-intent-warning" style={{ marginBottom: 16 }}>
          <h4 className="bp6-heading">Database Setup Notice</h4>
          <p>The feedback_report table has not been created yet in the auth database. The architect will apply the schema migration before production deployment.</p>
        </div>
      ) : null}

      <div className={styles.statsBanner} data-testid="owner-feedback-stats">
        <div className={styles.failedCount}>
          <span>Failed deliveries in the last 7 days:</span>
          <span className={`${styles.failedBadge} ${failedLast7Days === 0 ? styles.failedBadgeZero : ""}`} data-testid="failed-count-badge">
            {failedLast7Days}
          </span>
        </div>
        <div style={{ fontSize: "12px", color: "var(--cdf-ink-muted)" }}>
          Showing up to 100 most recent submissions
        </div>
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <h2>Reports Log ({reports.length})</h2>
        </div>

        <div className={styles.tableWrapper}>
          {loading ? (
            <div className={styles.emptyState}>Loading feedback records...</div>
          ) : reports.length === 0 ? (
            <div className={styles.emptyState} data-testid="owner-feedback-empty">
              No feedback reports received yet.
            </div>
          ) : (
            <table className={styles.table} data-testid="owner-feedback-table">
              <thead>
                <tr>
                  <th>Time (UTC)</th>
                  <th>Type</th>
                  <th>Title</th>
                  <th>Account Email</th>
                  <th>Status</th>
                  <th>Files</th>
                  <th>Error Code</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  let statusClass = styles.statusPending;
                  if (r.status === "sent") statusClass = styles.statusSent;
                  if (r.status === "failed") statusClass = styles.statusFailed;

                  return (
                    <tr key={r.id} data-testid={`report-row-${r.id}`}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatTime(r.createdAt)}</td>
                      <td>
                        <span className={styles.typeBadge}>
                          {FEEDBACK_TYPE_LABELS[r.type] || r.type}
                        </span>
                      </td>
                      <td style={{ fontWeight: 500, maxWidth: "260px" }} title={r.title}>
                        {r.title}
                      </td>
                      <td>{r.accountEmail || r.userId}</td>
                      <td className={statusClass}>
                        {r.status}
                      </td>
                      <td>{r.attachmentCount > 0 ? `${r.attachmentCount} (${formatAttachmentSize(r.attachmentBytes)})` : "0"}</td>
                      <td>
                        {r.errorCode ? (
                          <span className={styles.errorCode}>{r.errorCode}</span>
                        ) : (
                          <span className={styles.emptyDash}>&mdash;</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
