import { migrate } from "drizzle-orm/postgres-js/migrator";
import { config } from "dotenv";

import { createDatabase } from "../src/client.js";
import { assertDatabaseMigrationCurrent } from "../src/migration-status.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL 未配置，拒绝迁移测试数据库");

const developmentDatabaseUrl = process.env.DATABASE_URL?.trim();
if (
  developmentDatabaseUrl &&
  normalizeDatabaseUrl(testDatabaseUrl) === normalizeDatabaseUrl(developmentDatabaseUrl)
) {
  throw new Error("TEST_DATABASE_URL 不能与 DATABASE_URL 相同");
}

const databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.replace(/^\//, ""));
if (!/(^|[_-])test($|[_-])/.test(databaseName)) {
  throw new Error(`测试数据库名称必须包含独立的 test 标识，当前为 ${databaseName}`);
}

const connection = createDatabase(testDatabaseUrl);
try {
  await migrate(connection.db, { migrationsFolder: "./drizzle" });
  await assertDatabaseMigrationCurrent(connection.db);
  process.stdout.write(`测试数据库迁移已就绪：${databaseName}\n`);
} finally {
  await connection.close();
}

function normalizeDatabaseUrl(value: string) {
  const url = new URL(value);
  url.password = "";
  return url.toString().replace(/\/$/, "");
}
