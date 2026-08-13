import { sql } from "drizzle-orm";

import type { Database } from "./client.js";

export const EXPECTED_DATABASE_MIGRATION = {
  id: 35,
  tag: "0034_solid_raider",
  hash: "0cd01df7214e66338caf9237525c18a9228fe005fca99093bc03130118260d79"
} as const;

export interface DatabaseMigrationStatus {
  compatible: boolean;
  expectedId: number;
  expectedTag: string;
  actualId: number | null;
  reason: "current" | "missing_history" | "behind" | "ahead" | "hash_mismatch";
}

export async function getDatabaseMigrationStatus(
  database: Database
): Promise<DatabaseMigrationStatus> {
  const relation = await database.execute(
    sql<{ name: string | null }>`select to_regclass('drizzle.__drizzle_migrations')::text as name`
  );
  if (!relation[0]?.name) return status(null, "missing_history");

  const rows = await database.execute(
    sql<{ id: number; hash: string }>`
      select id, hash
      from drizzle.__drizzle_migrations
      order by id desc
      limit 1
    `
  );
  const latest = rows[0];
  const latestId = parseMigrationId(latest?.id);
  const latestHash = typeof latest?.hash === "string" ? latest.hash : null;
  if (latestId === null || latestHash === null) return status(null, "missing_history");
  if (latestId < EXPECTED_DATABASE_MIGRATION.id) return status(latestId, "behind");
  if (latestId > EXPECTED_DATABASE_MIGRATION.id) return status(latestId, "ahead");
  if (latestHash !== EXPECTED_DATABASE_MIGRATION.hash) {
    return status(latestId, "hash_mismatch");
  }
  return status(latestId, "current");
}

export async function assertDatabaseMigrationCurrent(database: Database): Promise<void> {
  const migration = await getDatabaseMigrationStatus(database);
  if (migration.compatible) return;
  throw new DatabaseMigrationMismatchError(migration);
}

export class DatabaseMigrationMismatchError extends Error {
  public constructor(public readonly migration: DatabaseMigrationStatus) {
    super(
      `数据库迁移不兼容：当前=${migration.actualId ?? "无"}，预期=${migration.expectedId} (${migration.expectedTag})，原因=${migration.reason}。请先备份并执行 pnpm db:migrate。`
    );
    this.name = "DatabaseMigrationMismatchError";
  }
}

function status(
  actualId: number | null,
  reason: DatabaseMigrationStatus["reason"]
): DatabaseMigrationStatus {
  return {
    compatible: reason === "current",
    expectedId: EXPECTED_DATABASE_MIGRATION.id,
    expectedTag: EXPECTED_DATABASE_MIGRATION.tag,
    actualId,
    reason
  };
}

function parseMigrationId(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
