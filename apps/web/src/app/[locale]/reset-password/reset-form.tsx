"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { authClient } from "../../../lib/auth/client";

type Reset = (input: { newPassword: string; token: string }) => Promise<{ error: { message?: string } | null }>;

export function ResetForm({ locale, token }: { locale: string; token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await (authClient.resetPassword as unknown as Reset)({ newPassword: password, token });
    setBusy(false);
    if (result.error) setError("This reset link is invalid or has expired, or the password is too short.");
    else setDone(true);
  }

  if (done) return <p role="status" data-testid="reset-done">Your password was changed. <Link href={`/${locale}/login`}>Sign in</Link></p>;
  return (
    <form onSubmit={submit} className="auth-form" data-testid="reset-form">
      <label>New password (at least 12 characters)<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.currentTarget.value)} data-testid="reset-password" /></label>
      {error ? <p role="alert" className="auth-error" data-testid="reset-error">{error}</p> : null}
      <button type="submit" className="bp6-button bp6-intent-primary" disabled={busy} data-testid="reset-submit">Change password</button>
    </form>
  );
}
