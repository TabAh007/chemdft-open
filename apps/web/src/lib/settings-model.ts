import type { SettingsSection } from "@chemdft/domain";

export type SettingsScope = "global" | "project";

export interface RailEntry {
  section: SettingsSection;
  label: string;
  /** Shown in the rail but greyed: the page explains why nothing can be changed. */
  unavailable: boolean;
}

export const SECTION_LABEL: Record<SettingsSection, string> = {
  general: "General", ai: "AI", billing: "Billing", compute: "Compute", scientific: "Scientific", privacy: "Privacy", advanced: "Advanced",
};

/**
 * Sections that appear in the rail. Compute, Scientific, Privacy and Advanced have no server data behind them yet, so they are not
 * listed; their URLs still resolve and say "Not available yet". Billing is global only and greyed during the beta.
 */
export function railSections(scope: SettingsScope): RailEntry[] {
  const entries: RailEntry[] = [
    { section: "general", label: SECTION_LABEL.general, unavailable: false },
    { section: "ai", label: SECTION_LABEL.ai, unavailable: false },
  ];
  if (scope === "global") entries.push({ section: "billing", label: SECTION_LABEL.billing, unavailable: true });
  return entries;
}

/** Up to two initials from a display name ("Ada Lovelace" -> "AL"); null when the name has no letters. */
export function initialsOf(name: string | null | undefined): string | null {
  const words = (name ?? "").trim().split(/\s+/).filter((word) => /\p{L}/u.test(word));
  if (words.length === 0) return null;
  const first = Array.from(words[0] ?? "").find((char) => /\p{L}/u.test(char));
  const last = words.length > 1 ? Array.from(words[words.length - 1] ?? "").find((char) => /\p{L}/u.test(char)) : undefined;
  return `${first ?? ""}${last ?? ""}`.toUpperCase() || null;
}

const sentence = (code: string) => { const text = code.replaceAll("_", " ").toLowerCase(); return text.charAt(0).toUpperCase() + text.slice(1); };

/** Friendly label for a workspace or project role; the raw code stays available to callers for a tooltip. */
export const roleLabel = (code: string | null | undefined) => (code ? sentence(code) : "—");

export function authModeLabel(mode: string | null | undefined): string {
  if (mode === "jwt") return "Signed in with your ChemDFT account";
  if (mode === "dev") return "Local development identity";
  return mode ? sentence(mode) : "—";
}

/** Same rule as the server: spaces collapsed, 1-160 characters. Returns plain text, or null when the name is fine. */
export function cleanProjectName(raw: string): string {
  return raw.split(/\s+/).filter(Boolean).join(" ");
}
export function projectNameProblem(raw: string): string | null {
  const name = cleanProjectName(raw);
  if (!name) return "Enter a name for the project.";
  if (name.length > 160) return "Use 160 characters or fewer.";
  return null;
}
/** Only owners and editors may rename; the server enforces this too. */
export const canRenameProject = (role: string | null | undefined) => role === "owner" || role === "editor";
export function renameErrorText(status: number | null): string {
  if (status === 403) return "You can view this project but not rename it.";
  if (status === 404) return "This project could not be found. It may have been removed.";
  if (status === 422) return "That name could not be used. Check it and try again.";
  return "The name could not be saved. Check your connection and try again.";
}
