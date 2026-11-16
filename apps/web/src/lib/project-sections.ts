import type { IconName } from "@chemdft/ui";

/**
 * RW-3.2 information architecture: one ordered set of project sections, shared by both workspace
 * modes, following the research flow project → molecule → calculation → result → analysis → export.
 */
export type ProjectSection = {
  segment: string;
  label: string;
  icon: IconName;
  /** What a researcher finds there; shown as the link title. */
  purpose: string;
  group: "workflow" | "literature" | "project";
};

export const PROJECT_SECTIONS: readonly ProjectSection[] = [
  { segment: "overview", label: "Overview", icon: "home", group: "workflow", purpose: "What this project has and the recommended next step" },
  { segment: "workspace", label: "Workspace", icon: "cube", group: "workflow", purpose: "Molecules, structure versions, calculation setup and scientific viewers" },
  { segment: "results", label: "Results", icon: "th", group: "workflow", purpose: "Every calculation with its standing, reports and evidence exports" },
  { segment: "compare", label: "Compare", icon: "comparison", group: "workflow", purpose: "Rule-checked comparison of published results; saved comparisons" },
  { segment: "jobs", label: "Jobs", icon: "time", group: "workflow", purpose: "Compute jobs, queue and execution diagnostics" },
  { segment: "claims", label: "Claims", icon: "document", group: "literature", purpose: "Scientific claims extracted from imported papers" },
  { segment: "comparison", label: "Paper vs ChemDFT", icon: "book", group: "literature", purpose: "Reported literature values next to ChemDFT results" },
  { segment: "settings/general", label: "Settings", icon: "cog", group: "project", purpose: "Project settings" },
];

/** The section a project URL belongs to; exact segment match so "compare" never matches "comparison". */
export function activeProjectSection(pathname: string | null | undefined, projectId: string): string | null {
  if (!pathname) return null;
  const parts = pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part, position) => part === "projects" && decodeURIComponent(parts[position + 1] ?? "") === projectId);
  if (index < 0) return null;
  const segment = parts[index + 2];
  if (!segment) return null;
  return PROJECT_SECTIONS.find((section) => section.segment.split("/")[0] === segment)?.segment ?? null;
}

export type ResearchFocus = { focus: string; href: string | null };

type SelectionDetail = { projectId?: unknown; currentView?: unknown };

/**
 * The researcher's current focus (molecule, version, result, view) from the workspace's own selection
 * broadcast. Project-level views are not a focus. Presentation only; nothing scientific is derived.
 */
export function researchFocusFromSelection(detail: SelectionDetail | null | undefined, projectId: string): string | null {
  if (!detail || detail.projectId !== projectId || typeof detail.currentView !== "string") return null;
  const focus = detail.currentView.replace(/\s+/g, " ").trim();
  if (!focus || /(^|→\s*)Overview$/.test(focus) || focus === "Project overview") return null;
  return focus.length > 140 ? `${focus.slice(0, 139)}…` : focus;
}
