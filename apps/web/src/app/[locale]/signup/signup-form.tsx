"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { authClient } from "../../../lib/auth/client";

type SignUp = (input: { email: string; password: string; name: string; termsAccepted: boolean; callbackURL: string }) => Promise<{ error: { message?: string; code?: string } | null }>;

export function SignupForm({ locale }: { locale: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const signUp = authClient.signUp.email as unknown as SignUp;
    const result = await signUp({ email, password, name, termsAccepted: terms, callbackURL: `/${locale}/login?verified=1` });
    setBusy(false);
    if (result.error) {
      // Policy refusals (disposable address, terms, rate limit) are safe to name; nothing here reveals whether an address has an account.
      setError(result.error.message ?? "The account could not be created. Try again in a moment.");
      return;
    }
    // The same screen for a new address and for one that already has an account.
    setSent(true);
  }

  if (sent) {
    return (
      <div role="status" data-testid="signup-sent">
        <p>Check your inbox. If this address can be used, we sent a link to verify it. You can sign in after you open the link.</p>
        <p className="auth-notice">The link expires in one hour. Nothing arrived? Check spam, then <Link href={`/${locale}/login`}>sign in</Link> to send a new link.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="auth-form" data-testid="signup-form">
      <label>Name<input type="text" name="name" autoComplete="name" required maxLength={120} value={name} onChange={(e) => setName(e.currentTarget.value)} data-testid="signup-name" /></label>
      <label>Email<input type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} data-testid="signup-email" /></label>
      <label>Password (at least 12 characters)<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.currentTarget.value)} data-testid="signup-password" /></label>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" required checked={terms} onChange={(e) => setTerms(e.currentTarget.checked)} data-testid="signup-terms" style={{ marginTop: 3 }} />
        <span>
          I am at least 13 and accept the <Link href={`/${locale}/terms`} target="_blank">Terms of Use</Link> and <Link href={`/${locale}/privacy`} target="_blank">Privacy Policy</Link>, and I have read the <Link href={`/${locale}/beta`} target="_blank">Beta notice</Link>.
        </span>
      </label>
      {error ? <p role="alert" className="auth-error" data-testid="signup-error">{error}</p> : null}
      <button type="submit" className="bp6-button bp6-intent-primary" disabled={busy || !terms} data-testid="signup-submit">Create account</button>
      <p className="auth-notice">Already have an account? <Link href={`/${locale}/login`}>Sign in</Link></p>
    </form>
  );
}
