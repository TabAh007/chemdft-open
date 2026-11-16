"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { NavigatorAction } from "@chemdft/schemas";
import type { Locale } from "@chemdft/i18n";
import { AppIcon } from "@chemdft/ui";
import type { IconName } from "@chemdft/ui";
import { reasonHelp } from "@/lib/help-topics";
import { navigatorHref } from "@/lib/navigator-navigation";
import { navigatorMessage } from "@/lib/navigator-messages";
import type { NavigatorGoalId } from "@/lib/navigator-api";
import {
  actionVerb, groupWorkflows, haveTone, reconcileCaption, splitActions,
  type ContinuePlan, type WorkflowGroup,
} from "@/lib/overview-model";
import {
  FIXER_LABEL, fixersOf, plainReason, resolvingActionId, sharedPrerequisite, summarizeUnavailable, summaryLine, SUMMARY_TOOLTIP,
} from "@/lib/navigator-unavailable";
import type { OverviewNavigator as NavigatorModel } from "@/lib/use-overview-navigator";
import { HelpTip } from "../help/help-tip";
import styles from "./overview.module.css";

export const EXPAND_REASONS_EVENT = "chemdft:overview-expand-reasons";

const HAVE_ICON = { confirmed: "tick", attention: "warning-sign", pending: "time" } as const satisfies Record<string, IconName>;
type Translate = (key: string) => string;

function ActionRow({ action, href, t, lead }: { action: NavigatorAction; href: string | null; t: Translate; lead?: boolean }) {
  const verb = actionVerb(action.action_id);
  return (
    <li className={styles.actionRow} data-action-id={action.action_id} data-lead={lead || undefined}>
      <div>
        <h5>{t(action.title_key)}</h5>
        <p title={t(action.description_key)}>{t(action.description_key)}</p>
      </div>
      {href ? (
        <a className="bp6-button" href={href} aria-label={`${verb}: ${t(action.title_key)}`}>
          <span>{verb}</span>
          <AppIcon icon="arrow-right" />
        </a>
      ) : null}
    </li>
  );
}

/**
 * The Project Navigator in two layers. By default: the one recommended action (beside the structure) and a short
 * "Continue your research" list. "Browse all workflows" holds the complete server catalogue (goal selector, every
 * workflow grouped, every unavailable reason, recorded facts, notices). All state, eligibility and reasons come from
 * the same server Navigator in both layers; the wrapper is layout-transparent and carries the shared test hook.
 */
