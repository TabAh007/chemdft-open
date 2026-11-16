"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { DEV_IDENTITY_NOTE, interpretSignOut, SIGN_OUT_FAILED_MESSAGE } from "../../../lib/account-sign-out";
import { authClient } from "../../../lib/auth/client";

type Me = { display_name: string; email: string; kind: string; auth_mode: string; organization: { name: string; role: string; kind: string }; setup: { project_count: number } };

/**
 * `signOutAvailable` is true only when the server runs jwt authentication (the only mode that mounts /api/auth); `localDevelopment`
 * is the server's `isLocalDevelopment()` answer. Both are decided on the server, never read from the browser.
 */
export function AccountClient({ locale, signOutAvailable, localDevelopment }: { locale: string; signOutAvailable: boolean; localDevelopment: boolean }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/chemdft/v1/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as Me;
      })
      .then((value) => { if (!cancelled) setMe(value); })
      .catch(() => { if (!cancelled) setError("Your account details could not be loaded."); });
    return () => { cancelled = true; };
  }, []);

  async function signOut() {
    setSignOutError(null);
    let outcome = interpretSignOut(null, true);
    try {
      outcome = interpretSignOut(await authClient.signOut());
    } catch {
      // stays "failed"
    }
    if (outcome === "failed") {
      setSignOutError(SIGN_OUT_FAILED_MESSAGE);
      return;
    }
    router.replace(`/${locale}/login`);
    router.refresh();
  }

  return (
    <section className="auth-card account-card" aria-labelledby="account-title" data-testid="account">
      <h1 id="account-title">Account</h1>
      {error ? <p role="alert" className="auth-error">{error}</p> : null}
      {me ? (
        <dl className="auth-details">
          <div><dt>Name</dt><dd data-testid="account-name">{me.display_name}</dd></div>
          <div><dt>Email</dt><dd data-testid="account-email">{me.email}</dd></div>
          <div><dt>Workspace</dt><dd data-testid="account-organization">{me.organization.name} ({me.organization.role})</dd></div>
          <div><dt>Projects</dt><dd>{me.setup.project_count}</dd></div>
        </dl>
      ) : error ? null : <p role="status">Loading…</p>}
      {signOutError ? <p role="alert" className="auth-error" data-testid="sign-out-error">{signOutError}</p> : null}
      {!signOutAvailable && localDevelopment ? <p role="status" className="auth-notice" data-testid="dev-identity-note">{DEV_IDENTITY_NOTE}</p> : null}
      <div className="auth-actions">
        <Link className="bp6-button" href={`/${locale}/projects`}>Projects</Link>
        {signOutAvailable ? <button type="button" className="bp6-button" onClick={() => void signOut()} data-testid="sign-out">Sign out</button> : null}
      </div>
    </section>
  );
}
