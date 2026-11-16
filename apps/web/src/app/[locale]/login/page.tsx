import { isLocale } from "@chemdft/i18n";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandMark } from "../../_components/brand-mark";
import { AuthConfigError, readAuthConfig, selfServiceSignupEnabled } from "../../../lib/auth/config";
import { safeRedirectPath } from "../../../lib/auth/safe-redirect";
import { plainGoogleError } from "../../../lib/auth/google";
import { plainOrcidError } from "../../../lib/orcid";
import { SiteFooter } from "../../_components/site-footer";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

type PageProps = { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string; error?: string; orcid?: string; verified?: string }> };

export default async function LoginPage({ params, searchParams }: PageProps) {
  const { locale: candidate } = await params;
  if (!isLocale(candidate)) notFound();
  const locale = candidate;
  const { next, error, orcid, verified } = await searchParams;
  let state: { authMode: "dev" | "jwt"; googleEnabled: boolean; googleSignupAllowed: boolean; orcidEnabled: boolean; publicSignupEnabled: boolean; selfService: boolean } | { misconfigured: true };
  try {
    const config = readAuthConfig(process.env);
    state = {
      authMode: config.authMode,
      googleEnabled: config.googleEnabled,
      googleSignupAllowed: config.googleSignupAllowed,
      orcidEnabled: config.orcidEnabled,
      publicSignupEnabled: config.publicSignupEnabled,
      selfService: selfServiceSignupEnabled(config),
    };
  } catch (cause) {
    if (!(cause instanceof AuthConfigError)) throw cause;
    state = { misconfigured: true };
  }
  const destination = safeRedirectPath(next, locale);

  return (
    <div className="projects-index">
      <header className="project-header standalone-header">
        <Link href={`/${locale}`} className="header-brand"><BrandMark /></Link>
      </header>
      <main id="main-content" className="projects-main auth-main">
        <section className="auth-card" aria-labelledby="sign-in-title">
          <h1 id="sign-in-title">Sign in to ChemDFT</h1>
          {"misconfigured" in state || error === "configuration" ? (
            <p role="alert" className="auth-notice">Sign-in is not available: the authentication configuration is incomplete.</p>
          ) : state.authMode === "dev" ? (
            <p className="auth-notice">This environment uses the local development identity; sign-in is not required. <Link href={`/${locale}/projects`}>Open projects</Link></p>
          ) : (
            <>
              {orcid ? <p role="alert" className="auth-error" data-testid="login-orcid-notice">{plainOrcidError(orcid)}</p> : null}
              {plainGoogleError(error, { selfService: state.selfService, googleOnly: state.googleSignupAllowed }, locale) ? (
                <p role="alert" className="auth-error" data-testid="login-google-error">{plainGoogleError(error, { selfService: state.selfService, googleOnly: state.googleSignupAllowed }, locale)}</p>
              ) : null}
              {verified ? <p role="status" className="auth-notice" data-testid="login-verified">Your email address is verified. Sign in to continue.</p> : null}
              <LoginForm destination={destination} googleEnabled={state.googleEnabled} googleSignupAllowed={state.googleSignupAllowed} orcidEnabled={state.orcidEnabled} locale={locale} selfService={state.selfService} />
              {state.publicSignupEnabled ? null : state.googleSignupAllowed ? (
                <p className="auth-notice" data-testid="signup-google-only">Email and password sign-up is closed. New beta accounts are accepted via Google.</p>
              ) : (
                <p className="auth-notice" data-testid="signup-closed">ChemDFT is in a private pre-launch period. Accounts are created by invitation only.</p>
              )}
            </>
          )}
        </section>
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
