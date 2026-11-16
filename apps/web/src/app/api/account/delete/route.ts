import { type NextRequest } from "next/server";

import { forwardApiRequest } from "../../../../lib/api-proxy";
import { getAuth } from "../../../../lib/auth/server";
import { getApiToken, getSession } from "../../../../lib/auth/session";
import { deleteFeedbackReportsForUser } from "../../../../lib/feedback/db";

/**
 * Account deletion (ADR-045). The API deletes the researcher's data and anonymises the ChemDFT user; only
 * after it confirms does this route remove the sign-in itself (credentials, sessions, linked accounts) from
 * the Better Auth database, so a deleted person cannot sign in again with the old password. The generic
 * proxy refuses `/v1/me/delete` so this is the only way to reach it.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession(request.headers);
  if (!session?.user) return Response.json({ detail: "Sign in first." }, { status: 401 });
  const response = await forwardApiRequest(request, ["v1", "me", "delete"], process.env, fetch, (incoming) => getApiToken(incoming.headers));
  if (!response.ok) return response;
  try {
    const { auth } = await getAuth();
    const context = await auth.$context;
    await context.internalAdapter.deleteUserSessions(session.user.id);
    await context.internalAdapter.deleteAccounts(session.user.id);
    await context.internalAdapter.deleteUser(session.user.id);
    try {
      await deleteFeedbackReportsForUser(session.user.id);
    } catch {
      // Lazy-safe: do not fail account deletion if feedback table does not exist
    }
  } catch (cause) {
    console.error("[chemdft-auth] account data deleted but the sign-in record could not be removed", cause instanceof Error ? cause.message : "unknown");
    return Response.json({ deleted: true, sign_in_removed: false }, { status: 500 });
  }
  return response;
}
