import { type NextRequest } from "next/server";

import { forwardApiRequest } from "../../../../lib/api-proxy";
import { getApiToken } from "../../../../lib/auth/session";

// Next answers 405 for every HTTP method a Route Handler does not export, so each method the API uses
// must be exported here. See `lib/api-proxy.ts` for the trust boundary (this is not `proxy.ts`).
type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  // Account deletion also has to remove the sign-in record: it has its own route (app/api/account/delete).
  if (path.join("/") === "v1/me/delete") return Response.json({ detail: "Not found." }, { status: 404 });
  // In jwt mode the token is minted server-side from the session cookie; the browser never holds it.
  return forwardApiRequest(request, path, process.env, fetch, (incoming) => getApiToken(incoming.headers));
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
