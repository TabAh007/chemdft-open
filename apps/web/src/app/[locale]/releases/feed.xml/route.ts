import { isLocale } from "@chemdft/i18n";

import { RELEASES } from "../../../../content/releases";
import { CITATION_METADATA } from "../../../../lib/citation";
import { buildAtomFeed } from "../../../../lib/releases-feed";

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) return new Response("Not found", { status: 404 });
  return new Response(buildAtomFeed(RELEASES, { siteUrl: CITATION_METADATA.url, locale }), {
    headers: { "content-type": "application/atom+xml; charset=utf-8", "cache-control": "public, max-age=600" },
  });
}
