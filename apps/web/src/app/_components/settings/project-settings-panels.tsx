"use client";

import type { AISettingsView } from "@chemdft/schemas";
import { StatusTag } from "@chemdft/ui";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { getAiSettings } from "@/lib/ai-scientist-api";
import { modelChoices, savedPreferenceUnavailable } from "@/lib/ai-model-choices";
import { getProject, ProjectApiError, renameProject, type ProjectRead } from "@/lib/project-api";
import { aiErrorLabel, aiModeLabel, modelDisplayName, providerLabel } from "@/lib/scientific-labels";
import { canRenameProject, cleanProjectName, projectNameProblem, renameErrorText, roleLabel } from "@/lib/settings-model";
import { useLocalDevelopment } from "../local-development-context";
import { useWorkspaceState } from "../workspace-state-provider";
import { useOverviewDock } from "@/lib/overview-dock";
import { useAiPageContext } from "@/lib/ai-context";
import { SectionHead } from "./settings-shell";
import styles from "./settings.module.css";

const when = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(); };

/** Project General: the project as the server records it. Only the name can be changed; the address never does. */
export function ProjectGeneralPanel({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getProject(projectId).then((value) => { if (!cancelled) setProject(value); }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "The project could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [projectId]);
  return (
    <div data-testid="project-general-settings">
      <SectionHead title="General" lead="How this project is recorded on the server." />
      <section className={styles.card} style={{ marginTop: 22 }} aria-labelledby="project-identity-heading">
        <div className={styles.cardHead}><h3 id="project-identity-heading">Project</h3></div>
        <div className={styles.cardBody}>
          {error ? <p role="alert" className={styles.error}>{error}</p> : !project ? <p role="status" className={styles.muted}>Loading project…</p> : <>
            <dl className={styles.facts}>
              <div><dt>Name</dt><dd><ProjectNameEditor project={project} onSaved={setProject} /></dd></div>
              <div><dt>Address</dt><dd className={styles.mono}>{project.slug}</dd></div>
              <div><dt>Your role</dt><dd title={project.role}>{roleLabel(project.role)}</dd></div>
              <div><dt>Created</dt><dd title={project.created_at}>{when(project.created_at)}</dd></div>
              <div><dt>Last updated</dt><dd title={project.updated_at}>{when(project.updated_at)}</dd></div>
              <div><dt>Project ID</dt><dd className={styles.mono}>{project.id}</dd></div>
            </dl>
            <p className={styles.caption} data-testid="project-rename-note">{canRenameProject(project.role) ? "Renaming changes the name only. The address stays the same." : "Only owners and editors can rename a project."}</p>
          </>}
        </div>
      </section>
    </div>
  );
}

function ProjectNameEditor({ project, onSaved }: { project: ProjectRead; onSaved: (project: ProjectRead) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const allowed = canRenameProject(project.role);
  const cancel = () => { setEditing(false); setDraft(project.name); setProblem(null); };
  const save = async () => {
    const invalid = projectNameProblem(draft);
    if (invalid) { setProblem(invalid); return; }
    if (cleanProjectName(draft) === project.name) { cancel(); return; }
    setSaving(true); setProblem(null);
    try {
      const updated = await renameProject(project.id, cleanProjectName(draft));
      onSaved(updated); setEditing(false);
    } catch (reason: unknown) {
      setProblem(renameErrorText(reason instanceof ProjectApiError ? reason.status : null));
    } finally { setSaving(false); }
  };
  if (!editing) {
    return (
      <span className={styles.nameRow}>
        <span data-testid="project-name">{project.name}</span>
        {allowed ? <button type="button" className={styles.link} data-testid="project-rename-start" onClick={() => { setDraft(project.name); setEditing(true); }}>Rename</button> : null}
      </span>
    );
  }
  return (
    <form className={styles.nameForm} onSubmit={(event) => { event.preventDefault(); void save(); }}
      onKeyDown={(event) => { if (event.key === "Escape" && !saving) cancel(); }}>
      <span className={styles.nameRow}>
        <input aria-label="Project name" data-testid="project-name-input" type="text" value={draft} maxLength={200} autoFocus disabled={saving}
          aria-invalid={problem ? true : undefined} aria-describedby={problem ? "project-name-problem" : undefined}
          onChange={(event) => { setDraft(event.target.value); setProblem(null); }} />
        <button type="submit" className={styles.link} data-testid="project-rename-save" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className={styles.link} data-testid="project-rename-cancel" disabled={saving} onClick={cancel}>Cancel</button>
      </span>
      <span className={styles.nameProblem} id="project-name-problem" role="alert" data-testid="project-rename-problem">{problem ?? ""}</span>
    </form>
  );
}

/** Project AI: the model preference belongs to the person, not the project, so this is a read-only view with a link to where it changes. */
export function ProjectAiPanel({ locale }: { locale: string }) {
  const allowLocalTest = useLocalDevelopment();
  const [view, setView] = useState<AISettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getAiSettings().then((value) => { if (!cancelled) setView(value); }).catch(() => { if (!cancelled) setError("AI settings could not be loaded."); });
    return () => { cancelled = true; };
  }, []);
  const choices = useMemo(() => modelChoices(view, { allowLocalTest }), [view, allowLocalTest]);
  const unavailable = savedPreferenceUnavailable(view, choices);
  const availability = view?.availability;
  const current = availability ? choices.find((choice) => choice.provider === availability.provider && choice.model === availability.model) ?? null : null;
  return (
    <div data-testid="project-ai-settings">
      <SectionHead title="AI" lead="The AI model you use follows your account, not this project."
        tag={availability ? <StatusTag intent={availability.available ? "success" : "none"}>{availability.available ? "Available" : "Unavailable"}</StatusTag> : undefined} />
      <section className={styles.card} style={{ marginTop: 22 }} aria-labelledby="project-ai-heading">
        <div className={styles.cardHead}><h3 id="project-ai-heading">Your current setting</h3></div>
        <div className={styles.cardBody}>
          {error ? <p role="alert" className={styles.error}>{error}</p> : !availability ? <p role="status" className={styles.muted}>Loading AI settings…</p> : unavailable ? (
            <p className={`${styles.notice} ${styles.noticeWarn}`}>Your saved model is not available in this environment. Choose one in your account AI settings.</p>
          ) : (
            <dl className={styles.facts} data-testid="project-ai-current" data-mode={availability.mode} data-provider={availability.provider} data-error-code={availability.error_code ?? ""}>
              <div><dt>AI source</dt><dd title={availability.mode}>{aiModeLabel(availability.mode)}</dd></div>
              <div><dt>Model</dt><dd title={availability.model}>{current?.capability ? modelDisplayName(current.capability.display_name, current.capability.provider) : availability.model}</dd></div>
              <div><dt>Provider</dt><dd title={availability.provider}>{providerLabel(availability.provider)}</dd></div>
              <div><dt>Status</dt><dd title={availability.error_code ?? undefined}>{availability.error_code ? aiErrorLabel(availability.error_code) : availability.available ? "Ready to use" : "Unavailable"}</dd></div>
            </dl>
          )}
          <p className={styles.caption}>Change the model or your provider key in <Link className={styles.link} href={`/${locale}/settings/ai`}>account AI settings</Link>, or switch models from the AI Scientist panel.</p>
        </div>
      </section>
    </div>
  );
}

/** Lets the header AI Scientist button show or hide the dock on Settings, as on Jobs and Compare. It never changes the dock otherwise. */
export function ProjectSettingsDock({ projectId }: { projectId: string }) {
  const { workspaceMode } = useWorkspaceState();
  useOverviewDock(projectId, workspaceMode);
  useAiPageContext(projectId, { page: "project", section: "settings", label: "Settings" });
  return null;
}
