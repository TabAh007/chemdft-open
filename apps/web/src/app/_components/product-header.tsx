import Link from "next/link";
import { AppIcon, StatusTag, type IconName } from "@chemdft/ui";

import { isLocalDevelopment } from "../../lib/local-development";
import { BrandMark } from "./brand-mark";
import { HeaderIdentity } from "./settings/header-identity";
import styles from "./product-header.module.css";

export type ProductHeaderActive = "projects" | "jobs" | "learn" | "releases" | "feedback" | "settings" | "account" | "none";
/** The content column of the page the header sits above, so the header lines up with it (max-width / side padding in px). */
export type ProductHeaderLayout = "wide" | "content" | "standard";

const LAYOUT: Record<ProductHeaderLayout, { max: number; pad: number }> = {
  wide: { max: 1560, pad: 32 }, // Projects
  content: { max: 1240, pad: 32 }, // Learn
  standard: { max: 1180, pad: 30 }, // Jobs, Settings, Account (`.projects-main`)
};

const ITEMS: { key: Exclude<ProductHeaderActive, "account" | "none">; icon: IconName; label: string; path: string }[] = [
  { key: "projects", icon: "folder-open", label: "Projects", path: "projects" },
  { key: "jobs", icon: "timeline-events", label: "Jobs", path: "jobs" },
  { key: "learn", icon: "book", label: "Learn", path: "learn" },
  { key: "releases", icon: "updated", label: "Releases", path: "releases" },
  { key: "feedback", icon: "comment", label: "Feedback", path: "feedback" },
  { key: "settings", icon: "cog", label: "Settings", path: "settings/general" },
];

/**
 * The one signed-in product header for every page outside the project shell: brand, Projects, Jobs, Learn, Releases, Settings, then
 * the identity avatar (the link to Account). The development chip follows `isLocalDevelopment()` and never shows in production.
 */
export function ProductHeader({ locale, active, layout = "standard" }: { locale: string; active: ProductHeaderActive; layout?: ProductHeaderLayout }) {
  const { max, pad } = LAYOUT[layout];
  return (
    <header className={`project-header standalone-header ${styles.header}`} style={{ "--ph-max": `${max}px`, "--ph-pad": `${pad}px` } as React.CSSProperties}>
      <Link href={`/${locale}`} className="header-brand">
        <BrandMark />
      </Link>
      <div className={`header-actions ${styles.right}`}>
        <nav className={styles.nav} aria-label="Product navigation">
          {ITEMS.map((item) => (
            <Link key={item.key} href={`/${locale}/${item.path}`} aria-current={active === item.key ? "page" : undefined}>
              <AppIcon icon={item.icon} />
              <span className={styles.label}>{item.label}</span>
            </Link>
          ))}
        </nav>
        {isLocalDevelopment() ? <StatusTag>Development identity</StatusTag> : null}
        <HeaderIdentity locale={locale} current={active === "account"} />
      </div>
    </header>
  );
}
