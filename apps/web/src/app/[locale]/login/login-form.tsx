"use client";

import { useState, type FormEvent } from "react";

import { authClient } from "../../../lib/auth/client";
import { plainGoogleError } from "../../../lib/auth/google";
import { GoogleButton } from "../../_components/google-button";

export function LoginForm({
  destination,
  googleEnabled,
  googleSignupAllowed = false,
  orcidEnabled = false,
  locale = "en",
  selfService = false,
}: {
  destination: string;
  googleEnabled: boolean;
  googleSignupAllowed?: boolean;
  orcidEnabled?: boolean;
  locale?: string;
  selfService?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [googleTermsError, setGoogleTermsError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      // Same message for every failure, except a correct password on an unverified address (Better Auth only reaches that
      // after the password matched, and resends the link): never reveals whether an email has an account.
      setError(result.error.code === "EMAIL_NOT_VERIFIED" ? "Verify your email address first. We sent you a new link." : "The email or password is incorrect.");
      setBusy(false);
      return;
    }
    // `destination` was validated on the server (same-origin application path only).
    window.location.assign(destination);
  }

  return (
    <>
    <form onSubmit={submit} className="auth-form" data-testid="login-form">
      <label>Email<input type="email" name="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} data-testid="login-email" /></label>
      <label>Password<input type="password" name="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.currentTarget.value)} data-testid="login-password" /></label>
      {error ? <p role="alert" className="auth-error" data-testid="login-error">{error}</p> : null}
      <button type="submit" className="bp6-button bp6-intent-primary" disabled={busy} data-testid="login-submit">Sign in</button>
      {selfService ? <p className="auth-notice"><a href={`/${locale}/forgot-password`}>Forgot your password?</a> · <a href={`/${locale}/signup`} data-testid="login-create-account">Create an account</a></p> : null}
    </form>
    {googleEnabled ? (
      <div className="auth-form" data-testid="login-google-block">
        <p className="auth-or" aria-hidden="true">or</p>
        {googleSignupAllowed ? (
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: "0.875rem", marginBottom: 8, cursor: "pointer" }} data-testid="login-terms-label">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => {
                setTermsAccepted(e.currentTarget.checked);
                if (e.currentTarget.checked) setGoogleTermsError(null);
              }}
              data-testid="login-terms-checkbox"
              style={{ marginTop: 3 }}
            />
            <span>
              I accept the <a href={`/${locale}/terms`} target="_blank" rel="noopener noreferrer">Terms of Use</a> and{" "}
              <a href={`/${locale}/privacy`} target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
            </span>
          </label>
        ) : null}
        {googleTermsError ? (
          <p role="alert" className="auth-error" data-testid="login-google-terms-error" style={{ marginBottom: 8 }}>
            {googleTermsError}
          </p>
        ) : null}
        <GoogleButton
          data-testid="login-google"
          onClick={() => {
            if (googleSignupAllowed) {
              if (!termsAccepted) {
                setGoogleTermsError(plainGoogleError("terms_not_accepted", {}, locale) ?? "Accept the Terms of Use and Privacy Policy to create an account.");
                return;
              }
              document.cookie = "chemdft_terms_accepted=true; path=/; max-age=600; SameSite=Lax";
            }
            void authClient.signIn.social({ provider: "google", callbackURL: destination, errorCallbackURL: `/${locale}/login` });
          }}
        />
        {googleSignupAllowed ? (
          <p className="auth-notice" data-testid="google-signup-notice">New beta testers can create an account with Google. Existing accounts sign in directly.</p>
        ) : (
          <p className="auth-notice">Google works only for accounts that already exist. It never creates a new one.</p>
        )}
      </div>
    ) : null}
    {orcidEnabled ? (
      // A plain GET form: the start URL is a route handler that redirects to ORCID, so it needs a full navigation.
      <form
        method="get"
        action="/api/auth/orcid/start"
        className="auth-form"
      >
        <input type="hidden" name="next" value={destination} />
        <button type="submit" className="bp6-button" data-testid="login-orcid">
          {/* eslint-disable-next-line @next/next/no-img-element -- the official ORCID iD icon, used as provided */}
          <img src="/orcid-id-icon.svg" alt="" width={20} height={20} style={{ marginRight: 8, verticalAlign: "middle" }} />
          Sign in with ORCID
        </button>
        <p className="auth-notice">ORCID sign-in works only for accounts that already linked an ORCID iD in Settings. <a href="https://orcid.org" target="_blank" rel="noopener noreferrer">What is ORCID?</a></p>
      </form>
    ) : null}
    </>
  );
}
