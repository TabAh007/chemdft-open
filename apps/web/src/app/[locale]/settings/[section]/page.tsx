import type { Metadata } from "next";
import { isSettingsSection } from "@chemdft/domain";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";

import { readAuthConfig } from "../../../../lib/auth/config";
import { isLocalDevelopment } from "../../../../lib/local-development";
import { ProductHeader } from "../../../_components/product-header";
import { AISettingsPanel } from "../../../_components/settings/ai-settings-panel";
import { BillingUnavailable } from "../../../_components/settings/billing-unavailable";
import { GeneralAccountPanel } from "../../../_components/settings/general-account-panel";
import { LocalDevelopmentProvider } from "../../../_components/local-development-context";
import { SettingsShell, UnavailableSection } from "../../../_components/settings/settings-shell";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export default async function GlobalSettingsPage({ params }: { params: Promise<{ locale: string; section: string }> }) {
  const { locale: candidate, section } = await params;
  if (!isLocale(candidate) || !isSettingsSection(section)) notFound();
  const locale = candidate;
  const localDevelopment = isLocalDevelopment();
  let googleEnabled = false;
  try { googleEnabled = readAuthConfig(process.env).googleEnabled; } catch { /* misconfigured auth: the panel stays hidden */ }

  return (
    <LocalDevelopmentProvider value={localDevelopment}>
      <div className="projects-index">
        <ProductHeader locale={locale} active="settings" />
        <main id="main-content" className="projects-main" style={{ paddingBottom: 30 }}>
          <div className="page-heading"><div><h1>Settings</h1><p>Your account, language and AI preferences.</p></div></div>
          <div style={{ border: "1px solid var(--cdf-line)", borderRadius: 4, background: "var(--cdf-surface)", overflow: "hidden" }}>
            <SettingsShell scope="global" locale={locale} section={section}>
              {section === "general" ? <GeneralAccountPanel locale={locale} googleEnabled={googleEnabled} /> : null}
              {section === "ai" ? <AISettingsPanel /> : null}
              {section === "billing" ? <BillingUnavailable /> : null}
              {section !== "general" && section !== "ai" && section !== "billing" ? <UnavailableSection section={section} scope="global" /> : null}
            </SettingsShell>
          </div>
        </main>
      </div>
    </LocalDevelopmentProvider>
  );
}
