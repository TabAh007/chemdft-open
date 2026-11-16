"use client";

import { localeNames, locales, usesEnglishFallback, type Locale } from "@chemdft/i18n";
import Link from "next/link";
import { useEffect, useState } from "react";

import { authModeLabel, roleLabel } from "../../../lib/settings-model";
import { AccountDataPanel } from "./account-data-panel";
import { GooglePanel } from "./google-panel";
import { OrcidPanel } from "./orcid-panel";
import { SectionHead } from "./settings-shell";
import styles from "./settings.module.css";

type Me = { id: string; display_name: string; email: string; kind: string; auth_mode: string; organization: { name: string; kind: string; role: string }; setup: { project_count: number } };

export function GeneralAccountPanel({ locale, googleEnabled = false }: { locale: Locale; googleEnabled?: boolean }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chemdft/v1/me", { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(String(response.status)); return (await response.json()) as Me; })
      .then((value) => { if (!cancelled) setMe(value); })
      .catch(() => { if (!cancelled) setError("Your account details could not be loaded. Reload the page to try again."); });
    return () => { cancelled = true; };
  }, []);
  return (
    <div data-testid="general-settings">
      <SectionHead title="General" lead="Your account and interface language." />
      <div style={{ display: "grid", gap: 18, marginTop: 22 }}>
        <section className={styles.card} aria-labelledby="general-account-heading">
          <div className={styles.cardHead}><h3 id="general-account-heading">Account</h3></div>
          <div className={styles.cardBody}>
            {error ? <p role="alert" className={styles.error}>{error}</p> : !me ? <p role="status" className={styles.muted}>Loading account…</p> : (
              <dl className={styles.facts} data-testid="account-facts">
                <div><dt>Name</dt><dd data-testid="settings-account-name">{me.display_name}</dd></div>
                <div><dt>Email</dt><dd data-testid="settings-account-email">{me.email}</dd></div>
                <div><dt>Workspace</dt><dd data-testid="settings-account-organization">{me.organization.name}</dd></div>
                <div><dt>Your role</dt><dd title={me.organization.role}>{roleLabel(me.organization.role)}</dd></div>
                <div><dt>Projects</dt><dd>{me.setup.project_count}</dd></div>
                <div><dt>Sign-in</dt><dd title={me.auth_mode}>{authModeLabel(me.auth_mode)}</dd></div>
              </dl>
            )}
          </div>
        </section>
        <OrcidPanel />
        {googleEnabled ? <GooglePanel locale={locale} /> : null}
        <AccountDataPanel locale={locale} email={me?.email ?? null} canDelete={me?.auth_mode === "jwt"} />
        <section className={styles.card} aria-labelledby="general-language-heading">
          <div className={styles.cardHead}><h3 id="general-language-heading">Interface language</h3></div>
          <div className={styles.cardBody}>
            <nav className={styles.langRow} aria-label="Interface language">
              {locales.map((candidate) => (
                <Link key={candidate} href={`/${candidate}/settings/general`} aria-current={candidate === locale ? "page" : undefined} lang={candidate} title={localeNames[candidate]}>{localeNames[candidate]}</Link>
              ))}
            </nav>
            {usesEnglishFallback(locale) ? <p className={styles.caption}>Translations are not available yet, so the interface text is shown in English.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