export function OverviewNavigator({ projectId, locale, navigator, plan }: { projectId: string; locale: Locale; navigator: NavigatorModel; plan: ContinuePlan | null }) {
  const id = useId();
  const t: Translate = (key) => navigatorMessage(locale, key);
  const { goal, setGoal, state, busy, error, refresh } = navigator;
  const [browseChoice, setBrowseChoice] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"next" | "unavailable" | "recorded" | null>(null);
  useEffect(() => { queueMicrotask(() => setTab(null)); }, [goal]);
  // A selected goal (also from a deep link such as ?navigator_goal=…) opens the catalogue it filters.
  const browseOpen = browseChoice ?? Boolean(goal);

  const actions = useMemo(
    () => (state ? splitActions(state.next, (action) => navigatorHref(locale, projectId, action, state.goal, state.facts_summary.structure_version_id)) : null),
    [state, locale, projectId],
  );
  const groups = useMemo(
    () => (state && actions ? groupWorkflows([...actions.others, ...actions.unlinked.map((action) => ({ action, href: null }))], state.blocked, actions.recommended?.action.action_id ?? null) : []),
    [state, actions],
  );
  // Not available yet is collapsed behind its tab unless a goal is chosen that has nothing to do right now.
  const activeTab = tab ?? (goal && state && state.next.length === 0 && state.blocked.length ? "unavailable" : "next");
  const hrefForAvailable = (actionId: string): string | null => {
    const found = state?.next.find((action) => action.action_id === actionId);
    return found && state ? navigatorHref(locale, projectId, found, state.goal, state.facts_summary.structure_version_id) : null;
  };

  // The Scientific status panel can ask for every reason to be shown.
  useEffect(() => {
    const expand = () => {
      setBrowseChoice(true);
      setTab("unavailable");
    };
    window.addEventListener(EXPAND_REASONS_EVENT, expand);
    return () => window.removeEventListener(EXPAND_REASONS_EVENT, expand);
  });

  return (
    <div className={styles.navShell} data-testid="project-navigator" aria-busy={busy}>
      {state && actions && !error ? (
        <section className={styles.recCard} aria-labelledby={`${id}-next`}>
          <h2 className={styles.kicker} id={`${id}-next`}>Recommended next action</h2>
          {actions.recommended ? (
            <div className={styles.recommended} data-action-id={actions.recommended.action.action_id}>
              <div>
                <h3>{t(actions.recommended.action.title_key)}</h3>
                <p>{t(actions.recommended.action.description_key)}</p>
              </div>
              <a className="bp6-button bp6-intent-primary" href={actions.recommended.href} aria-label={`${actionVerb(actions.recommended.action.action_id)}: ${t(actions.recommended.action.title_key)}`}>
                <span>{actionVerb(actions.recommended.action.action_id)}</span>
                <AppIcon icon="arrow-right" />
              </a>
            </div>
          ) : (
            <p className={styles.muted}>{t("noNext")}</p>
          )}
        </section>
      ) : null}

      <section className={styles.flows} aria-labelledby={`${id}-continue`} id="overview-workflows">
        <header className={styles.navHead}>
          <div>
            <h2 id={`${id}-continue`}>Continue your research</h2>
            <p>{plan ? reconcileCaption(plan) : "Reading what the project allows…"}</p>
          </div>
          <button className="bp6-button bp6-minimal" type="button" onClick={refresh} disabled={busy}>
            <AppIcon icon="refresh" />
            <span>{t("refresh")}</span>
          </button>
        </header>

        {error ? (
          <div className={styles.feedback} role="alert">
            <p>{t("error")}</p>
            <button type="button" className="bp6-button" onClick={refresh}>{t("retry")}</button>
          </div>
        ) : !state || !actions || !plan ? (
          <p className={styles.feedback} role="status">{t("loading")}</p>
        ) : (
          <div className={styles.navBody} data-busy={busy || undefined}>
            {!state.facts_summary.can_write ? <p className={styles.access}><AppIcon icon="lock" /> {t(state.facts_summary.sealed ? "sealed" : "viewer")}</p> : null}
            {plan.listed.length ? (
              <ul className={styles.continueList}>
                {plan.listed.map((entry) => <ActionRow key={entry.action.action_id} action={entry.action} href={entry.href} t={t} />)}
              </ul>
            ) : null}

            <details className={styles.browse} data-testid="browse-workflows" open={browseOpen} onToggle={(event) => setBrowseChoice(event.currentTarget.open)}>
              <summary>
                <AppIcon icon="chevron-right" />
                <span className={styles.blockedTitle}>Browse all workflows</span>
                <span className={styles.breakdown}>Goal, next steps, what is not available yet, recorded facts</span>
              </summary>
              <div className={styles.browseBody}>
                <div className={styles.browseTop}>
                  <h3>{t("title")}</h3>
                  <div className={styles.goalField}>
                    <label htmlFor={`${id}-goal`}>{t("goal")}</label>
                    <div className={styles.goalWrap}>
                      <select id={`${id}-goal`} className={styles.goalSelect} aria-describedby={`${id}-goal-hint`} value={goal}
                        onChange={(event) => setGoal(event.currentTarget.value as NavigatorGoalId | "")}>
                        <option value="">{t("allGoals")}</option>
                        {state.goals.map((item) => <option key={item.goal_id} value={item.goal_id}>{t(item.title_key)}{item.satisfied ? ` · ${t("completed")}` : ""}</option>)}
                      </select>
                      <span className={styles.goalChevron} aria-hidden="true"><AppIcon icon="chevron-down" /></span>
                    </div>
                  </div>
                  <p className={styles.counts} role="status">
                    {state.facts_summary.structure_name ? <span>{t("scope")}: <strong>{state.facts_summary.structure_name}</strong> · </span> : null}
                    {state.next.length} available · {state.blocked.length} not available
                  </p>
                  <button className="bp6-button bp6-minimal" type="button" onClick={refresh} disabled={busy}>
                    <AppIcon icon="refresh" />
                    <span>{t("refresh")}</span>
                  </button>
                </div>
                <p className={styles.goalHint} id={`${id}-goal-hint`}>Pick what you want to do; the list shows what is possible now.</p>

                <div className={styles.tabs} role="tablist" aria-label="Navigator views">
                  {([
                    ["next", `Next steps (${state.next.length})`],
                    ["unavailable", `Not available yet (${state.blocked.length})`],
                    ["recorded", `Recorded in this project (${state.have.length})`],
                  ] as const).map(([key, label]) => (
                    <button key={key} type="button" role="tab" id={`${id}-tab-${key}`} aria-selected={activeTab === key} aria-controls={`${id}-panel-${key}`}
                      tabIndex={activeTab === key ? 0 : -1} className={styles.tab} data-active={activeTab === key || undefined} data-testid={`navigator-tab-${key}`}
                      onClick={() => setTab(key)}
                      onKeyDown={(event) => {
                        const order = ["next", "unavailable", "recorded"] as const;
                        const index = order.indexOf(key);
                        const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                        if (!move) return;
                        event.preventDefault();
                        const target = order[(index + move + order.length) % order.length]!;
                        setTab(target);
                        (document.getElementById(`${id}-tab-${target}`) as HTMLButtonElement | null)?.focus();
                      }}>
                      {label}
                    </button>
                  ))}
                </div>

                <div className={styles.tabPanel} role="tabpanel" id={`${id}-panel-${activeTab}`} aria-labelledby={`${id}-tab-${activeTab}`} tabIndex={0}>
                  {activeTab === "next" ? (
                    state.next.length ? (
                      <ul className={styles.compactList}>
                        {[...actions.recommended ? [actions.recommended] : [], ...actions.others].map((entry) => <CompactRow key={entry.action.action_id} action={entry.action} href={entry.href} t={t} />)}
                        {actions.unlinked.map((action) => <CompactRow key={action.action_id} action={action} href={null} t={t} />)}
                      </ul>
                    ) : <p className={`${styles.muted} ${styles.pad}`}>{t("noNext")}</p>
                  ) : activeTab === "unavailable" ? (
                    <UnavailablePanel groups={groups} blocked={state.blocked} t={t} hrefForAvailable={hrefForAvailable} />
                  ) : state.have.length ? (
                    <ul className={styles.have}>
                      {state.have.map((item) => {
                        const tone = haveTone(item.state_id);
                        return (
                          <li key={item.state_id} data-tone={tone}>
                            <AppIcon icon={HAVE_ICON[tone]} />
                            <span>{t(item.label_key)}{item.detail ? <small>{item.detail}</small> : null}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className={`${styles.muted} ${styles.pad}`}>{t("empty")}</p>
                  )}
                </div>

                <footer className={styles.notes}>
                  <HelpTip topic="firewall.ai_vs_calculation" />
                  <div>
                    {(state.notices ?? []).map((key) => <p key={key}>{t(key)}</p>)}
                    <p>A listed goal is not proof that the compute worker can run it.</p>
                  </div>
                </footer>
              </div>
            </details>
          </div>
        )}
      </section>
    </div>
  );
}

function CompactRow({ action, href, t }: { action: NavigatorAction; href: string | null; t: Translate }) {
  const verb = actionVerb(action.action_id);
  return (
    <li className={styles.compactRow} data-action-id={action.action_id}>
      <div className={styles.compactText}>
        <h5>{t(action.title_key)}</h5>
        <p title={t(action.description_key)}>{t(action.description_key)}</p>
      </div>
      {href ? (
        <a className="bp6-button bp6-small" href={href} aria-label={`${verb}: ${t(action.title_key)}`}>
          <span>{verb}</span>
          <AppIcon icon="arrow-right" />
        </a>
      ) : null}
    </li>
  );
}

function UnavailablePanel({ groups, blocked, t, hrefForAvailable }: {
  groups: WorkflowGroup[]; blocked: readonly NavigatorAction[]; t: Translate; hrefForAvailable: (actionId: string) => string | null;
}) {
  const summary = summarizeUnavailable(blocked);
  const shared = sharedPrerequisite(blocked);
  const availableIds = new Set(["structure.import", "structure.draw", "structure.edit", "spectra.upload_experimental", "calculation.optimize", "calculation.orbitals", "thermochemistry.calculate", "evidence.import_document", "jobs.review"].filter((idValue) => hrefForAvailable(idValue)));
  const bannerHref = hrefForAvailable("structure.import") ?? hrefForAvailable("structure.draw");
  const bannerVerb = hrefForAvailable("structure.import") ? "Import a structure" : "Draw molecule";
  if (!blocked.length) return <p className={`${styles.muted} ${styles.pad}`}>{t("noBlocked")}</p>;
  return (
    <div className={styles.unavailable}>
      <p className={styles.unavailableIntro}>These steps are known to ChemDFT but can&apos;t be done yet. Each one says what is missing.</p>
      <p className={styles.unavailableSummary} title={SUMMARY_TOOLTIP} data-testid="unavailable-summary">{summaryLine(summary)}</p>
      {shared ? (
        <div className={styles.sharedBanner} role="note" data-testid="unavailable-shared-banner">
          <span><AppIcon icon="info-sign" /> Most of these need a structure first.</span>
          {bannerHref ? <a className="bp6-button bp6-small bp6-intent-primary" href={bannerHref}>{bannerVerb}</a> : null}
        </div>
      ) : null}
      {groups.filter((group) => group.blocked.length).map((group) => (
        <section key={group.id} className={styles.unavailableGroup} data-testid={`workflow-group-${group.id}`} aria-label={group.label}>
          <h4>{group.label} <span>{group.blocked.length}</span></h4>
          <ul className={styles.blockedList2}>
            {group.blocked.map((action) => {
              const reasons = action.reasons ?? [];
              const shown = reasons.filter((reason) => !(shared && reason.code === "structure_missing"));
              const fixers = fixersOf(action);
              const resolving = resolvingActionId(action, availableIds);
              const resolveHref = resolving && !(shared && (resolving === "structure.import" || resolving === "structure.draw")) ? hrefForAvailable(resolving) : null;
              return (
                <li key={action.action_id} data-action-id={action.action_id} className={styles.unavailableRow}>
                  <div className={styles.blockedHead}>
                    <h5>{t(action.title_key)}</h5>
                    <span className={styles.kinds}>
                      {fixers.map((fixer) => <span key={fixer} className={styles.fixer} data-fixer={fixer}>{FIXER_LABEL[fixer]}</span>)}
                    </span>
                  </div>
                  {shown.length ? (
                    <ul className={styles.reasonLines}>
                      {shown.map((reason) => (
                        <li key={reason.code} data-reason-code={reason.code}>{plainReason(reason.code)} {reasonHelp(reason.code) ? <HelpTip topic={reasonHelp(reason.code)!} /> : null}</li>
                      ))}
                    </ul>
                  ) : <p className={styles.reasonLines}>Needs a structure first (see above).</p>}
                  {resolveHref && resolving ? <a className="bp6-button bp6-small" href={resolveHref}>{actionVerb(resolving)}</a> : null}
                  {reasons.length ? (
                    <details className={styles.technical}>
                      <summary>Technical details</summary>
                      <ul>
                        {reasons.map((reason) => <li key={reason.code}><code>{reason.code}</code> {t(reason.message_key)}</li>)}
                      </ul>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
