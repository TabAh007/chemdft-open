"use client";

import { useEffect, useState } from "react";

import { authClient } from "../../../lib/auth/client";
import { plainGoogleError, plainGoogleSettingsError } from "../../../lib/auth/google";
import { GoogleButton } from "../google-button";
import styles from "./settings.module.css";

type Method = { id: string; providerId: string };

/** Link or unlink Google for the signed-in user. Rendered only when Google is configured (the caller decides). */
export function GooglePanel({ locale = "en" }: { locale?: string }) {
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get("google") === "linked") return { kind: "ok", text: "Google is linked. You can now sign in with it." };
    const error = params.get("error");
    const text = error ? plainGoogleError(error, { selfService: false }) : null;
    return text ? { kind: "error", text } : null;
  });
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await authClient.listAccounts();
    if (result.error) throw new Error("list");
    setMethods((result.data ?? []).map((a) => ({ id: a.id, providerId: a.providerId })));
  }

  useEffect(() => {
    let cancelled = false;
    authClient.listAccounts()
      .then((result) => {
        if (result.error) throw new Error("list");
        if (!cancelled) setMethods((result.data ?? []).map((a) => ({ id: a.id, providerId: a.providerId })));
      })
      .catch(() => { if (!cancelled) setMessage({ kind: "error", text: "Your sign-in methods could not be loaded. Reload the page to try again." }); });
    return () => { cancelled = true; };
  }, []);

  const google = methods?.find((m) => m.providerId === "google") ?? null;
  const others = methods ? methods.filter((m) => m.providerId !== "google").length : 0;

  async function link() {
    setBusy(true);
    setMessage(null);
    const result = await authClient.linkSocial({ provider: "google", callbackURL: `/${locale}/settings/general?google=linked`, errorCallbackURL: `/${locale}/settings/general` });
    if (result.error) { setMessage({ kind: "error", text: plainGoogleSettingsError(result.error.code) }); setBusy(false); }
  }

  async function unlink() {
    if (!google) return;
    setBusy(true);
    setMessage(null);
    const result = await authClient.unlinkAccount({ accountId: google.id });
    if (result.error) setMessage({ kind: "error", text: plainGoogleSettingsError(result.error.code) });
    else {
      setMessage({ kind: "ok", text: "Google is unlinked. You can also remove ChemDFT in your Google account's security settings." });
      await load().catch(() => undefined);
    }
    setBusy(false);
  }

  return (
    <section className={styles.card} aria-labelledby="google-heading" data-testid="google-panel">
      <div className={styles.cardHead}><h3 id="google-heading">Google sign-in</h3></div>
      <div className={styles.cardBody}>
        {message ? <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? styles.error : styles.caption} data-testid="google-message">{message.text}</p> : null}
        {!methods ? (message ? null : <p role="status" className={styles.muted}>Loading sign-in methods…</p>) : google ? (
          <>
            <p data-testid="google-linked">Google is linked to this account. You can sign in with it.</p>
            {others === 0 ? <p className={styles.caption} data-testid="google-last-method">Google is your only sign-in method, so it cannot be unlinked.</p> : null}
            <button type="button" className="bp6-button" style={{ justifySelf: "start" }} disabled={busy || others === 0} onClick={() => void unlink()} data-testid="google-unlink">Unlink Google</button>
          </>
        ) : (
          <>
            <p>Link your Google account to sign in with it. Only the Google account with the same, verified email address as this ChemDFT account can be linked. ChemDFT reads your name, email and profile picture address (the openid, email and profile permissions) and nothing else.</p>
            <div style={{ maxWidth: 280 }}><GoogleButton label="Link Google" disabled={busy} onClick={() => void link()} data-testid="google-link" /></div>
            <p className={styles.caption}>Google never creates a ChemDFT account. You can unlink it here at any time.</p>
          </>
        )}
      </div>
    </section>
  );
}
