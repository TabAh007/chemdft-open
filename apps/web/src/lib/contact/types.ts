/**
 * Types and validation constants for ChemDFT public contact form.
 */

export const CONTACT_TOPICS = [
  "Work with us",
  "Question or more information",
  "Press or partnership",
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export type ContactStatus = "pending" | "sent" | "failed";

export interface ContactMessageRecord {
  id: string;
  topic: ContactTopic;
  status: ContactStatus;
  ipHash: string;
  locale: string;
  appVersion: string;
  providerMessageId: string | null;
  errorCode: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface ContactSubmissionInput {
  name: string;
  email: string;
  organisation?: string | undefined;
  topic: ContactTopic;
  message: string;
  consent: boolean;
  turnstileToken: string;
  website?: string | undefined; // Honeypot field
  renderedAt: number; // Client timestamp for minimum fill time
  locale?: string | undefined;
  ip: string;
}

export interface ContactSubmissionResult {
  ok: boolean;
  message: string;
}

export const MAX_NAME_LENGTH = 100;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_ORGANISATION_LENGTH = 120;
export const MIN_MESSAGE_LENGTH = 10;
export const MAX_MESSAGE_LENGTH = 4000;
export const MIN_FILL_TIME_MS = 3000; // 3 seconds
export const MAX_URL_COUNT = 3;
export const DEFAULT_CONTACT_DAILY_CAP = 50;
export const RATE_LIMIT_10_MIN = 3;
export const RATE_LIMIT_24_HR = 5;
export const RETENTION_DAYS = 90;
export const PURGE_BATCH_LIMIT = 200;
export const MAX_BODY_BYTES = 16 * 1024; // 16 KB

