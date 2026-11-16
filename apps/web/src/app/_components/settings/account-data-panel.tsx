"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import styles from "./settings.module.css";

type Quota = { key: string; label: string; used: number | null; limit: number | null; unit: string };
type Limits = { applies: boolean; email_verified: boolean; ai_enabled: boolean; quotas: Quota[] };

/** Settings → General: read-only limits of this beta account, data export and account deletion (ADR-045). */
export function AccountDataPanel({ locale, email, canDelete }: { locale: string; email: string | null; canDelete: boolean }) {
  const [limits, setLimits] = useState<Limits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/chemdft/v1/me/limits", { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(String(response.status)); return (await response.json()) as Limits; })
      .then((value) => { if (!cancelled) setLimits(value); })
      .catch(() => { if (!cancelled) setError("Your limits could not be loaded. Reload the page to try again."); });
    return () => { cancelled = true; };
  }, []);

  async function deleteAccount() {
    setBusy(true);
    setDeleteError(null);
    try {
      const response = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm_email: typed }) });
      if (response.ok) {
        router.replace(`/${locale}/login`);
        router.refresh();
        return;
      }
      setDeleteError(response.status === 400 ? "The email address you typed does not match your account." : "The account could not be deleted. Nothing was changed unless this message says otherwise; try again or contact support.");
    } catch {
      setDeleteError("The account could not be deleted. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <>
      <section className={styles.card} aria-labelledby="limits-heading" data-testid="account-limits">
        <div className={styles.cardHead}><h3 id="limits-heading">Beta limits</h3></div>
        <div className={styles.cardBody}>
          {error ? <p role="alert" className={styles.error}>{error}</p> : !limits ? <p role="status" className={styles.muted}>Loading limits…</p> : !limits.applies ? (
            <p className={styles.muted}>This account has no self-service beta limits.</p>
          ) : (
            <>
              <dl className={styles.facts}>
                {limits.quotas.map((quota) => (
                  <div key={quota.key}>
                    <dt>{quota.label}</dt>
                    <dd data-testid={`quota-${quota.key}`}>{quota.used === null ? "" : `${quota.used} of `}{quota.limit === null ? "no limit" : `${quota.limit} ${quota.unit}`}</dd>
                  </div>
                ))}
                <div><dt>Email address</dt><dd>{limits.email_verified ? "Verified" : "Not verified (calculations are blocked until you verify it)"}</dd></div>
                <div><dt>AI Scientist</dt><dd>{limits.ai_enabled ? "Enabled" : "Not enabled for new accounts during the beta"}</dd></div>
              </dl>
              <p className={styles.caption}>Limits are enforced by the server and may change during the beta. Calculation hours are also capped by the shared compute budget.</p>
            </>
          )}
        </div>
      </section>
      <section className={styles.card} aria-labelledby="data-heading" data-testid="account-data">
        <div className={styles.cardHead}><h3 id="data-heading">Your data</h3></div>
        <div className={styles.cardBody}>
          <p>Download your account, projects, structures, jobs and results with provenance as a zip of JSON files. Uploaded file bytes are listed, not included.</p>
          <p><a className="bp6-button" href="/api/chemdft/v1/me/export" download data-testid="export-download">Download my data</a></p>
          {canDelete ? (<>
          <h4>Delete account</h4>
          <p>This cancels your running jobs, deletes the content of the projects you own, removes your stored files and ORCID link, and irreversibly anonymises your account. Backups can hold older copies for up to 30 days. It cannot be undone.</p>
          {!confirming ? (
            <button type="button" className="bp6-button bp6-intent-danger" onClick={() => setConfirming(true)} data-testid="delete-start">Delete my account…</button>
          ) : (
            <div role="group" aria-labelledby="delete-confirm-label" data-testid="delete-confirm">
              <label id="delete-confirm-label" style={{ display: "grid", gap: 4 }}>
                Type your email address{email ? ` (${email})` : ""} to confirm
                <input type="email" value={typed} onChange={(e) => setTyped(e.currentTarget.value)} autoComplete="off" data-testid="delete-email" style={{ padding: "8px 10px", border: "1px solid var(--cdf-line)", borderRadius: 4, font: "inherit" }} />
              </label>
              {deleteError ? <p role="alert" className={styles.error}>{deleteError}</p> : null}
              <p style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button type="button" className="bp6-button bp6-intent-danger" disabled={busy || typed.trim().length < 3} onClick={() => void deleteAccount()} data-testid="delete-confirm-button">Permanently delete my account</button>
                <button type="button" className="bp6-button" disabled={busy} onClick={() => { setConfirming(false); setTyped(""); setDeleteError(null); }}>Cancel</button>
              </p>
            </div>
          )}
          </>) : null}
        </div>
      </section>
    </>
  );
}
