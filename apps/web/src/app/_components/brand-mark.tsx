/**
 * The ChemDFT logo (owner artwork, apps/web/public/brand/BRAND_README.txt).
 * ChemDFT has no dark theme, so only the light files are used.
 * Full: horizontal logo. Compact: the mark (mark-small below 48px height, mark at 48px and above).
 * The SVG is an <img> with explicit width/height so nothing shifts while it loads; it carries the only
 * accessible name "ChemDFT" (no visible text beside it, so nothing is announced twice).
 */
export const BRAND_FILES = {
  horizontal: "/brand/svg/logo-horizontal-light.svg",
  mark: "/brand/svg/mark-light.svg",
  markSmall: "/brand/svg/mark-small-light.svg",
} as const;

const FULL_HEIGHT = 52; // logo-horizontal-light.svg is 711x262, with transparent padding trimmed by CSS (.brand-image margins)
const FULL_WIDTH = Math.round((FULL_HEIGHT * 711) / 262);
const COMPACT_HEIGHT = 32; // mark-light.svg is 1038.5x1000
const COMPACT_WIDTH = Math.round((COMPACT_HEIGHT * 1038.5) / 1000);

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const mark = compact && COMPACT_HEIGHT < 48 ? BRAND_FILES.markSmall : BRAND_FILES.mark;
  return (
    <span className="brand-mark" data-variant={compact ? "compact" : "full"}>
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG master, no optimisation wanted */}
      <img
        className="brand-image"
        src={compact ? mark : BRAND_FILES.horizontal}
        alt="ChemDFT"
        width={compact ? COMPACT_WIDTH : FULL_WIDTH}
        height={compact ? COMPACT_HEIGHT : FULL_HEIGHT}
        decoding="async"
      />
    </span>
  );
}
