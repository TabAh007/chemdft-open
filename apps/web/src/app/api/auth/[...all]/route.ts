import { toNextJsHandler } from "better-auth/next-js";

import { readAuthConfig } from "../../../../lib/auth/config";
import { getAuth } from "../../../../lib/auth/server";

// Better Auth's own endpoints (sign-in, sign-out, session, JWKS, OAuth callbacks). Only mounted when
// CHEMDFT_AUTH_MODE=jwt; in dev mode there is nothing to serve and the route answers 404.
async function handler(request: Request): Promise<Response> {
  let enabled = false;
  try {
    enabled = readAuthConfig(process.env).authMode === "jwt";
  } catch {
    return Response.json({ detail: "Authentication is misconfigured." }, { status: 500 });
  }
  if (!enabled) return Response.json({ detail: "Not found." }, { status: 404 });
  const { auth } = await getAuth();
  const handlers = toNextJsHandler(auth);
  return request.method === "GET" ? handlers.GET(request) : handlers.POST(request);
}

export const GET = handler;
export const POST = handler;
