export type Identifier = string;

export type ProjectRole = "owner" | "editor" | "viewer";
export type ProvenanceClass = "raw" | "normalized" | "derived";

export interface ProjectSummary {
  id: Identifier;
  organizationId: Identifier;
  name: string;
  slug: string;
  role: ProjectRole;
  createdAt: string;
  updatedAt: string;
}

export interface FileMetadata {
  id: Identifier;
  projectId: Identifier;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  objectKey: string;
  provenanceClass: ProvenanceClass;
  createdAt: string;
}

export const settingsSections = [
  "general",
  "ai",
  "billing",
  "compute",
  "scientific",
  "privacy",
  "advanced",
] as const;

export type SettingsSection = (typeof settingsSections)[number];

export function isSettingsSection(value: string): value is SettingsSection {
  return settingsSections.includes(value as SettingsSection);
}
