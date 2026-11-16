import type { Locale } from "@chemdft/i18n";

export function localePath(locale: Locale, path = ""): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${suffix === "/" ? "" : suffix}`;
}

export function projectPath(locale: Locale, projectId: string, path: string): string {
  return localePath(locale, `/projects/${encodeURIComponent(projectId)}/${path}`);
}
