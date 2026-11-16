import { locales } from "@chemdft/i18n";

/**
 * Only same-origin application paths may be used as a post-login destination. Anything else
 * (absolute URLs, protocol-relative `//host`, backslash tricks, control characters, unknown locales)
 * falls back to the project list, so a crafted `?next=` can never redirect off-site.
 */
export function safeRedirectPath(candidate: string | null | undefined, locale: string): string {
  const fallback = `/${locale}/projects`;
  if (!candidate) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback;
  let url: URL;
  try {
    url = new URL(candidate, "http://chemdft.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://chemdft.invalid") return fallback;
  const [, first] = url.pathname.split("/");
  if (!first || !(locales as readonly string[]).includes(first)) return fallback;
  if (url.pathname.startsWith(`/${first}/login`)) return fallback;
  return `${url.pathname}${url.search}`;
}
