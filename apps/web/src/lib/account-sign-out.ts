export type SignOutOutcome = "signed-out" | "failed";

export const SIGN_OUT_FAILED_MESSAGE = "Sign out did not complete. You are still signed in. Try again.";
export const DEV_IDENTITY_NOTE = "You are using the local development identity, so there is nothing to sign out of.";

/**
 * What a Better Auth `signOut()` call means for the page. The client resolves with `{ error }` instead of throwing on an HTTP
 * failure, so a missing or non-null `error` decides; a thrown call is passed as `thrown: true`. Only "signed-out" may navigate away.
 */
export function interpretSignOut(result: { error?: unknown } | null | undefined, thrown = false): SignOutOutcome {
  if (thrown || !result || result.error) return "failed";
  return "signed-out";
}
