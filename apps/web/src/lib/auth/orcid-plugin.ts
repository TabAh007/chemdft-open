import { createHash, randomBytes } from "node:crypto";

import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";

import type { AuthConfig } from "./config.ts";
import type { Environment } from "./environment.ts";
import { safeRedirectPath } from "./safe-redirect.ts";

/**
 * Sign in with ORCID for ALREADY LINKED accounts (ADR-044). The OAuth exchange, the id_token check and the
 * "is this iD linked" decision all happen in the ChemDFT API (it holds the ORCID client secret). This plugin only:
 *  - starts the flow and binds it to this browser with an HttpOnly cookie (defeats login CSRF);
 *  - on completion asks the API for the Better Auth subject of the linked account and creates a normal session.
 * It never creates a user: an unlinked iD is refused by the API, and `findUserById` must find an existing user.
 */
export const ORCID_BINDING_COOKIE = "chemdft_orcid_binding";
export const ORCID_NEXT_COOKIE = "chemdft_orcid_next";
const BINDING_MAX_AGE = 600;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function apiBase(environment: Environment): string {
  return (environment.CHEMDFT_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
}

async function callApi(environment: Environment, path: string, body: unknown): Promise<Response> {
  return fetch(`${apiBase(environment)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
}

export function orcidSignIn(config: AuthConfig, environment: Environment): BetterAuthPlugin {
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: config.secureCookies, path: "/", maxAge: BINDING_MAX_AGE };
  return {
    id: "chemdft-orcid-signin",
    endpoints: {
      orcidSignInStart: createAuthEndpoint("/orcid/start", { method: "GET" }, async (ctx) => {
        const binding = randomBytes(32).toString("hex");
        const forwarded = ctx.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
        let response: Response;
        try {
          response = await callApi(environment, "/v1/orcid/signin/start", {
            binding_hash: sha256(binding),
            ...(forwarded ? { source_hash: sha256(forwarded) } : {}),
          });
        } catch {
          throw ctx.redirect("/en/login?orcid=unavailable");
        }
        if (!response.ok) throw ctx.redirect(`/en/login?orcid=${response.status === 429 ? "busy" : "unavailable"}`);
        const { authorize_url: authorizeUrl } = (await response.json()) as { authorize_url?: string };
        if (!authorizeUrl || !/^https:\/\/(sandbox\.)?orcid\.org\/oauth\/authorize\?/.test(authorizeUrl)) {
          throw ctx.redirect("/en/login?orcid=unavailable");
        }
        ctx.setCookie(ORCID_BINDING_COOKIE, binding, cookieOptions);
        const next = (ctx.query as { next?: string } | undefined)?.next;
        ctx.setCookie(ORCID_NEXT_COOKIE, safeRedirectPath(next, "en"), cookieOptions);
        throw ctx.redirect(authorizeUrl);
      }),
      orcidSignInComplete: createAuthEndpoint(
        "/orcid/complete",
        { method: "POST" },
        async (ctx) => {
          const { code, state } = (ctx.body ?? {}) as { code?: unknown; state?: unknown };
          if (typeof code !== "string" || !code || code.length > 512 || typeof state !== "string" || !state || state.length > 128) {
            throw new APIError("BAD_REQUEST", { code: "state_invalid", message: "state_invalid" });
          }
          const binding = ctx.getCookie(ORCID_BINDING_COOKIE);
          const next = safeRedirectPath(ctx.getCookie(ORCID_NEXT_COOKIE) ?? undefined, "en");
          ctx.setCookie(ORCID_BINDING_COOKIE, "", { ...cookieOptions, maxAge: 0 });
          ctx.setCookie(ORCID_NEXT_COOKIE, "", { ...cookieOptions, maxAge: 0 });
          if (!binding) throw new APIError("BAD_REQUEST", { code: "state_invalid", message: "state_invalid" });
          let response: Response;
          try {
            response = await callApi(environment, "/v1/orcid/signin/complete", { code, state, binding });
          } catch {
            throw new APIError("BAD_GATEWAY", { code: "orcid_unavailable", message: "orcid_unavailable" });
          }
          if (!response.ok) {
            const detail = ((await response.json().catch(() => ({}))) as { detail?: string }).detail;
            // One public answer for every refusal that is about the account: no hint whether an iD exists.
            const code = detail === "not_linked" ? "not_linked" : detail === "state_invalid" ? "state_invalid" : "orcid_failed";
            throw new APIError(response.status === 403 ? "FORBIDDEN" : "BAD_REQUEST", { code, message: code });
          }
          const { subject } = (await response.json()) as { subject?: string };
          const user = subject ? await ctx.context.internalAdapter.findUserById(subject) : null;
          if (!user) throw new APIError("FORBIDDEN", { code: "not_linked", message: "not_linked" });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true, next });
        },
      ),
    },
  };
}
