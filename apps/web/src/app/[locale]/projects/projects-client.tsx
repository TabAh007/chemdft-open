"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionButton, AppDialog, AppDialogBody, AppDialogFooter, AppIcon, StatusTag } from "@chemdft/ui";

import { FormulaText, StructureThumb, useProjectPreview } from "@/app/_components/projects/structure-thumbnail";
import styles from "@/app/_components/projects/projects.module.css";
import { shouldShowWelcome } from "@/lib/onboarding-flow";
import { createProject, listProjects, type ProjectRead } from "@/lib/project-api";
import {
  PROJECT_SORTS,
  SLUG_PATTERN,
  deriveSlug,
  distinctRoles,
  folderTone,
  formatCreated,
  isProjectSort,
  matchesQuery,
  sortProjects,
  splitFixtures,
  type ProjectSort,
} from "@/lib/project-list";
import { clearProjectPreviewCaches, resetProjectPreviews, type PreviewResult } from "@/lib/project-structure-preview";

type Props = {
  locale: string;
  devIdentityEnabled: boolean;
  authMode?: "dev" | "jwt";
};

type View = "grid" | "list";
const VIEW_KEY = "chemdft:projects:view";

/** The grid/list choice is a per-browser convenience (no account preference, no migration); it works without storage. */
let sessionView: View | null = null;
const viewListeners = new Set<() => void>();
function readView(): View {
  if (sessionView) return sessionView;
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}
function subscribeView(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => {
    viewListeners.delete(listener);
  };
}
function storeView(next: View): void {
  sessionView = next;
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch {
    /* The view preference is optional. */
  }
  viewListeners.forEach((listener) => listener());
}

function StructureLine({ result }: { result: PreviewResult | undefined }) {
  switch (result?.status) {
    case "ready":
    case "large": {
      const name = result.status === "ready" ? result.model.structureName : result.structureName;
      const formula = result.status === "ready" ? result.model.formula : result.formula;
      const structureCount = result.status === "ready" ? result.model.structureCount : result.structureCount;
      return (
        <span className={styles.structureLine}>
          <span className={styles.structureName}>{name}</span>
          <span className={styles.formula}>
            <FormulaText formula={formula} />
          </span>
          {structureCount && structureCount > 1 ? <span className={styles.muted}> · latest of {structureCount} structures</span> : null}
        </span>
      );
    }
    case "none":
      return <span className={styles.muted}>No saved structure</span>;
    case "unavailable":
      return <span className={styles.muted}>Structure preview unavailable</span>;
    default:
      return <span className={styles.skeletonLine} aria-hidden="true" />;
  }
}

function ProjectCard({ project, locale, fixture }: { project: ProjectRead; locale: string; fixture?: boolean | undefined }) {
  const { ref, result } = useProjectPreview(project.id);
  const titleId = useId();
  const detailId = useId();
  const created = formatCreated(project.created_at);
  return (
    <li>
      <Link
        ref={ref}
        className={styles.card}
        href={`/${locale}/projects/${project.id}/workspace`}
        aria-labelledby={titleId}
        aria-describedby={detailId}
        data-fixture={fixture ? "true" : undefined}
      >
        <span className={styles.body}>
          <span className={styles.meta}>
            <span className={styles.folder} data-tone={folderTone(project.id)} aria-hidden="true">
              <AppIcon icon={fixture ? "document" : "folder-open"} />
            </span>
            <span className={styles.role}>{fixture ? "Fixture" : project.role}</span>
            {created ? <time dateTime={project.created_at}>Created {created}</time> : null}
          </span>
          <strong id={titleId} className={styles.name} title={project.name}>
            {project.name}
          </strong>
          <code className={styles.slug} title={`Project ID ${project.id}`}>
            {project.slug}
          </code>
          <span id={detailId} className={styles.structure}>
            <span className={styles.visuallyHidden}>
              {fixture ? "Internal fixture. " : ""}Role {project.role}.{" "}
            </span>
            <StructureLine result={result} />
          </span>
        </span>
        <StructureThumb result={result} />
        <span className={styles.open}>
          <span>Open Workspace</span>
          <AppIcon icon="arrow-right" />
        </span>
      </Link>
    </li>
  );
}

