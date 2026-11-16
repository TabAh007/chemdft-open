"use client";

import { useEffect, useId, useState } from "react";
import { useLocale } from "next-intl";
import { defaultLocale, isLocale } from "@chemdft/i18n";
import { AppIcon } from "@chemdft/ui";
import type { NavigatorState } from "@chemdft/schemas";
import { getNavigator, isAbortError, type NavigatorGoalId } from "@/lib/navigator-api";
import { navigatorHref } from "@/lib/navigator-navigation";
import { navigatorMessage } from "@/lib/navigator-messages";
import { isGoal } from "@/lib/onboarding-flow";
import { reasonHelp } from "@/lib/help-topics";
import { HelpTip } from "./help/help-tip";
import styles from "./project-navigator.module.css";

export function ProjectNavigator({ projectId, structureVersionId, publicExampleSlug }: { projectId: string; structureVersionId?: string | undefined; publicExampleSlug?: string | undefined }) {
  const currentLocale = useLocale();
  const locale = isLocale(currentLocale) ? currentLocale : defaultLocale;
  const t = (key: string) => navigatorMessage(locale, key);
  const id = useId();
  const [goal, setGoal] = useState<NavigatorGoalId | "">("");
  const [state, setState] = useState<NavigatorState | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("navigator_goal");
    if (isGoal(requested)) queueMicrotask(() => setGoal(requested));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => { if (active) { setBusy(true); setError(false); } });
    const loading = publicExampleSlug
      ? fetch(`/api/chemdft/v1/examples/${encodeURIComponent(publicExampleSlug)}/navigator?${new URLSearchParams(goal ? { goal } : {})}`, { cache: "no-store", signal: controller.signal }).then(response => { if (!response.ok) throw new Error("Example Navigator unavailable"); return response.json() as Promise<NavigatorState>; })
      : getNavigator(projectId, { goal: goal || undefined, structureVersionId, signal: controller.signal });
    void loading.then((data) => {
      if (active) { setState(data); setBusy(false); }
    }).catch((cause: unknown) => {
      if (isAbortError(cause)) return;
      if (active) { setError(true); setBusy(false); }
    });
    return () => { active = false; controller.abort(); };
  }, [projectId, goal, structureVersionId, revision, publicExampleSlug]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("chemdft:workspace-items-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("chemdft:workspace-items-changed", refresh); window.removeEventListener("focus", refresh); };
  }, []);

  useEffect(() => {
    if (!state?.facts_summary.running_jobs) return;
    const timer = window.setInterval(() => setRevision(value => value + 1), 10000);
    return () => window.clearInterval(timer);
  }, [state?.facts_summary.running_jobs]);

  return <section className={styles.navigator} aria-labelledby={`${id}-title`} data-testid="project-navigator">
    <header className={styles.header}>
      <div><h2 id={`${id}-title`}>{t("title")}</h2><p>{t("subtitle")}</p></div>
      <button className="bp6-button bp6-minimal" type="button" onClick={() => setRevision(value => value + 1)} disabled={busy}><AppIcon icon="refresh" /><span>{t("refresh")}</span></button>
    </header>
    <div className={styles.controls}>
      <label htmlFor={`${id}-goal`}>{t("goal")}</label>
      <select id={`${id}-goal`} className="bp6-input" value={goal} onChange={event => setGoal(event.currentTarget.value as NavigatorGoalId | "")}>
        <option value="">{t("allGoals")}</option>
        {state?.goals.map(item => <option key={item.goal_id} value={item.goal_id}>{t(item.title_key)}{item.satisfied ? ` · ${t("completed")}` : ""}</option>)}
      </select>
      {state?.facts_summary.structure_name && <span className={styles.scope}>{t("scope")}: <strong>{state.facts_summary.structure_name}</strong></span>}
    </div>
    {error ? <div className={styles.feedback} role="alert"><p>{t("error")}</p><button type="button" className="bp6-button" onClick={() => setRevision(value => value + 1)}>{t("retry")}</button></div> : busy ? <p className={styles.feedback} role="status">{t("loading")}</p> : state && <>
      {!state.facts_summary.can_write && <p className={styles.access}><AppIcon icon="lock" /> {t(state.facts_summary.sealed ? "sealed" : "viewer")}</p>}
      <section className={styles.have} aria-labelledby={`${id}-have`}><h3 id={`${id}-have`}>{t("have")}</h3>
        {state.have.length ? <ul>{state.have.map(item => <li key={item.state_id}><AppIcon icon={item.state_id === "job.failed" ? "warning-sign" : item.state_id === "candidate.review_required" || item.state_id === "job.in_progress" ? "time" : "tick"} /><span>{t(item.label_key)}{item.detail && <small>{item.detail}</small>}</span></li>)}</ul> : <p>{t("empty")}</p>}
      </section>
      <section className={styles.next} aria-labelledby={`${id}-next`}><h3 id={`${id}-next`}>{t("next")}</h3>
        {state.next.length ? <ol>{state.next.map((action, index) => { const publicLaunch = publicExampleSlug && action.target && ["inspect", "cell", "supercell", "provenance"].includes(action.target.launch) ? action.target.launch : null; const href = publicExampleSlug ? publicLaunch ? publicLaunch === "provenance" ? "#provenance" : "#structure" : null : navigatorHref(locale, projectId, action, state.goal, state.facts_summary.structure_version_id); return <li key={action.action_id} data-action-id={action.action_id}><div><h4>{t(action.title_key)}</h4><p>{t(action.description_key)}</p></div>{href && <a className={`bp6-button ${index === 0 ? "bp6-intent-primary" : ""}`} href={href} onClick={() => { if (publicLaunch) window.dispatchEvent(new CustomEvent("chemdft:example-view", { detail: { slug: publicExampleSlug, launch: publicLaunch } })); }} aria-label={`${t("open")}: ${t(action.title_key)}`}>{t("open")}<AppIcon icon="arrow-right" /></a>}</li>; })}</ol> : <p>{t("noNext")}</p>}
      </section>
      <details className={styles.blocked} open={Boolean(goal && state.blocked.length)}><summary><span>{t("blocked")}</span><span>{state.blocked.length}</span></summary>
        {state.blocked.length ? <ul>{state.blocked.map(action => <li key={action.action_id} data-action-id={action.action_id}><h4>{t(action.title_key)}</h4><ul>{(action.reasons ?? []).map(reason => <li key={reason.code} data-reason-code={reason.code}>{t(reason.message_key)} {reasonHelp(reason.code) && <HelpTip topic={reasonHelp(reason.code)!} />}</li>)}</ul></li>)}</ul> : <p>{t("noBlocked")}</p>}
      </details>
      <footer className={styles.notes}><HelpTip topic="firewall.ai_vs_calculation" />{(state.notices ?? []).map(key => <p key={key}>{t(key)}</p>)}</footer>
    </>}
  </section>;
}
