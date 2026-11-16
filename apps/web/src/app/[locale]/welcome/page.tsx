import Link from "next/link";
import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import styles from "../../_components/onboarding/welcome.module.css";
import { AppIcon } from "@chemdft/ui";
import { BrandMark } from "../../_components/brand-mark";
import { HeroFigure, pathIllustrations } from "../../_components/onboarding/illustrations";
import { WelcomeClient } from "../../_components/onboarding/welcome-client";
import { isGoal, isStartingPath } from "@/lib/onboarding-flow";
import { onboardingMessage } from "@/lib/onboarding-messages";

export const metadata: Metadata = {
  title: "Choose a starting path",
  robots: { index: false, follow: false },
};
export default async function WelcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ path?: string; goal?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  return (
    <div className="projects-index">
      <header className={`project-header standalone-header ${styles.header}`}>
        <Link href={`/${locale}`} className="header-brand">
          <BrandMark />
        </Link>
        <nav className={`header-actions ${styles.nav}`} aria-label="Product navigation">
          <Link href={`/${locale}/projects?welcome=skip`}>
            <AppIcon icon="folder-open" />
            <span className={styles.label}>{onboardingMessage(locale, "projects")}</span>
          </Link>
          <Link href={`/${locale}/learn`}>
            <AppIcon icon="book" />
            <span className={styles.label}>{onboardingMessage(locale, "learn")}</span>
          </Link>
          <Link href={`/${locale}/account`}>
            <AppIcon icon="user" />
            <span className={styles.label}>{onboardingMessage(locale, "account")}</span>
          </Link>
        </nav>
      </header>
      <WelcomeClient
        locale={locale}
        initialPath={isStartingPath(query.path) ? query.path : null}
        initialGoal={isGoal(query.goal) ? query.goal : null}
        illustrations={pathIllustrations()}
        stepIllustrations={pathIllustrations("-step")}
        figure={<HeroFigure />}
      />
    </div>
  );
}
