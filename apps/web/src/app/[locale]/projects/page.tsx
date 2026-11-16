import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";

import { ProductHeader } from "../../_components/product-header";
import styles from "../../_components/projects/projects.module.css";
import { ProjectsClient } from "./projects-client";

export default async function ProjectsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: candidate } = await params;
  if (!isLocale(candidate)) notFound();
  const locale = candidate;
  const authMode = process.env.CHEMDFT_AUTH_MODE?.trim().toLowerCase() === "jwt" ? "jwt" : "dev";
  const devIdentityEnabled = authMode === "dev" && process.env.CHEMDFT_DEV_IDENTITY_ENABLED === "true" && process.env.NODE_ENV !== "production";

  return (
    <div className={`projects-index ${styles.page}`}>
      <ProductHeader locale={locale} active="projects" layout="wide" />
      <main id="main-content" className={styles.main}>
        <ProjectsClient locale={locale} devIdentityEnabled={devIdentityEnabled} authMode={authMode} />
      </main>
    </div>
  );
}
