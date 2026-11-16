"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { defaultLocale, isLocale } from "@chemdft/i18n";
import { getProject, type ProjectRead } from "@/lib/project-api";
import { navigatorHref } from "@/lib/navigator-navigation";
import { overviewCounts, planContinue, plural, readinessRows, restrictionSummary } from "@/lib/overview-model";
import { useOverviewDock } from "@/lib/overview-dock";
import { useAiPageContext } from "@/lib/ai-context";
import { loadActiveStructure } from "@/lib/overview-structure";
import { useOverviewNavigator } from "@/lib/use-overview-navigator";
import { useWorkspaceState } from "../workspace-state-provider";
import { OverviewActivity } from "./overview-activity";
import { OverviewHeader } from "./overview-header";
import { OverviewNavigator } from "./overview-navigator";
import { OverviewResults } from "./overview-results";
import { StructureStage, type StructureLoad } from "./overview-stage";
import { OverviewStatus } from "./overview-status";
import styles from "./overview.module.css";

/** Still reading after this long: say so instead of showing placeholders forever (the catalogue never reported ready). */
const SLOW_RECORDS_MS = 12_000;

type StatusCell = { id: string; label: string; value: string; sub: string; tone?: "attention" | undefined };

export function ProjectOverview({ projectId, structureVersionId }: { projectId: string; structureVersionId?: string | undefined }) {
  const candidate = useLocale();
  const locale = isLocale(candidate) ? candidate : defaultLocale;
  const navigator = useOverviewNavigator(projectId, structureVersionId);
  const { catalog, catalogReady, workspaceMode } = useWorkspaceState();
  useOverviewDock(projectId, workspaceMode);
  useAiPageContext(projectId, { page: "project", section: "overview", label: "Overview" });
  const [project, setProject] = useState<ProjectRead | null>(null);
  const [slow, setSlow] = useState(false);
  const [structure, setStructure] = useState<StructureLoad>({ status: "idle" });

  useEffect(() => {
    let active = true;
    void getProject(projectId).then((value) => { if (active) setProject(value); }).catch(() => {});
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    if (catalogReady) return;
    const timer = window.setTimeout(() => setSlow(true), SLOW_RECORDS_MS);
    return () => window.clearTimeout(timer);
  }, [catalogReady]);

  // The exact committed version the server Navigator is scoped to. No version → nothing to draw, nothing invented.
  const facts = navigator.state?.facts_summary;
  const structureId = facts?.structure_id ?? null;
  const versionId = facts?.structure_version_id ?? null;
  const hasState = navigator.state !== null;
  useEffect(() => {
    if (!hasState) return;
    if (!structureId || !versionId) { queueMicrotask(() => setStructure({ status: "none" })); return; }
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => { if (active) setStructure((current) => (current.status === "ready" && current.value.detail.version.id === versionId ? current : { status: "loading" })); });
    void loadActiveStructure({ projectId, structureId, versionId, signal: controller.signal })
      .then((value) => { if (active) setStructure({ status: "ready", value }); })
      .catch(() => { if (active) setStructure({ status: "error" }); });
    return () => { active = false; controller.abort(); };
  }, [projectId, structureId, versionId, hasState]);

  const counts = useMemo(() => overviewCounts(catalog), [catalog]);

  // The available Navigator action with this id as a real destination (the same links the Navigator itself renders).
  const actionHref = useCallback((actionId: string): string | null => {
    const state = navigator.state;
    const action = state?.next.find((item) => item.action_id === actionId);
    return state && action ? navigatorHref(locale, projectId, action, state.goal, state.facts_summary.structure_version_id) : null;
  }, [navigator.state, locale, projectId]);

  const plan = useMemo(() => {
    const state = navigator.state;
    return state ? planContinue(state.next, (action) => navigatorHref(locale, projectId, action, state.goal, state.facts_summary.structure_version_id)) : null;
  }, [navigator.state, locale, projectId]);

  const cells: StatusCell[] = useMemo(() => {
    const notReady = slow ? "Unavailable" : "Reading records…";
    const records = (value: string, sub: string, id: string, label: string): StatusCell => catalogReady ? { id, label, value, sub } : { id, label, value: "—", sub: notReady };
    const calcNotes = [
      facts?.running_jobs ? `${facts.running_jobs} running` : null,
      facts?.failed_jobs ? `${facts.failed_jobs} failed` : null,
      counts.calculations.imported ? `${counts.calculations.imported} imported` : null,
    ].filter((note): note is string => note !== null);
    const evidence = counts.evidence;
    const evidenceNotes = [
      evidence.documents ? plural(evidence.documents, "document") : null,
      evidence.datasets ? plural(evidence.datasets, "dataset") : null,
      evidence.spectra ? plural(evidence.spectra, "spectrum", "spectra") : null,
    ].filter((note): note is string => note !== null);
    return [
      records(String(counts.structures.committed),
        counts.structures.committed === 0 && counts.structures.candidates === 0 ? "None committed"
          : `committed${counts.structures.candidates ? ` · ${plural(counts.structures.candidates, "unreviewed candidate")}` : ""}`,
        "structures", "Structures"),
      { ...records(String(counts.calculations.submitted),
        calcNotes.length ? calcNotes.join(" · ") : counts.calculations.submitted ? "submitted" : "None recorded", "calculations", "Calculations"),
        tone: catalogReady && facts?.failed_jobs ? "attention" : undefined },
      records(String(counts.results.published),
        counts.results.imported ? `${counts.results.imported} imported · not ChemDFT results` : counts.results.published ? "published" : "None published",
        "results", "Results"),
      records(String(evidence.documents + evidence.datasets + evidence.spectra), evidenceNotes.length ? evidenceNotes.join(" · ") : "None supplied", "evidence", "Evidence"),
      plan && navigator.state
        ? { id: "goal", label: "Workflows", value: `${plan.total} available`, sub: plan.recommendedId ? "including the recommended action" : "none recommended", tone: plan.total === 0 ? "attention" : undefined }
        : { id: "goal", label: "Workflows", value: "—", sub: navigator.error ? "Navigator unavailable" : "Reading records…" },
    ];
  }, [catalogReady, slow, counts, facts, plan, navigator.state, navigator.error]);

  const rows = useMemo(() => readinessRows({ state: navigator.state, counts: catalogReady ? counts : null }), [navigator.state, catalogReady, counts]);
  const restrictions = useMemo(() => restrictionSummary(navigator.state?.blocked ?? []), [navigator.state]);
  const structureLabel = structure.status === "ready" ? `${structure.value.detail.structure.name} · V${structure.value.detail.version.revision}` : null;

  return (
    <div className={styles.overview} data-testid="project-overview">
      <OverviewHeader
        project={project}
        projectId={projectId}
        structureLabel={structureLabel}
        structureId={structureId}
        structureVersionId={versionId}
      />

      <dl className={styles.status} aria-label="Project status" aria-busy={!catalogReady || !navigator.state}>
        {cells.map((cell) => (
          <div key={cell.id} className={styles.cell} data-tone={cell.tone} data-status={cell.id} data-goal-blocked={cell.id === "goal" && navigator.state?.goal && navigator.state.blocked.length ? "" : undefined}>
            <dt>{cell.label}</dt>
            <dd>
              <strong>{cell.value}</strong>
              <span>{cell.sub}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className={styles.grid}>
        <div className={styles.areaStage}><StructureStage projectId={projectId} locale={locale} load={structure} facts={facts} state={navigator.state} actionHref={actionHref} recommendedId={plan?.recommendedId ?? null} /></div>
        <OverviewNavigator projectId={projectId} locale={locale} navigator={navigator} plan={plan} />
        <div className={styles.areaResults}><OverviewResults projectId={projectId} locale={locale} /></div>
        <div className={styles.areaStatus}>
          <OverviewStatus rows={rows} restrictions={restrictions} ready={catalogReady} />
        </div>
        <div className={styles.areaActivity}><OverviewActivity projectId={projectId} locale={locale} catalog={catalog} ready={catalogReady} /></div>
      </div>
    </div>
  );
}
