"use client";

import { useEffect, useState } from "react";

import { OrcidApiError, getOrcidStatus, plainOrcidError, startOrcidLink, unlinkOrcid, type OrcidStatus } from "../../../lib/orcid";
import { OrcidId } from "../orcid-id";
import styles from "./settings.module.css";

export function OrcidPanel() {
  const [status, setStatus] = useState<OrcidStatus | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [keepName, setKeepName] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getOrcidStatus()
      .then((value) => {
        if (cancelled) return;
        setStatus(value);
        const params = new URLSearchParams(window.location.search);
        if (params.get("orcid") === "linked") setMessage({ kind: "ok", text: "Your ORCID iD is linked and authenticated by ORCID." });
      })
      .catch(() => { if (!cancelled) setMessage({ kind: "error", text: "Your ORCID status could not be loaded. Reload the page to try again." }); });
    return () => { cancelled = true; };
  }, []);

  async function link() {
    setBusy(true);
    setMessage(null);
    try {
      const { authorize_url: authorizeUrl } = await startOrcidLink(keepName);
      window.location.assign(authorizeUrl);
    } catch (cause) {
      setMessage({ kind: "error", text: plainOrcidError(cause instanceof OrcidApiError ? cause.code : "orcid_failed") });
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      setStatus(await unlinkOrcid());
      setMessage({ kind: "ok", text: "Your ORCID iD is unlinked and deleted from ChemDFT. You can also remove ChemDFT's access in your ORCID account settings." });
    } catch {
      setMessage({ kind: "error", text: "Unlinking failed. Nothing was changed; try again." });
    }
    setBusy(false);
  }

  return (
    <section className={styles.card} aria-labelledby="orcid-heading" data-testid="orcid-panel">
      <div className={styles.cardHead}><h3 id="orcid-heading">ORCID iD</h3></div>
      <div className={styles.cardBody}>
        {message ? <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? styles.error : styles.caption} data-testid="orcid-message">{message.text}</p> : null}
        {!status ? (message ? null : <p role="status" className={styles.muted}>Loading ORCID status…</p>) : status.linked && status.orcid_id ? (
          <>
            <dl className={styles.facts}>
              <div><dt>Your iD</dt><dd><OrcidId orcidId={status.orcid_id} environment={status.environment} /></dd></div>
              <div><dt>Status</dt><dd data-testid="orcid-authenticated">ORCID iD authenticated by ORCID{status.verified_at ? ` on ${new Date(status.verified_at).toISOString().slice(0, 10)}` : ""}</dd></div>
              {status.display_name ? <div><dt>Name kept</dt><dd>{status.display_name}</dd></div> : null}
            </dl>
            <p className={styles.caption}>Your iD can be added as the author identifier in citations you export (you choose each time), and you can sign in with ORCID. Unlinking deletes the stored iD and name.</p>
            <button type="button" className="bp6-button" disabled={busy} onClick={() => void unlink()} data-testid="orcid-unlink">Unlink ORCID iD</button>
          </>
        ) : !status.enabled ? (
          <p className={styles.muted} data-testid="orcid-unavailable">Linking an ORCID iD is not available yet.</p>
        ) : (
          <>
            <p>Connect your ORCID iD so ChemDFT can cite your work with an identifier that ORCID itself confirmed. You will sign in at orcid.org; ChemDFT never sees your ORCID password.</p>
            <ul className={styles.caption} style={{ paddingLeft: 18, display: "grid", gap: 6 }}>
              <li><strong>What ChemDFT reads:</strong> only your ORCID iD (the &ldquo;openid&rdquo; permission, nothing else). It cannot read your private record, works or affiliations, and cannot change your ORCID record.</li>
              <li><strong>What ChemDFT stores:</strong> the iD and the time ORCID confirmed it. Your public name only if you tick the box below. ORCID access tokens are not kept.</li>
              <li><strong>How to unlink:</strong> press &ldquo;Unlink&rdquo; here at any time. The stored iD and name are deleted. You can also remove ChemDFT in your ORCID account settings.</li>
              <li><strong>Sign-in:</strong> after linking, &ldquo;Sign in with ORCID&rdquo; works for this account. It never creates a new account.</li>
            </ul>
            <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
              <input type="checkbox" style={{ width: 18, height: 18 }} checked={keepName} onChange={(event) => setKeepName(event.currentTarget.checked)} data-testid="orcid-keep-name" />
              Also keep the name from my public ORCID record, to use as the author name in citations.
            </label>
            <button type="button" className="bp6-button bp6-intent-primary" disabled={busy} onClick={() => void link()} data-testid="orcid-link">Connect your ORCID iD</button>
          </>
        )}
      </div>
    </section>
  );
}
