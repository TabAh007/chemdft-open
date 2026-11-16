"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { authClient } from "../../../lib/auth/client";

type Request = (input: { email: string; redirectTo: string }) => Promise<unknown>;

export function ForgotForm({ locale }: { locale: string }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await (authClient.requestPasswordReset as unknown as Request)({ email, redirectTo: `/${locale}/reset-password` });
    } catch {
      // The answer below is the same either way: it never says whether an address has an account.
    }
    setBusy(false);
    setDone(true);
  }

  if (done) {
    return (
      <p role="status" data-testid="forgot-sent">
        If an account exists for that address, we sent a link to choose a new password. It expires in one hour. <Link href={`/${locale}/login`}>Back to sign in</Link>
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="auth-form" data-testid="forgot-form">
      <label>Email<input type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} data-testid="forgot-email" /></label>
      <button type="submit" className="bp6-button bp6-intent-primary" disabled={busy} data-testid="forgot-submit">Send reset link</button>
      <p className="auth-notice">Password reset by email works only on accounts with a password and while email delivery is available.</p>
    </form>
  );
}
