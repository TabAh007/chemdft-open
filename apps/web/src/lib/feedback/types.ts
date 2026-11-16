/**
 * Types and validation constants for ChemDFT in-app feedback.
 */

export const FEEDBACK_TYPES = ["not_working", "feature_idea", "method_or_engine", "other"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  not_working: "Not working",
  feature_idea: "Feature idea",
  method_or_engine: "Method or engine",
  other: "Other",
};

export type FeedbackStatus = "pending" | "sent" | "failed";

export interface FeedbackReportRecord {
  id: string;
  userId: string;
  type: FeedbackType;
  title: string;
  details: string;
  status: FeedbackStatus;
  replyConsent: boolean;
  pagePath: string;
  locale: string;
  appVersion: string;
  attachmentCount: number;
  attachmentBytes: number;
  providerMessageId: string | null;
  errorCode: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface FeedbackAttachment {
  filename: string;
  content: string; // Base64 encoded binary
  contentType: string;
  sizeBytes: number;
}

export interface CreateFeedbackInput {
  userId: string;
  userEmail: string;
  type: FeedbackType;
  title: string;
  details: string;
  replyConsent: boolean;
  pagePath: string;
  locale: string;
  userAgent?: string | undefined;
  attachments?: FeedbackAttachment[] | undefined;
}

export interface FeedbackSubmissionResult {
  ok: boolean;
  reportId: string;
  attachmentCount: number;
  replyConsent: boolean;
}

/** Total request body ceiling (Vercel limit ~4.5 MB; 4 MB provides headroom) */
export const MAX_TOTAL_ATTACHMENT_BYTES = 4 * 1024 * 1024; // 4 MB
export const MAX_TITLE_LENGTH = 120;
export const MIN_TITLE_LENGTH = 1;
export const DEFAULT_FEEDBACK_DAILY_CAP = 10;
export const DEFAULT_FEEDBACK_MINUTE_LIMIT = 3;

/**
 * Allowed safe attachment extensions:
 * - images: png, jpg, jpeg, gif, webp
 * - documents/text: pdf, txt, log, out, csv, json
 * - chemical files: xyz, cif, pdb, mol, sdf, inp, com, gjf, zip
 */
export const ALLOWED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "pdf",
  "txt",
  "log",
  "out",
  "csv",
  "json",
  "xyz",
  "cif",
  "pdb",
  "mol",
  "sdf",
  "inp",
  "com",
  "gjf",
  "zip",
]);

/**
 * Explicitly disallowed executable extensions and scripts.
 */
export const REJECTED_EXTENSIONS = new Set([
  "exe",
  "bat",
  "cmd",
  "sh",
  "js",
  "msi",
  "app",
  "dmg",
  "jar",
  "vbs",
  "ps1",
  "pif",
  "scr",
  "bin",
]);
