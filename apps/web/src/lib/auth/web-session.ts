import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { readAuthConfig } from "./config";
import { getSession } from "./session";

/**
 * Authoritative server-side session check for protected pages (jwt mode). `proxy.ts` only does an
 * optimistic cookie check for navigation; this verifies the session against the auth database. API
 * authorization is enforced again by FastAPI and project membership on every request.
 */
export async function requireWebSession(locale: string): Promise<void> {
  let jwtMode = false;
  try {
    jwtMode = readAuthConfig(process.env).authMode === "jwt";
  } catch {
    redirect(`/${locale}/login?error=configuration`);
  }
  if (!jwtMode) return;
  const session = await getSession(await headers());
  if (!session) redirect(`/${locale}/login`);
}
