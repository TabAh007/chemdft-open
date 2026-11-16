import { isUserDisabled } from "./owner";
import { getAuth } from "./server";

/** The signed-in Better Auth session for these request headers, or null. Never throws for "not signed in". */
export async function getSession(headers: Headers) {
  try {
    const { auth } = await getAuth();
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) return null;
    const context = await auth.$context;
    const adapter = context.adapter;
    if (adapter && (await isUserDisabled(adapter as never, session.user.id))) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/**
 * A short-lived (15 min) identity token for the FastAPI resource server, minted from the browser's
 * session cookie. It is created per request on the server and never reaches the browser.
 */
export async function getApiToken(headers: Headers): Promise<string | null> {
  try {
    const { auth } = await getAuth();
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) return null;
    const context = await auth.$context;
    const adapter = context.adapter;
    if (adapter && (await isUserDisabled(adapter as never, session.user.id))) {
      return null;
    }
    const result = (await auth.api.getToken({ headers })) as { token?: string } | null;
    return result?.token ?? null;
  } catch {
    return null;
  }
}
