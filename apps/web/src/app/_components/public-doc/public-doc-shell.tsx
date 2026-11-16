import type { ReactNode } from "react";

import { ProductHeader, type ProductHeaderActive } from "../product-header";
import { SiteFooter } from "../site-footer";
import styles from "./public-doc.module.css";

/** The frame of the public documentation pages (Releases, License): product header, main column, site footer. */
export function PublicDocShell({ locale, active, children }: { locale: string; active: ProductHeaderActive; children: ReactNode }) {
  return (
    <div className={`projects-index ${styles.page}`}>
      <ProductHeader locale={locale} active={active} layout="content" />
      <main id="main-content" className={styles.main}>
        {children}
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
