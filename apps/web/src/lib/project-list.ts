import type { ProjectRead } from "./project-api";

/**
 * Pure list logic for the Scientific Projects dashboard (search, sort, role filter, internal-fixture split).
 * The server already returns only projects the caller may see; nothing here widens that set.
 *
 * Dates: `ProjectRead.updated_at` is only bumped when the project row itself changes (it is not touched by structure,
 * calculation or evidence activity), so the dashboard exposes `created_at` and labels it "Created". It never presents a
 * project date as "last modified".
 */

export type ProjectSort = "newest" | "oldest" | "name-asc" | "name-desc";

export const PROJECT_SORTS: readonly { id: ProjectSort; label: string }[] = [
  { id: "newest", label: "Newest created" },
  { id: "oldest", label: "Oldest created" },
  { id: "name-asc", label: "Name A–Z" },
  { id: "name-desc", label: "Name Z–A" },
];

export function isProjectSort(value: unknown): value is ProjectSort {
  return PROJECT_SORTS.some((sort) => sort.id === value);
}

const WATER_PROJECT_ID = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
const CHROMIUM_PROJECT_ID = "7ae7e41b-2483-42c3-823e-42dd1b9fa72f";

/** Preserved from the previous page: test and acceptance fixtures are tucked away, never deleted or hidden from search of "all". */
export function isInternalFixture(project: Pick<ProjectRead, "id" | "name" | "slug">): boolean {
  if (project.id === WATER_PROJECT_ID || project.id === CHROMIUM_PROJECT_ID) return false;
  const text = `${project.name} ${project.slug}`.toLowerCase();
  if (text.includes("user-supplied") || text === "test-user-supplied-water") return false;
  return (
    text.startsWith("p7") ||
    text.startsWith("phase7") ||
    text.includes("debug") ||
    text.includes("acceptance") ||
    text === "1 1"
  );
}

export function splitFixtures<T extends Pick<ProjectRead, "id" | "name" | "slug">>(projects: readonly T[]): { primary: T[]; internal: T[] } {
  const primary: T[] = [];
  const internal: T[] = [];
  for (const project of projects) (isInternalFixture(project) ? internal : primary).push(project);
  return { primary, internal };
}

export function matchesQuery(project: Pick<ProjectRead, "name" | "slug">, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return project.name.toLowerCase().includes(needle) || project.slug.toLowerCase().includes(needle);
}

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Stable: ties fall back to name, then id, so the order never shuffles between renders. */
export function sortProjects<T extends Pick<ProjectRead, "id" | "name" | "created_at">>(projects: readonly T[], sort: ProjectSort): T[] {
  const byName = (a: T, b: T) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id);
  const copy = [...projects];
  switch (sort) {
    case "newest":
      return copy.sort((a, b) => time(b.created_at) - time(a.created_at) || byName(a, b));
    case "oldest":
      return copy.sort((a, b) => time(a.created_at) - time(b.created_at) || byName(a, b));
    case "name-asc":
      return copy.sort(byName);
    case "name-desc":
      return copy.sort((a, b) => byName(b, a));
  }
}

export function distinctRoles(projects: readonly Pick<ProjectRead, "role">[]): string[] {
  return [...new Set(projects.map((project) => project.role))].sort();
}

export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function formatCreated(isoString: string | null | undefined, locale?: string): string | null {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

/** Card accent for the folder tile only; scientific colours (atoms) never use it. Deterministic per project. */
export type FolderTone = "blue" | "teal" | "indigo" | "orange";
const TONES: readonly FolderTone[] = ["blue", "teal", "indigo", "orange"];
export function folderTone(projectId: string): FolderTone {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length]!;
}