function ProjectRow({ project, locale, fixture }: { project: ProjectRead; locale: string; fixture?: boolean | undefined }) {
  const { ref, result } = useProjectPreview(project.id);
  const created = formatCreated(project.created_at);
  const href = `/${locale}/projects/${project.id}/workspace`;
  return (
    <tr ref={ref}>
      <th scope="row" className={styles.projectCell}>
        <StructureThumb result={result} size="row" />
        <span className={styles.rowName}>
          <Link href={href} title={project.name}>
            {project.name}
          </Link>
          <code className={styles.slug} title={`Project ID ${project.id}`}>
            {project.slug}
          </code>
        </span>
      </th>
      <td data-label="Latest saved structure" className={styles.structureCell}>
        <StructureLine result={result} />
      </td>
      <td data-label="Created">{created ? <time dateTime={project.created_at}>{created}</time> : <span className={styles.muted}>—</span>}</td>
      <td data-label="Role">
        <span className={styles.role}>{fixture ? "Fixture" : project.role}</span>
      </td>
      <td className={styles.actionCell}>
        <Link className={styles.rowOpen} href={href}>
          Open Workspace<span className={styles.visuallyHidden}>: {project.name}</span>
          <AppIcon icon="arrow-right" />
        </Link>
      </td>
    </tr>
  );
}

function ProjectCollection({ projects, locale, view, fixture }: { projects: ProjectRead[]; locale: string; view: View; fixture?: boolean | undefined }) {
  if (view === "list") {
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>{fixture ? "Internal test fixtures" : "Projects"}</caption>
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Latest saved structure</th>
              <th scope="col">Created</th>
              <th scope="col">Role</th>
              <th scope="col">
                <span className={styles.visuallyHidden}>Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <ProjectRow key={project.id} project={project} locale={locale} fixture={fixture} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <ul className={styles.grid} aria-label={fixture ? "Internal test fixtures" : "Available projects"}>
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} locale={locale} fixture={fixture} />
      ))}
    </ul>
  );
}

