import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 `proxy.ts` (the former Middleware): an OPTIMISTIC navigation gate only. In jwt mode a
 * request without any session cookie is redirected to the sign-in page before the page renders. The
 * cookie's presence proves nothing: the authoritative checks are the server-side session check in the
 * protected layouts, FastAPI's token verification, and project membership on every API call.
 */
export function proxy(request: NextRequest) {
  if ((process.env.CHEMDFT_AUTH_MODE ?? "dev").trim().toLowerCase() !== "jwt") return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();
  const [, locale] = request.nextUrl.pathname.split("/");
  const login = new URL(`/${locale}/login`, request.url);
  login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/(en|tr|ru|de)/welcome",
    "/(en|tr|ru|de)/projects/:path*",
    "/(en|tr|ru|de)/projects",
    "/(en|tr|ru|de)/jobs/:path*",
    "/(en|tr|ru|de)/jobs",
    "/(en|tr|ru|de)/feedback/:path*",
    "/(en|tr|ru|de)/feedback",
    "/(en|tr|ru|de)/settings/:path*",
    "/(en|tr|ru|de)/settings",
    "/(en|tr|ru|de)/account",
  ],
};
