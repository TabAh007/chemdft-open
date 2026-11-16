/**
 * Database client and repository functions for the contact_message table
 * in the authentication database (chemdft_auth).
 *
 * Safe and isolated:
 * - Lazy-safe: if the table does not exist, throws ContactTableMissingError
 *   which maps to clean HTTP 503 CONTACT_UNAVAILABLE without affecting /api/auth/*
 * - Does NOT register with Better Auth models or schema
 * - Supports both PostgreSQL (pg.Pool when hosted) and SQLite (node:sqlite locally/tests)
 * - Stores ZERO PII (no name, no email, no message body)
 */

import { readAuthConfig, type AuthConfig } from "../auth/config.ts";
import { openDatabase } from "../auth/server.ts";
import type { ContactMessageRecord, ContactStatus } from "./types.ts";

export class ContactTableMissingError extends Error {
  constructor(message = "Contact database table is missing.") {
    super(message);
    this.name = "ContactTableMissingError";
  }
}

type DatabaseConnection = Awaited<ReturnType<typeof openDatabase>>;

const globalForContactDb = globalThis as unknown as {
  __chemdftContactDb?: DatabaseConnection | undefined;
  __chemdftContactDbUrl?: string | null | undefined;
  __chemdftContactDbOverride?: DatabaseConnection | undefined;
};

export async function getContactDatabase(config?: AuthConfig): Promise<DatabaseConnection> {
  if (globalForContactDb.__chemdftContactDbOverride) {
    return globalForContactDb.__chemdftContactDbOverride;
  }

  const currentConfig = config ?? readAuthConfig(process.env);
  const url = currentConfig.databaseUrl;

  if (globalForContactDb.__chemdftContactDb && globalForContactDb.__chemdftContactDbUrl === url) {
    return globalForContactDb.__chemdftContactDb;
  }

  const db = await openDatabase(currentConfig);
  globalForContactDb.__chemdftContactDb = db;
  globalForContactDb.__chemdftContactDbUrl = url;
  return db;
}

export function setContactDatabaseOverride(db: DatabaseConnection | undefined) {
  globalForContactDb.__chemdftContactDbOverride = db;
}

function isPostgres(db: DatabaseConnection): boolean {
  return "query" in db && typeof (db as { query: unknown }).query === "function";
}

function isTableMissingError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return (
    code === "42P01" ||
    msg.includes("no such table: contact_message") ||
    msg.includes("relation \"contact_message\" does not exist") ||
    msg.includes("relation \"public.contact_message\" does not exist")
  );
}

/**
 * Universal query runner supporting both pg.Pool and DatabaseSync (node:sqlite).
 */
export async function queryRows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  dbOverride?: DatabaseConnection,
): Promise<T[]> {
  const db = dbOverride ?? (await getContactDatabase());

  try {
    if (isPostgres(db)) {
      let idx = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (db as any).query(pgSql, params);
      return (res.rows || []) as T[];
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (db as any).prepare(sql);
      const rows = stmt.all(...params);
      return (rows || []) as T[];
    }
  } catch (error) {
    if (isTableMissingError(error)) {
      console.warn("[chemdft-contact] table_missing: contact_message table not found in auth database");
      throw new ContactTableMissingError();
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
  const db = dbOverride ?? (await getContactDatabase());

  try {
    if (isPostgres(db)) {
      let idx = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (db as any).query(pgSql, params);
      return { rowCount: res.rowCount ?? 0 };
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (db as any).prepare(sql);
      const res = stmt.run(...params);
      return { rowCount: res.changes ?? 0 };
    }
  } catch (error) {
    if (isTableMissingError(error)) {
      console.warn("[chemdft-contact] table_missing: contact_message table not found in auth database");
      throw new ContactTableMissingError();
    }
    throw error;
  }
}

/**
 * Creates the contact_message table for local tests.
 */
export async function initContactTableForTest(dbOverride?: DatabaseConnection): Promise<void> {
  const ddl = `
    CREATE TABLE IF NOT EXISTS contact_message (
      "id" text PRIMARY KEY,
      "topic" text NOT NULL,
      "status" text NOT NULL,
      "ipHash" text NOT NULL,
      "locale" text NOT NULL,
      "appVersion" text NOT NULL,
      "providerMessageId" text,
      "errorCode" text,
      "createdAt" timestamp NOT NULL,
      "sentAt" timestamp
    );
    CREATE INDEX IF NOT EXISTS idx_contact_message_ip_created
      ON contact_message ("ipHash", "createdAt");
  `;

  const db = dbOverride ?? (await getContactDatabase());
  if (isPostgres(db)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).query(ddl);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).exec(ddl);
  }
}

export async function insertPendingContactMessage(
  record: Omit<ContactMessageRecord, "providerMessageId" | "errorCode" | "sentAt">,
  dbOverride?: DatabaseConnection,
): Promise<void> {
  const sql = `
    INSERT INTO contact_message (
      "id", "topic", "status", "ipHash", "locale", "appVersion", "createdAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  await executeSql(
    sql,
    [
      record.id,
      record.topic,
      record.status,
      record.ipHash,
      record.locale,
      record.appVersion,
      record.createdAt,
    ],
    dbOverride,
  );
}

export async function updateContactMessageStatus(
  id: string,
  status: ContactStatus,
  providerMessageId: string | null = null,
  errorCode: string | null = null,
  dbOverride?: DatabaseConnection,
): Promise<void> {
  const sentAt = status === "sent" ? new Date().toISOString() : null;
  const sql = `
    UPDATE contact_message
    SET "status" = ?, "providerMessageId" = ?, "errorCode" = ?, "sentAt" = ?
    WHERE "id" = ?
  `;

  await executeSql(sql, [status, providerMessageId, errorCode, sentAt, id], dbOverride);
}

export async function countRecentMessagesByIpHash(
  ipHash: string,
  sinceIso: string,
  dbOverride?: DatabaseConnection,
): Promise<number> {
  const sql = `
    SELECT COUNT(*) as count
    FROM contact_message
    WHERE "ipHash" = ? AND "createdAt" >= ?
  `;

  const rows = await queryRows<{ count: number | string }>(sql, [ipHash, sinceIso], dbOverride);
  if (!rows[0]) return 0;
  return Number(rows[0].count);
}

export async function countRecentGlobalMessages(
  sinceIso: string,
  dbOverride?: DatabaseConnection,
): Promise<number> {
  const sql = `
    SELECT COUNT(*) as count
    FROM contact_message
    WHERE "createdAt" >= ?
  `;

  const rows = await queryRows<{ count: number | string }>(sql, [sinceIso], dbOverride);
  if (!rows[0]) return 0;
  return Number(rows[0].count);
}

/**
 * Opportunistic bounded purge: deletes rows older than retention threshold.
 * Uses nested subquery with LIMIT 200 which is compatible with both PostgreSQL and SQLite.
 */
export async function purgeOldContactMessages(
  olderThanIso: string,
  limit = 200,
  dbOverride?: DatabaseConnection,
): Promise<number> {
  const sql = `
    DELETE FROM contact_message
    WHERE "id" IN (
      SELECT "id" FROM contact_message
      WHERE "createdAt" < ?
      LIMIT ?
    )
  `;

  const res = await executeSql(sql, [olderThanIso, limit], dbOverride);
  return res.rowCount;
}