function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: ProjectRead) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const slugRef = useRef<HTMLInputElement | null>(null);
  const errorField = useRef<"name" | "slug">("name");

  // Disabling the form while a request runs drops keyboard focus to the page; bring it back to the field at fault so
  // Escape, Tab and Enter keep working inside the dialog.
  useEffect(() => {
    if (submitting || !error) return;
    (errorField.current === "slug" ? slugRef : nameRef).current?.focus();
  }, [submitting, error]);

  const slugInvalid = slug.length > 0 && !SLUG_PATTERN.test(slug);
  const ready = name.trim().length > 0 && slug.length > 0 && !slugInvalid;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    const cleanName = name.trim();
    const cleanSlug = slug.trim();
    setError(null);
    if (!cleanName || !cleanSlug) {
      setError("Project name and slug are required.");
      return;
    }
    if (!SLUG_PATTERN.test(cleanSlug)) {
      setError("The slug may contain lowercase letters, numbers and single hyphens only.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      onCreated(await createProject({ name: cleanName, slug: cleanSlug }));
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Could not create project.";
      errorField.current = /slug/i.test(message) ? "slug" : "name";
      setError(message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AppDialog
      isOpen={open}
      onClose={onClose}
      onOpened={() => nameRef.current?.focus()}
      title="Create New Project"
      icon="folder-new"
      className={`${styles.dialog}`}
      canEscapeKeyClose={!submitting}
      canOutsideClickClose={!submitting}
      isCloseButtonShown={!submitting}
    >
      <form
        className={styles.dialogForm}
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
      >
        <AppDialogBody>
          <p className={styles.dialogLead}>Creates an empty normal project in your current organization. No calculation runs automatically.</p>
          <label htmlFor="new-project-name">Project name</label>
          <input
            ref={nameRef}
            className="bp6-input"
            id="new-project-name"
            name="name"
            autoComplete="off"
            placeholder="e.g. Water cluster solvation"
            value={name}
            maxLength={160}
            disabled={submitting}
            onChange={(event) => {
              setName(event.target.value);
              if (!slugEdited) setSlug(deriveSlug(event.target.value));
            }}
          />
          <label htmlFor="new-project-slug">Project slug</label>
          <input
            ref={slugRef}
            className="bp6-input"
            id="new-project-slug"
            name="slug"
            autoComplete="off"
            placeholder="water-cluster-solvation"
            value={slug}
            maxLength={96}
            disabled={submitting}
            aria-invalid={slugInvalid || undefined}
            aria-describedby="new-project-slug-hint"
            onChange={(event) => {
              setSlug(event.target.value);
              setSlugEdited(event.target.value.length > 0);
            }}
          />
          <p id="new-project-slug-hint" className={styles.hint} data-invalid={slugInvalid || undefined}>
            Lowercase letters, numbers and single hyphens only.
          </p>
          {error ? (
            <p role="alert" className={styles.dialogError}>
              <AppIcon icon="warning-sign" /> <span>{error}</span>
            </p>
          ) : null}
        </AppDialogBody>
        <AppDialogFooter
          actions={
            <>
              <ActionButton text="Cancel" onClick={onClose} disabled={submitting} />
              <ActionButton type="submit" intent="primary" icon="add" text="Create Project" loading={submitting} disabled={!ready} />
            </>
          }
        />
      </form>
    </AppDialog>
  );
}

export function ProjectsClient({ locale, devIdentityEnabled, authMode = "dev" }: Props) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("newest");
  const [role, setRole] = useState("all");
  const view = useSyncExternalStore(subscribeView, readView, () => "grid" as View);
  const [showInternal, setShowInternal] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const openDialog = () => {
    setDialogKey((value) => value + 1);
    setDialogOpen(true);
  };

  useEffect(() => clearProjectPreviewCaches, []);

  useEffect(() => {
    let cancelled = false;
    resetProjectPreviews();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const loaded = await listProjects();
        if (!cancelled) {
          setProjects(loaded);
          if (shouldShowWelcome(loaded.length, new URLSearchParams(window.location.search).get("welcome") === "skip")) router.replace(`/${locale}/welcome`);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load projects.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [locale, router, revision]);

  const status = useMemo(() => {
    if (authMode === "jwt") return "Signed in";
    if (!devIdentityEnabled) return "Production auth not connected";
    return "Local development identity";
  }, [devIdentityEnabled, authMode]);

  const roles = useMemo(() => distinctRoles(projects), [projects]);
  const roleFilter = roles.length > 1 && roles.includes(role) ? role : "all";
  const searching = query.trim().length > 0;

  const { shown, fixtures } = useMemo(() => {
    const inRole = projects.filter((project) => roleFilter === "all" || project.role === roleFilter);
    const split = splitFixtures(inRole);
    // With no ordinary projects the fixtures are all there is, exactly as before; a search looks everywhere.
    const pool = split.primary.length === 0 || searching ? inRole : split.primary;
    const visible = pool.filter((project) => matchesQuery(project, query));
    const hidden = pool === inRole ? [] : split.internal.filter((project) => matchesQuery(project, query));
    return { shown: sortProjects(visible, sort), fixtures: sortProjects(hidden, sort) };
  }, [projects, roleFilter, searching, query, sort]);

  const count = shown.length + (showInternal ? fixtures.length : 0);
  const total = projects.length;

  function onCreated(project: ProjectRead) {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    setDialogOpen(false);
    router.push(`/${locale}/projects/${project.id}/workspace`);
  }

  return (
    <>
      <div className={styles.heading}>
        <div>
          <h1>Scientific Projects</h1>
          <p>Manage research workspaces, versioned molecular structures, calculations, and experimental spectra.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className="bp6-button bp6-intent-primary" onClick={openDialog}>
            <AppIcon icon="add" />
            <span>New Project</span>
          </button>
          <Link className="bp6-button" href={`/${locale}/welcome`} data-testid="new-project-toggle-btn">
            <AppIcon icon="compass" />
            <span>Onboarding Guide</span>
          </Link>
        </div>
      </div>

      {projects.length > 0 ? (
        <>
          <div className={styles.toolbar} role="search">
            <label className={styles.search}>
              <span className={styles.visuallyHidden}>Search projects by name or slug</span>
              <AppIcon icon="search" />
              <input
                type="search"
                className="bp6-input"
                placeholder="Search by name or slug…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label className={styles.select}>
              <span className={styles.visuallyHidden}>Sort projects</span>
              <AppIcon icon="sort" />
              <select className="bp6-input" value={sort} onChange={(event) => isProjectSort(event.target.value) && setSort(event.target.value)}>
                {PROJECT_SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {roles.length > 1 ? (
              <label className={styles.select}>
                <span className={styles.visuallyHidden}>Filter by your role</span>
                <AppIcon icon="people" />
                <select className="bp6-input" value={roleFilter} onChange={(event) => setRole(event.target.value)}>
                  <option value="all">Role: All</option>
                  {roles.map((value) => (
                    <option key={value} value={value}>
                      Role: {value}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className={styles.toggle} role="group" aria-label="Project view">
              <button type="button" aria-pressed={view === "grid"} aria-label="Grid view" title="Grid view" onClick={() => storeView("grid")}>
                <AppIcon icon="grid-view" />
              </button>
              <button type="button" aria-pressed={view === "list"} aria-label="List view" title="List view" onClick={() => storeView("list")}>
                <AppIcon icon="list" />
              </button>
            </div>
          </div>
          <div className={styles.strip}>
            <span className={styles.stripStatus}>
              <AppIcon icon="info-sign" /> <StatusTag>{status}</StatusTag>
              <span>{authMode === "jwt" ? "Authenticated project access." : "Local development uses server-resolved identity."}</span>
            </span>
            <span aria-live="polite">
              {count === total ? `${total} project${total === 1 ? "" : "s"} total` : `${count} of ${total} projects${!showInternal && fixtures.length > 0 && count + fixtures.length === total ? ` (${fixtures.length} internal test fixture${fixtures.length === 1 ? " is" : "s are"} hidden; use \"Show internal test fixtures\" below)` : searching || roleFilter !== "all" ? " match your search or filter" : ""}`}
            </span>
          </div>
        </>
      ) : null}

      {error ? (
        <div className={styles.state} role="alert">
          <AppIcon icon="warning-sign" />
          <div>
            <h2>Projects could not be loaded</h2>
            <p>{error}</p>
            <button type="button" className="bp6-button" onClick={() => setRevision((value) => value + 1)}>
              <AppIcon icon="refresh" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      ) : loading ? (
        <div role="status" aria-label="Loading projects">
          <span className={styles.visuallyHidden}>Loading projects</span>
          <p className={styles.muted} aria-hidden="true">Loading your projects… the first load can take a few seconds while the server wakes up.</p>
          <ul className={styles.grid} aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index} className={styles.skeletonCard} />
            ))}
          </ul>
        </div>
      ) : projects.length === 0 ? (
        <section className={styles.state} aria-labelledby="empty-projects-title">
          <AppIcon icon="folder-new" />
          <div>
            <h2 id="empty-projects-title">No projects yet</h2>
            <p>Create your first scientific project, or explore the reference examples to get started. Nothing runs automatically.</p>
            <div className={styles.stateActions}>
              <button type="button" className="bp6-button bp6-intent-primary" onClick={openDialog}>
                <AppIcon icon="add" />
                <span>Create a project</span>
              </button>
              <Link className="bp6-button" href={`/${locale}/examples`}>
                Explore reference examples
              </Link>
              <Link className="bp6-button bp6-minimal" href={`/${locale}/welcome`}>
                Onboarding Guide
              </Link>
            </div>
          </div>
        </section>
      ) : shown.length === 0 && fixtures.length === 0 ? (
        <section className={styles.state} aria-labelledby="no-results-title">
          <AppIcon icon="search" />
          <div>
            <h2 id="no-results-title">No projects match</h2>
            <p>
              {searching ? `Nothing matches “${query.trim()}” by name or slug` : "No project matches the current filters"}
              {roleFilter !== "all" ? ` with the role ${roleFilter}` : ""}.
            </p>
            <button
              type="button"
              className="bp6-button"
              onClick={() => {
                setQuery("");
                setRole("all");
              }}
            >
              Clear search and filters
            </button>
          </div>
        </section>
      ) : (
        <>
          {shown.length > 0 ? <ProjectCollection projects={shown} locale={locale} view={view} /> : null}
          {fixtures.length > 0 ? (
            <div className={styles.fixtures}>
              <button type="button" className={styles.fixtureToggle} aria-expanded={showInternal} onClick={() => setShowInternal((value) => !value)}>
                <AppIcon icon={showInternal ? "chevron-down" : "chevron-right"} />
                <span>
                  {showInternal ? "Hide" : "Show"} internal test fixtures ({fixtures.length})
                </span>
              </button>
              {showInternal ? <ProjectCollection projects={fixtures} locale={locale} view={view} fixture /> : null}
            </div>
          ) : null}
        </>
      )}

      <NewProjectDialog key={dialogKey} open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={onCreated} />
    </>
  );
}
