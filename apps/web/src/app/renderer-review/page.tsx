import { notFound } from "next/navigation";

import { RendererReview, type ReviewQuery } from "./review-client";

export const metadata = { title: "Renderer review", robots: { index: false, follow: false } };
// Rendered per request so a production server answers with a real 404 rather than a prerendered not-found shell.
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Development-only review surface for the molecular renderer (PF-3D). It does not exist in production builds. */
export default async function RendererReviewPage({ searchParams }: PageProps) {
  if (process.env.NODE_ENV === "production") notFound();
  const raw = await searchParams;
  const first = (key: string) => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const query: ReviewQuery = {
    rep: first("rep") ?? null,
    preset: first("preset") ?? null,
    n: first("n") ?? null,
    sc: first("sc") ?? null,
    structure: first("structure") ?? null,
    rotate: first("rotate") ?? null,
    cell: first("cell") ?? null,
    labels: first("labels") ?? null,
    projection: first("projection") ?? null,
    zoom: first("zoom") ?? null,
    az: first("az") ?? null,
    pol: first("pol") ?? null,
    ui: first("ui") ?? null,
    w: first("w") ?? null,
    h: first("h") ?? null,
    ao: first("ao") ?? null,
    offx: first("offx") ?? null,
  };
  return <RendererReview query={query} />;
}
