/**
 * Database client and repository functions for the feedback_report table
 * in the authentication database (chemdft_auth).
 *
 * Safe and isolated:
 * - Lazy-safe: if the table does not exist, throws FeedbackTableMissingError
 *   which maps to clean HTTP 503 without affecting /api/auth/*
 * - Does NOT register with Better Auth models or schema
 * - Supports both PostgreSQL (pg.Pool when hosted) and SQLite (node:sqlite locally/tests)
 * - Stores ZERO attachment content or bytes in the database
 */

import { readAuthConfig, type AuthConfig } from "../auth/config.ts";
import { openDatabase } from "../auth/server.ts";
import type { FeedbackReportRecord, FeedbackStatus } from "./types.ts";

export class FeedbackTableMissingError extends Error {
  constructor(message = "Feedback database table is missing.") {
    super(message);
    this.name = "FeedbackTableMissingError";
  }
}

type DatabaseConnection = Awaited<ReturnType<typeof openDatabase>>;

const globalForFeedbackDb = globalThis as unknown as {
  __chemdftFeedbackDb?: DatabaseConnection | undefined;
  __chemdftFeedbackDbUrl?: string | null | undefined;
};

export async function getFeedbackDatabase(config?: AuthConfig): Promise<DatabaseConnection> {
  const currentConfig = config ?? readAuthConfig(process.env);
  const url = currentConfig.databaseUrl;

  if (globalForFeedbackDb.__chemdftFeedbackDb && globalForFeedbackDb.__chemdftFeedbackDbUrl === url) {
    return globalForFeedbackDb.__chemdftFeedbackDb;
  }

  const db = await openDatabase(currentConfig);
  globalForFeedbackDb.__chemdftFeedbackDb = db;
  globalForFeedbackDb.__chemdftFeedbackDbUrl = url;
  return db;
}

export function setFeedbackDatabaseOverride(db: DatabaseConnection | undefined) {
  globalForFeedbackDb.__chemdftFeedbackDb = db;
  globalForFeedbackDb.__chemdftFeedbackDbUrl = undefined;
}

function isPostgres(db: DatabaseConnection): boolean {
  return "query" in db && typeof (db as { query: unknown }).query === "function";
}

function isTableMissingError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return (
    code === "42P01" || // PostgreSQL undefined_table
    msg.includes("no such table: feedback_report") ||
    msg.includes("relation \"feedback_report\" does not exist") ||
    msg.includes("relation \"public.feedback_report\" does not exist")
  );
}

/**
 * Universal query runner supporting both pg.Pool and DatabaseSync (node:sqlite).
 * Translates ? placeholders to $1, $2, ... for PostgreSQL.
 */
export async function queryRows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  dbOverride?: DatabaseConnection,
): Promise<T[]> {
  const db = dbOverride ?? (await getFeedbackDatabase());

  try {
    if (isPostgres(db)) {
      let idx = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (db as any).query(pgSql, params);
      return (res.rows || []) as T[];
    } else {
      // SQLite (DatabaseSync)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (db as any).prepare(sql);
      const rows = stmt.all(...params);
      return (rows || []) as T[];
    }
  } catch (error) {
    if (isTableMissingError(error)) {
      console.warn("[chemdft-feedback] table_missing: feedback_report table not found in auth database");
      throw new FeedbackTableMissingError();
    }
    throw error;
  }
}

/**
 * Universal execute runner for INSERT / UPDATE / DELETE.
 */
export async function executeSql(
  sql: string,
  params: unknown[] = [],
  dbOverride?: DatabaseConnection,
): Promise<{ rowCount: number }> {
  const db = dbOverride ?? (await getFeedbackDatabase());

  try {
    if (isPostgres(db)) {
      let idx = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (db as any).query(pgSql, params);
      return { rowCount: res.rowCount ?? 0 };
    } else {
      // SQLite
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (db as any).prepare(sql);
      const res = stmt.run(...params);
      return { rowCount: res.changes ?? 0 };
    }
  } catch (error) {
    if (isTableMissingError(error)) {
      console.warn("[chemdft-feedback] table_missing: feedback_report table not found in auth database");
      throw new FeedbackTableMissingError();
    }
    throw error;
  }
}

/**
 * Creates the feedback_report table for local tests or test environments.
 */
