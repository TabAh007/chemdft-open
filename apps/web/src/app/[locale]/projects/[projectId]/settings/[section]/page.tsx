import { isSettingsSection } from "@chemdft/domain";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";

import { ProjectAiPanel, ProjectGeneralPanel, ProjectSettingsDock } from "../../../../../_components/settings/project-settings-panels";
import { SettingsShell, UnavailableSection } from "../../../../../_components/settings/settings-shell";

export default async function SettingsPage({ params }: { params: Promise<{ locale: string; projectId: string; section: string }> }) {
  const { locale: candidate, projectId, section } = await params;
  if (!isLocale(candidate) || !isSettingsSection(section)) notFound();
  const locale = candidate;

  return (
    <div data-testid="project-settings" style={{ minHeight: "100%" }}>
      <ProjectSettingsDock projectId={projectId} />
      <h1 className="ai-visually-hidden">Project settings</h1>
      <SettingsShell scope="project" locale={locale} projectId={projectId} section={section}>
        {section === "general" ? <ProjectGeneralPanel projectId={projectId} /> : null}
        {section === "ai" ? <ProjectAiPanel locale={locale} /> : null}
        {section !== "general" && section !== "ai" ? <UnavailableSection section={section} scope="project" /> : null}
      </SettingsShell>
    </div>
  );
}
