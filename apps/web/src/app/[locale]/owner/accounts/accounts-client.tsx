"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { OwnerAccountSummary } from "../../../../lib/auth/owner";
import styles from "./accounts.module.css";

type AccountsApiResponse = {
  accounts: OwnerAccountSummary[];
  betaUserCap?: number | null;
  countedNonOwnerAccounts?: number;
};

export function AccountsClient({ currentUserId }: { currentUserId: string }) {
  const [accounts, setAccounts] = useState<OwnerAccountSummary[]>([]);
  const [betaUserCap, setBetaUserCap] = useState<number | null>(null);
  const [countedNonOwnerAccounts, setCountedNonOwnerAccounts] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  async function loadAccounts() {
    setError(null);
    try {
      const res = await fetch("/api/owner/accounts", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(res.status === 403 ? "Access denied: Owner role required." : "Failed to load accounts.");
      }
      const data = (await res.json()) as AccountsApiResponse;
      setAccounts(data.accounts || []);
      setBetaUserCap(data.betaUserCap !== undefined ? data.betaUserCap : null);
      if (typeof data.countedNonOwnerAccounts === "number") setCountedNonOwnerAccounts(data.countedNonOwnerAccounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/owner/accounts", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 403 ? "Access denied: Owner role required." : "Failed to load accounts.");
        return (await res.json()) as AccountsApiResponse;
      })
      .then((data) => {
        if (!cancelled) {
          setAccounts(data.accounts || []);
          setBetaUserCap(data.betaUserCap !== undefined ? data.betaUserCap : null);
          if (typeof data.countedNonOwnerAccounts === "number") setCountedNonOwnerAccounts(data.countedNonOwnerAccounts);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load accounts.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleDisabled(account: OwnerAccountSummary) {
    if (account.id === currentUserId || account.isOwner) return;
    setActionBusy(account.id);
    try {
      const res = await fetch("/api/owner/accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: account.id, disabled: !account.disabled }),
      });
      if (!res.ok) throw new Error("Failed to update account status.");
      await loadAccounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update account status.");
    } finally {
      setActionBusy(null);
    }
  }

  const pathname = usePathname();
  const feedbackHref = pathname ? pathname.replace(/\/accounts\/?$/, "/feedback") : "/en/owner/feedback";

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Beta Accounts (Owner Tools)</h1>
        <p>
          Manage ChemDFT beta tester accounts and inspect limits and access status.
          Enable or disable user access as needed.
          Permanent account deletion is restricted to self-service data erasure in compliance with scientific safety guidelines.
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
          <span style={{ fontSize: 13, padding: "6px 12px", borderRadius: 4, background: "#106ba3", color: "#ffffff", fontWeight: 600 }}>
            Beta Accounts
          </span>
          <Link href={feedbackHref} style={{ fontSize: 13, color: "#106ba3", textDecoration: "none", padding: "6px 12px", borderRadius: 4, background: "#f5f8fa", border: "1px solid #d8e1e8" }}>
            Feedback Reports
          </Link>
        </div>
      </header>

      <div className={`bp6-callout bp6-intent-primary ${styles.infoBanner}`}>
        <h4 className="bp6-heading">Global Beta Limits (Read-Only)</h4>
        <p>
          Beta limits are global backend limits configured via backend environment / SSM (<code>CHEMDFT_QUOTA_*</code>, ADR-045).
          Individual per-user limit overrides are not enforced by the backend and are not editable in this console.
        </p>
      </div>

      {error ? (
        <div role="alert" className="bp6-callout bp6-intent-danger" data-testid="accounts-error-state" style={{ marginBottom: 16 }}>
          <h4 className="bp6-heading">Error</h4>
          <p>{error}</p>
        </div>
      ) : null}

      <div className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <div>
            <h2>
              Registered Accounts ({accounts.length})
              <span className={styles.capStatus} data-testid="beta-cap-status">
                · Beta Cap: {betaUserCap !== null ? `${countedNonOwnerAccounts} of ${betaUserCap} non-owner accounts` : "no cap"}
              </span>
            </h2>
            <div style={{ fontSize: "0.75rem", color: "var(--cdf-ink-muted)", marginTop: 2 }}>
              {betaUserCap !== null
                ? `Computed from self-signup non-owner accounts (${countedNonOwnerAccounts} of ${betaUserCap} non-owner accounts); owners and pre-existing/invited accounts are excluded.`
                : `Computed from self-signup non-owner accounts (${countedNonOwnerAccounts} non-owner accounts, no cap); owners and pre-existing/invited accounts are excluded.`}
            </div>
          </div>
          <button
            type="button"
            className="bp6-button bp6-small bp6-minimal bp6-icon-refresh"
            onClick={() => void loadAccounts()}
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label="Beta tester accounts">
            <thead>
              <tr>
                <th scope="col">User / Email</th>
                <th scope="col">Created Date</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Beta Limits</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--cdf-ink-muted)" }}>
                    Loading accounts…
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className={styles.emptyState} data-testid="accounts-empty-state">
                      <h3>No accounts found</h3>
                      <p>There are currently no registered user accounts in the authentication database.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                accounts.map((account) => {
                  const isSelf = account.id === currentUserId;
                  const isOwnerAccount = account.isOwner;

                  return (
                    <tr key={account.id} data-testid={`account-row-${account.id}`}>
                      <td>
                        <strong>{account.email}</strong>
                        {account.name && account.name !== account.email ? (
                          <div style={{ fontSize: "0.75rem", color: "var(--cdf-ink-muted)" }}>{account.name}</div>
                        ) : null}
                      </td>
                      <td className={styles.date}>
                        {new Date(account.createdAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td>
                        {account.role === "Owner" ? (
                          <span className="bp6-tag bp6-minimal bp6-intent-primary">Owner</span>
                        ) : account.role === "Invited Researcher" ? (
                          <span className="bp6-tag bp6-minimal bp6-intent-warning">Invited Researcher</span>
                        ) : (
                          <span className="bp6-tag bp6-minimal">Beta Tester</span>
                        )}
                      </td>
                      <td>
                        {account.disabled ? (
                          <span className="bp6-tag bp6-intent-danger">Disabled</span>
                        ) : (
                          <span className="bp6-tag bp6-intent-success">Active</span>
                        )}
                      </td>
                      <td>
                        {account.limits === "unlimited" ? (
                          <span className="bp6-tag bp6-minimal">
                            {account.isOwner ? "Unlimited (Owner)" : "Unlimited (Invited)"}
                          </span>
                        ) : (
                          <div className={styles.limitsList}>
                            {account.limits.jobsPerDay} jobs/day · {account.limits.jobsPerMonth} jobs/mo ·{" "}
                            {account.limits.concurrentJobs} concurrent · {account.limits.storageMb}MB ·{" "}
                            {account.limits.uploadMb}MB upload · AI: {account.limits.aiEnabled ? "On" : "Off"}
                            <div className={styles.limitsSource}>Global limits (backend SSM)</div>
                          </div>
                        )}
                      </td>
                      <td>
                        <div className={styles.actions}>
                          {!isOwnerAccount && !isSelf ? (
                            <button
                              type="button"
                              className={`bp6-button bp6-small ${account.disabled ? "bp6-intent-success" : "bp6-intent-danger"}`}
                              onClick={() => void toggleDisabled(account)}
                              disabled={actionBusy === account.id}
                              data-testid={`toggle-status-${account.id}`}
                            >
                              {account.disabled ? "Enable" : "Disable"}
                            </button>
                          ) : (
                            <span style={{ fontSize: "0.8125rem", color: "var(--cdf-ink-muted)" }}>
                              {isSelf ? "(Current User)" : "(Owner Account)"}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className={styles.mutedNote}>
        Note: Per engineering rules and data safety policies, accounts cannot be hard deleted from this console.
        Users can perform irreversible erasure of their own accounts via Settings → Account Data.
      </p>
    </div>
  );
}