export async function initFeedbackTableForTest(dbOverride?: DatabaseConnection): Promise<void> {
  const ddl = `
    CREATE TABLE IF NOT EXISTS "user" (
      "id" text PRIMARY KEY,
      "email" text,
      "name" text
    );
    CREATE TABLE IF NOT EXISTS feedback_report (
      "id" text PRIMARY KEY,
      "userId" text NOT NULL,
      "type" text NOT NULL,
      "title" text NOT NULL,
      "details" text NOT NULL,
      "status" text NOT NULL,
      "replyConsent" boolean NOT NULL DEFAULT false,
      "pagePath" text NOT NULL,
      "locale" text NOT NULL,
      "appVersion" text NOT NULL,
      "attachmentCount" integer NOT NULL DEFAULT 0,
      "attachmentBytes" integer NOT NULL DEFAULT 0,
      "providerMessageId" text,
      "errorCode" text,
      "createdAt" timestamp NOT NULL,
      "sentAt" timestamp
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_report_user_created
      ON feedback_report ("userId", "createdAt");
  `;

  const db = dbOverride ?? (await getFeedbackDatabase());
  if (isPostgres(db)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).query(ddl);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).exec(ddl);
  }
}

export async function insertPendingFeedbackReport(
  report: Omit<FeedbackReportRecord, "providerMessageId" | "errorCode" | "sentAt">,
  dbOverride?: DatabaseConnection,
): Promise<void> {
  const sql = `
    INSERT INTO feedback_report (
      "id", "userId", "type", "title", "details", "status",
      "replyConsent", "pagePath", "locale", "appVersion",
      "attachmentCount", "attachmentBytes", "createdAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const db = dbOverride ?? (await getFeedbackDatabase());
  const replyConsentVal = isPostgres(db) ? Boolean(report.replyConsent) : (report.replyConsent ? 1 : 0);

  await executeSql(
    sql,
    [
      report.id,
      report.userId,
      report.type,
      report.title,
      report.details,
      report.status,
      replyConsentVal,
      report.pagePath,
      report.locale,
      report.appVersion,
      report.attachmentCount,
      report.attachmentBytes,
      report.createdAt,
    ],
    db,
  );
}

export async function updateFeedbackReportStatus(
  id: string,
  status: FeedbackStatus,
  extra: {
    providerMessageId?: string | null;
    errorCode?: string | null;
    sentAt?: string | null;
  } = {},
  dbOverride?: DatabaseConnection,
): Promise<void> {
  const sql = `
    UPDATE feedback_report
    SET "status" = ?, "providerMessageId" = ?, "errorCode" = ?, "sentAt" = ?
    WHERE "id" = ?
  `;

  await executeSql(
    sql,
    [status, extra.providerMessageId ?? null, extra.errorCode ?? null, extra.sentAt ?? null, id],
    dbOverride,
  );
}

export async function countUserReportsInWindow(
  userId: string,
  windowMs: number,
  dbOverride?: DatabaseConnection,
): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const sql = `
    SELECT COUNT(*) as count
    FROM feedback_report
    WHERE "userId" = ? AND "createdAt" >= ?
  `;

  const rows = await queryRows<{ count: number | string }>(sql, [userId, since], dbOverride);
  const count = rows[0]?.count ?? 0;
  return Number(count);
}

export async function countFailedReportsInWindow(
  windowMs: number,
  dbOverride?: DatabaseConnection,
): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const sql = `
    SELECT COUNT(*) as count
    FROM feedback_report
    WHERE "status" = 'failed' AND "createdAt" >= ?
  `;

  const rows = await queryRows<{ count: number | string }>(sql, [since], dbOverride);
  const count = rows[0]?.count ?? 0;
  return Number(count);
}

export async function listRecentFeedbackReports(
  limit = 100,
  dbOverride?: DatabaseConnection,
): Promise<Array<FeedbackReportRecord & { accountEmail?: string }>> {
  const sql = `
    SELECT
      f."id", f."userId", f."type", f."title", f."details", f."status",
      f."replyConsent", f."pagePath", f."locale", f."appVersion",
      f."attachmentCount", f."attachmentBytes", f."providerMessageId",
      f."errorCode", f."createdAt", f."sentAt",
      u."email" as "accountEmail"
    FROM feedback_report f
    LEFT JOIN "user" u ON f."userId" = u."id"
    ORDER BY f."createdAt" DESC
    LIMIT ?
  `;

  const rows = await queryRows<FeedbackReportRecord & { accountEmail?: string }>(sql, [limit], dbOverride);
  return rows.map((r) => ({
    ...r,
    replyConsent: Boolean(r.replyConsent),
    attachmentCount: Number(r.attachmentCount),
    attachmentBytes: Number(r.attachmentBytes),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(r.createdAt as unknown as Date).toISOString(),
    sentAt: r.sentAt ? (typeof r.sentAt === "string" ? r.sentAt : new Date(r.sentAt as unknown as Date).toISOString()) : null,
  }));
}

export async function deleteFeedbackReportsForUser(
  userId: string,
  dbOverride?: DatabaseConnection,
): Promise<number> {
  const sql = `DELETE FROM feedback_report WHERE "userId" = ?`;
  const result = await executeSql(sql, [userId], dbOverride);
  return result.rowCount;
}
