"use client";

import type { Locale } from "@chemdft/i18n";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type SessionState = "signed-out" | "signed-in" | "local";
export type AuthMode = "jwt" | "dev";

const SessionContext = createContext<SessionState>("signed-out");
export const useSession = (): SessionState => useContext(SessionContext);

/**
 * The smallest session-aware treatment the public homepage needs.
 *
 * - `dev` mode (the local development identity): there is no auth server and nothing to sign in to, so the page is
 *   "local" from the first render and makes **no** session request (previously a 404 on every local visit).
 * - `jwt` mode: the server-rendered HTML is the signed-out state (the page stays cacheable) and the same-origin auth
 *   endpoint is asked, with the session cookie only, whether there is a session. It never requests or stores a token.
 */
export function SessionProvider({ authMode, children }: { authMode: AuthMode; children: ReactNode }) {
  const [state, setState] = useState<SessionState>(authMode === "dev" ? "local" : "signed-out");
  useEffect(() => {
    if (authMode === "dev") return;
    let cancelled = false;
    fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) return "local" as const; // no auth server answers: the local development identity
        if (!response.ok) return "signed-out" as const;
        const body = (await response.json().catch(() => null)) as { user?: unknown } | null;
        return body?.user ? ("signed-in" as const) : ("signed-out" as const);
      })
      .catch(() => "signed-out" as const)
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, [authMode]);
  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

/** The one primary action: Sign in when signed out (public sign-up is closed), Open ChemDFT otherwise. */
export function PrimaryAction({ locale, className, testId }: { locale: Locale; className?: string; testId?: string }) {
  const session = useSession();
  const open = session !== "signed-out";
  return (
    <Link className={className ?? "bp6-button bp6-intent-primary"} href={open ? `/${locale}/projects` : `/${locale}/login`} {...(testId ? { "data-testid": testId } : {})}>
      <span>{open ? "Open ChemDFT" : "Sign in"}</span>
    </Link>
  );
}

export function HeaderActions({ locale }: { locale: Locale }) {
  const session = useSession();
  return (
    <>
      {session === "signed-in" ? (
        <Link className="home-signin" href={`/${locale}/account`} data-testid="header-account">
          Account
        </Link>
      ) : null}
      <PrimaryAction locale={locale} className="bp6-button bp6-intent-primary home-launch" testId={session === "signed-out" ? "header-signin" : "header-launch"} />
    </>
  );
}
