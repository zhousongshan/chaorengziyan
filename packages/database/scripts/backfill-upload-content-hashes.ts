import { createHash } from "node:crypto";

import { and, asc, eq, isNull } from "drizzle-orm";
import { config } from "dotenv";

import { LocalStorageAdapter, resolveWorkspacePath } from "@chaoren/storage";

import { createDatabase } from "../src/client.js";
import { mediaAssets } from "../src/schema.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });

const databaseUrl = process.env.DATABASE_URL;
const storageRoot = process.env.LOCAL_STORAGE_ROOT ?? "./.local-data/media";
if (!databaseUrl) throw new Error("DATABASE_URL 未配置");

const connection = createDatabase(databaseUrl);
const storage = new LocalStorageAdapter(await resolveWorkspacePath(storageRoot));

let updated = 0;
let duplicate = 0;
let unreadable = 0;

try {
  const candidates = await connection.db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.origin, "uploaded"), isNull(mediaAssets.contentSha256)))
    .orderBy(asc(mediaAssets.createdAt), asc(mediaAssets.id));

  for (const candidate of candidates) {
    let contentSha256: string;
    try {
      contentSha256 = await hashStoredObject(storage, candidate.storageKey);
    } catch {
      unreadable += 1;
      continue;
    }

    const [canonical] = await connection.db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.userId, candidate.userId),
          eq(mediaAssets.projectId, candidate.projectId),
          eq(mediaAssets.kind, candidate.kind),
          eq(mediaAssets.origin, "uploaded"),
          eq(mediaAssets.contentSha256, contentSha256)
        )
      )
      .limit(1);
    if (canonical) {
      duplicate += 1;
      continue;
    }

    try {
      const rows = await connection.db
        .update(mediaAssets)
        .set({ contentSha256 })
        .where(and(eq(mediaAssets.id, candidate.id), isNull(mediaAssets.contentSha256)))
        .returning({ id: mediaAssets.id });
      if (rows.length > 0) updated += 1;
    } catch (error) {
      if (isUniqueViolation(error)) duplicate += 1;
      else throw error;
    }
  }
} finally {
  await connection.close();
}

process.stdout.write(
  `上传资产哈希回填完成：标准资产 ${updated}，历史重复保留 ${duplicate}，无法读取 ${unreadable}\n`
);

async function hashStoredObject(storage: LocalStorageAdapter, storageKey: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of await storage.read(storageKey)) hash.update(chunk);
  return hash.digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
