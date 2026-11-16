"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Locale } from "@chemdft/i18n";
import { AppIcon } from "@chemdft/ui";
import {
  createProject,
  listProjects,
  type ProjectRead,
} from "@/lib/project-api";
import { getNavigator } from "@/lib/navigator-api";
import { navigatorMessage } from "@/lib/navigator-messages";
import {
  intentsFor,
  overviewGoalHref,
  recommendStart,
  STARTING_PATHS,
  startingWorkflowHref,
  type GoalId,
  type HaveId,
  type IntentId,
  type Recommendation,
  type StartingPathId,
  type StartingWorkflowId,
} from "@/lib/onboarding-flow";
import { onboardingMessage } from "@/lib/onboarding-messages";
import { HelpTip } from "../help/help-tip";
import styles from "./welcome.module.css";

const HAVE: readonly HaveId[] = [
  "nothing",
  "molecule",
  "crystal",
  "spectrum",
  "calculationFile",
];
export function WelcomeClient({
  locale,
  initialPath,
  initialGoal,
  illustrations,
  stepIllustrations,
  figure,
}: {
  locale: Locale;
  initialPath: StartingPathId | null;
  initialGoal: GoalId | null;
  illustrations: Record<StartingPathId, ReactNode>;
  stepIllustrations: Record<StartingPathId, ReactNode>;
  figure: ReactNode;
}) {
  const t = (key: Parameters<typeof onboardingMessage>[1]) =>
    onboardingMessage(locale, key);
  const [path, setPath] = useState<StartingPathId | null>(initialPath);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    null,
  );
  const [projects, setProjects] = useState<ProjectRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void listProjects()
      .then((data) => {
        if (active) {
          setProjects(data);
          setFailed(false);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const shown = useRef(path);
  // Choosing a path collapses the cards, so return to the top where the selector and the opened step sit together;
  // no smooth scrolling for users who ask for reduced motion.
  useEffect(() => {
    if (shown.current === path) return;
    shown.current = path;
    if (!path || path === "examples") return;
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [path]);
  function choose(id: StartingPathId) {
    setRecommendation(null);
    setPath(id);
  }
  return (
    <main
      id="main-content"
      className={styles.main}
      data-step={path ? "project" : "path"}
    >
      <div className={styles.hero}>
        <header className={styles.intro}>
          <h1>{t("title")}</h1>
          <p>{t("introduction")}</p>
          <p className={styles.rule}>
            <AppIcon icon="info-sign" />
            <span>{t("projectRule")}</span>
          </p>
        </header>
        <div className={styles.figure}>{figure}</div>
      </div>
      <section className={styles.paths} aria-label="Starting paths">
        {STARTING_PATHS.map((item) => {
          const body = (
            <>
              <span className={styles.art} aria-hidden="true">
                {illustrations[item.id]}
              </span>
              <span className={styles.copy}>
                <strong className={styles.title}>{t(`${item.id}.title`)}</strong>
                <span className={styles.desc}>{t(`${item.id}.description`)}</span>
              </span>
              <span className={styles.foot}>
                <span className={styles.next}>{t(`${item.id}.next`)}</span>
                <span className={styles.go} aria-hidden="true">
                  <AppIcon icon="arrow-right" />
                </span>
              </span>
            </>
          );
          return item.id === "examples" ? (
            <Link
              key={item.id}
              className={styles.path}
              href={`/${locale}/examples`}
              data-welcome-path={item.id}
            >
              {body}
            </Link>
          ) : (
            <button
              key={item.id}
              type="button"
              className={styles.path}
              aria-pressed={path === item.id}
              data-welcome-path={item.id}
              onClick={() => choose(item.id)}
            >
              {body}
            </button>
          );
        })}
      </section>
      <div className={styles.reveal}>
      {path && path !== "examples" && (
        <button
          type="button"
          className={styles.change}
          onClick={() => {
            setRecommendation(null);
            setPath(null);
            window.scrollTo({ top: 0 });
          }}
        >
          <AppIcon icon="arrow-left" />
          {t("back")}
        </button>
      )}
      {path === "unsure" && (
        <NotSure
          locale={locale}
          onChoose={(value) => {
            setRecommendation(value);
            setPath(value.path);
          }}
        />
      )}
      {path && path !== "unsure" && path !== "examples" && (
        <section
          className={styles.destination}
          aria-label={t("projectDestination")}
          key={`${path}-${recommendation?.goal ?? initialGoal ?? ""}`}
        >
          {loading ? (
            <p role="status">{t("loading")}</p>
          ) : failed ? (
            <div role="alert">
              <p>{t("loadError")}</p>
              <button
                className="bp6-button"
                onClick={() => {
                  setLoading(true);
                  setRevision((value) => value + 1);
                }}
              >
                {t("retry")}
              </button>
            </div>
          ) : (
            <ProjectDestination
              locale={locale}
              path={path}
              goal={
                recommendation
                  ? recommendation.goal
                  : path === initialPath
                    ? (initialGoal ?? (path === "compare" ? "compare" : null))
                    : path === "compare"
                      ? "compare"
                      : null
              }
              entry={
                recommendation?.entry ??
                (path === initialPath && initialGoal === "crystal"
                  ? "crystal"
                  : "draw")
              }
              projects={projects}
              art={stepIllustrations[path]}
            />
          )}
        </section>
      )}
      </div>
      <footer className={styles.footer}>
        <Link className={styles.back} href={`/${locale}/projects?welcome=skip`}>
          <AppIcon icon="arrow-left" />
          {t("skip")}
        </Link>
        <Link href={`/${locale}/learn`}>
          <AppIcon icon="book" />
          {t("learn")}
        </Link>
      </footer>
    </main>
  );
}

function NotSure({
  locale,
  onChoose,
}: {
  locale: Locale;
  onChoose: (value: Recommendation) => void;
}) {
  const t = (key: Parameters<typeof onboardingMessage>[1]) =>
    onboardingMessage(locale, key);
  const [have, setHave] = useState<HaveId | null>(null);
  const [intent, setIntent] = useState<IntentId | null>(null);
  const choices = have && intent ? recommendStart(have, intent) : [];
  return (
    <section
      className={styles.helper}
      aria-label={t("unsure.title")}
      data-testid="not-sure"
    >
      {!choices.length ? (
        <fieldset>
          <legend>{t(have ? "questionTwo" : "questionOne")}</legend>
          <div className={styles.answers}>
            {have
              ? intentsFor(have).map((value) => (
                  <button
                    className="bp6-button"
                    data-onboarding-goal={value}
                    key={value}
                    onClick={() => setIntent(value)}
                  >
                    {value === "inspectSpectrum" || value === "importResults"
                      ? t(value)
                      : navigatorMessage(locale, `goal.${value}`)}
                  </button>
                ))
              : HAVE.map((value) => (
                  <button
                    className="bp6-button"
                    key={value}
                    data-onboarding-have={value}
                    onClick={() => setHave(value)}
                  >
                    {t(value)}
                  </button>
                ))}
          </div>
        </fieldset>
      ) : (
        <div data-testid="recommendation">
          <h2>{t("recommendation")}</h2>
          <p>{t("advisory")}</p>
          {choices.length > 1 && <p>{t("ambiguous")}</p>}
          {choices.map((value) => (
            <div className={styles.recommendation} key={value.path}>
              <h3>
                {value.goal
                  ? navigatorMessage(locale, `goal.${value.goal}`)
                  : t(`${value.path}.title`)}
              </h3>
              <p>{t(value.note)}</p>
              <button
                className="bp6-button bp6-intent-primary"
                onClick={() => onChoose(value)}
              >
                {t("recommend")} · {t(`${value.path}.title`)}
              </button>
            </div>
          ))}
        </div>
      )}
      {have && (
        <button
          className="bp6-button bp6-minimal"
          onClick={() => {
            setHave(null);
            setIntent(null);
          }}
        >
          {t("changeAnswers")}
        </button>
      )}
    </section>
  );
}

function ProjectDestination({
  locale,
  path,
  goal,
  entry: initialEntry,
  projects,
  art,
}: {
  locale: Locale;
  path: StartingWorkflowId;
  goal: GoalId | null;
  entry: "draw" | "import" | "crystal";
  projects: ProjectRead[];
  art: ReactNode;
}) {
  const router = useRouter();
  const t = (key: Parameters<typeof onboardingMessage>[1]) =>
    onboardingMessage(locale, key);
  const [destination, setDestination] = useState("new");
  const [name, setName] = useState("");
  const [entry, setEntry] = useState(initialEntry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const submitting = useRef(false);
  // A retry reuses its slug: an uncertain response cannot create a second project.
  const attempt = useRef<{ name: string; slug: string } | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || created) return;
    if (destination === "new" && !name.trim()) {
      setError(t("nameRequired"));
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    let projectId = destination;
    try {
      if (destination === "new") {
        if (!attempt.current || attempt.current.name !== name.trim())
          attempt.current = {
            name: name.trim(),
            slug: `${
              name
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 60) || "project"
            }-${crypto.randomUUID().slice(0, 8)}`,
          };
        let project: ProjectRead;
        try {
          project = await createProject(attempt.current);
        } catch (creationError) {
          // A lost response may still have committed. Recover only from the authorized list.
          const recovered = (await listProjects()).find(
            (item) => item.slug === attempt.current?.slug,
          );
          if (!recovered) throw creationError;
          project = recovered;
        }
        projectId = project.id;
        setCreated(project.id);
      }
      const state = await getNavigator(projectId, { goal: goal ?? undefined });
      const references = STARTING_PATHS.find(item => item.id === path)?.actions ?? [];
      const action = references[path === "molecule" && entry !== "draw" ? 1 : 0] ?? null;
      // For a chosen goal on existing work, PF-4 selects the next step from real records.
      router.push(
        destination !== "new" && goal
          ? overviewGoalHref(locale, projectId, goal)
          : startingWorkflowHref(locale, projectId, action, state),
      );
    } catch {
      setError(
        projectId !== "new" && destination === "new"
          ? t("projectCreated")
          : destination === "new"
            ? t("createError")
            : t("unavailable"),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className={styles.stepForm}
      onSubmit={(event) => {
        void submit(event);
      }}
      data-testid="project-destination"
    >
      <div className={styles.summary}>
        <span className={styles.summaryArt} data-art={path} aria-hidden="true">
          {art}
        </span>
        <h2>{t(`${path}.title`)}</h2>
        {goal && <p className={styles.goal}>{navigatorMessage(locale, `goal.${goal}`)}</p>}
        <p>{t(`${path}.description`)}</p>
        <p className={styles.opens}>
          <span>{t("next")}</span>
          <strong>{t(`${path}.next`)}</strong>
        </p>
        {path === "compare" && <p className={styles.note}>{t("comparisonNote")}</p>}
      </div>
      <div className={styles.controls}>
        {path === "molecule" && (
          <fieldset disabled={busy || Boolean(created)}>
            <legend>{t("entry")}</legend>
            <div className={styles.answers}>
              {(goal === "crystal"
                ? (["crystal"] as const)
                : (["draw", "import", "crystal"] as const)
              ).map((value) => (
                <label className={styles.radio} key={value}>
                  <input
                    type="radio"
                    name="entry"
                    checked={entry === value}
                    onChange={() => setEntry(value)}
                  />
                  {t(
                    value === "draw"
                      ? "draw"
                      : value === "import"
                        ? "importMolecule"
                        : "importCrystal",
                  )}
                </label>
              ))}
            </div>
            {entry === "crystal" && <p>{t("crystalNote")}</p>}
          </fieldset>
        )}
        <label htmlFor="welcome-destination">{t("projectDestination")}</label>
        <select
          id="welcome-destination"
          className="bp6-input"
          value={destination}
          disabled={busy || Boolean(created)}
          onChange={(event) => setDestination(event.target.value)}
        >
          <option value="new">{t("newProject")}</option>
          {projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.name} · {project.role}
            </option>
          ))}
        </select>
        {destination === "new" && (
          <>
            <label htmlFor="welcome-project-name">{t("name")}</label>
            <input
              id="welcome-project-name"
              className="bp6-input"
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy || Boolean(created)}
              placeholder={t("nameHint")}
              required
            />
          </>
        )}
        <p className={styles.note}>
          {t(destination === "new" ? "commitNote" : "existingNote")}{" "}
          <HelpTip topic="provenance.authority" />
        </p>
        {error && <p role="alert">{error}</p>}
        {created ? (
          <Link
            className="bp6-button bp6-intent-primary"
            href={overviewGoalHref(locale, created, goal)}
          >
            {t("openNavigator")}
          </Link>
        ) : (
          <button
            className="bp6-button bp6-intent-primary"
            type="submit"
            disabled={busy}
          >
            {t(busy ? "busy" : destination === "new" ? "commit" : "openExisting")}
          </button>
        )}
      </div>
    </form>
  );
}
