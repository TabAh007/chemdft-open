/**
 * Same-origin forwarding of browser requests to the ChemDFT API (the `/api/chemdft/*` Route Handler).
 *
 * This is NOT Next.js `proxy.ts` (the former Middleware feature, which runs before routing and is where
 * a future session gate belongs). It is our own Route Handler: it must export one function per HTTP
 * method the API uses, because Next answers 405 for any method a Route Handler does not export.
 *
 * Trust boundary: the browser is untrusted. Only an allowlist of request headers is forwarded, so any
 * identity, organization, service-principal, authorization, cookie or internal header a client sends is
 * dropped before the upstream request is built. Only this server layer adds identity headers.
 */

import { isLocalEnvironment } from "./auth/environment";

export const FORWARDED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** The only request headers copied from the browser request to the API request. */
export const FORWARDED_REQUEST_HEADERS = ["accept", "content-type"] as const;

/**
 * The only response headers copied from the API response to the browser.
 *
 * Intentionally minimal; reviewed against every header the API emits today (PF-0.1):
 * - `content-type`, `content-disposition`: JSON bodies and the export/download routes.
 * - `x-content-type-options`: the inline document route (`/documents/{id}/source`) serves user-supplied
 *   files with `nosniff`; dropping it would weaken that control, so it is the one proven addition.
 * Not forwarded because no ChemDFT route needs them: streaming/range (`content-range`, `accept-ranges`;
 * no route streams or honours Range, PDF.js is fed whole files), caching (`etag`, `cache-control`; the
 * API sets none and this layer requests `no-store`), redirects (`location`; none are issued and they
 * are not followed), rate metadata (`retry-after`; the API emits none), cookies (`set-cookie`; the API
 * never sets any and a browser must not receive upstream cookies). Add a header only with a proven need
 * and a regression test.
 */
export const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-disposition", "x-content-type-options"] as const;

/**
 * Scientific evidence-standing headers set by the API on exports and native-artifact downloads. Each is
 * forwarded only when its value is a bare upper-case token (so no CR/LF, spaces or free text can pass), and
 * any response carrying them is forced `no-store`: a download of historical evidence must never be cached
 * or replayed as if it were current.
 */
export const EVIDENCE_RESPONSE_HEADERS = [
  "x-chemdft-evidence-use",
  "x-chemdft-effective-authority",
  "x-chemdft-source-lineage",
  "x-chemdft-verification",
] as const;
const EVIDENCE_TOKEN = /^[A-Z][A-Z_]{0,31}$/;

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";
const DEV_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000010";

export type ProxyEnvironment = Readonly<Record<string, string | undefined>>;

/** Resolves the short-lived API identity token for the signed-in browser session (jwt mode only). */
export type TokenResolver = (request: Request) => Promise<string | null>;

/** Only published-example GET endpoints are public. Copy and every private-project path still authenticate. */
export function isPublicExampleRead(method: string, path: readonly string[]): boolean {
  if (method !== "GET" || path[0] !== "v1" || path[1] !== "examples") return false;
  if (path.length === 2) return true;
  const slug = path[2];
  if (!slug || slug.length > 96 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return false;
  return path.length === 3 || (path.length === 4 && (path[3] === "navigator" || path[3] === "source"));
}

/**
 * Every response this proxy emits - upstream success or error, 400/401/500/502 generated locally, and any
 * unexpected exception - passes through one finalizer. Route classification is computed from the request
 * alone, before any early return, so no path can skip the cache policy: everything except the narrowly
 * scoped public published-example reads is protected and `no-store`.
 */
export async function forwardApiRequest(
  request: Request,
  path: readonly string[],
  environment: ProxyEnvironment = process.env,
  fetchImplementation: typeof fetch = fetch,
  resolveToken?: TokenResolver,
): Promise<Response> {
  const protectedRoute = !isPublicExampleRead(request.method, path);
  let response: Response;
  try {
    response = await handleApiRequest(request, path, environment, fetchImplementation, resolveToken);
  } catch {
    response = Response.json({ detail: "The ChemDFT API proxy failed unexpectedly." }, { status: 500 });
  }
  if (protectedRoute) response.headers.set("cache-control", "no-store");
  return response;
}

async function handleApiRequest(
  request: Request,
  path: readonly string[],
  environment: ProxyEnvironment,
  fetchImplementation: typeof fetch,
  resolveToken?: TokenResolver,
): Promise<Response> {
  if (path.length === 0 || path.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes("/"))) {
    return Response.json({ detail: "Invalid API path." }, { status: 400 });
  }
  const jwtMode = (environment.CHEMDFT_AUTH_MODE ?? "dev").trim().toLowerCase() === "jwt";
  let identity: ReturnType<typeof developmentIdentity>;
  if (isPublicExampleRead(request.method, path)) {
    identity = { ok: true, headers: {} };
  } else if (jwtMode) {
    // The browser session is authenticated here, on the server. There is no fallback to the fixed
    // development identity: no session or token means 401, never "act as the dev user".
    let token: string | null = null;
    try {
      token = resolveToken ? await resolveToken(request) : null;
    } catch {
      token = null;
    }
    if (!token) return Response.json({ detail: "authentication_required" }, { status: 401 });
    identity = { ok: true, headers: { Authorization: `Bearer ${token}` } };
  } else {
    identity = developmentIdentity(environment);
    if (!identity.ok) return Response.json({ detail: identity.detail }, { status: identity.status });
  }

  const sourceUrl = new URL(request.url);
  const upstreamBase = environment.CHEMDFT_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  const upstreamUrl = new URL(`/${path.map(encodeURIComponent).join("/")}${sourceUrl.search}`, upstreamBase);

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  for (const [key, value] of Object.entries(identity.headers)) headers.set(key, value);

  const init: RequestInit = { method: request.method, headers, cache: "no-store", redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }
  let upstream: Response;
  try {
    upstream = await fetchImplementation(upstreamUrl, init);
  } catch {
    return Response.json({ detail: "The ChemDFT API is unreachable." }, { status: 502 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream.headers),
  });
}

function developmentIdentity(
  environment: ProxyEnvironment,
): { ok: true; headers: Record<string, string> } | { ok: false; status: number; detail: string } {
  if (environment.CHEMDFT_DEV_IDENTITY_ENABLED !== "true") return { ok: true, headers: {} };
  if (environment.NODE_ENV === "production") {
    return { ok: false, status: 500, detail: "Development identity is disabled in production builds." };
  }
  // The fixed development identity is for explicitly local environments only; a hosted platform or a
  // non-local CHEMDFT_ENV refuses it even if NODE_ENV is not "production".
  if (!isLocalEnvironment(environment)) {
    return { ok: false, status: 500, detail: "Development identity is only permitted in an explicitly local environment." };
  }
  const userId = environment.CHEMDFT_DEV_USER_ID ?? DEV_USER_ID;
  const organizationId = environment.CHEMDFT_DEV_ORGANIZATION_ID ?? DEV_ORGANIZATION_ID;
  if (!userId || !organizationId) {
    return { ok: false, status: 500, detail: "Development identity is enabled but user or organization configuration is incomplete." };
  }
  return { ok: true, headers: { "X-ChemDFT-User-ID": userId, "X-ChemDFT-Organization-ID": organizationId } };
}

function responseHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  let evidence = false;
  for (const name of EVIDENCE_RESPONSE_HEADERS) {
    const value = source.get(name);
    if (value !== null && EVIDENCE_TOKEN.test(value)) {
      headers.set(name, value);
      evidence = true;
    }
  }
  if (evidence) headers.set("cache-control", "no-store"); // also set for every protected route by the finalizer
  return headers;
}
