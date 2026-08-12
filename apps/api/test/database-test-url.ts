import { config } from "dotenv";

import { resolveWorkspacePath } from "@chaoren/storage";

export async function databaseTestUrl() {
  config({ path: await resolveWorkspacePath(".env"), quiet: true });
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testUrl) throw new Error("TEST_DATABASE_URL 未配置，数据库集成测试已拒绝运行");

  const developmentUrl = process.env.DATABASE_URL?.trim();
  if (developmentUrl && normalizeDatabaseUrl(testUrl) === normalizeDatabaseUrl(developmentUrl)) {
    throw new Error("TEST_DATABASE_URL 不能与 DATABASE_URL 相同");
  }

  const databaseName = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, ""));
  if (!/(^|[_-])test($|[_-])/.test(databaseName)) {
    throw new Error(`测试数据库名称必须包含独立的 test 标识，当前为 ${databaseName}`);
  }
  return testUrl;
}

function normalizeDatabaseUrl(value: string) {
  const url = new URL(value);
  url.password = "";
  return url.toString().replace(/\/$/, "");
}
