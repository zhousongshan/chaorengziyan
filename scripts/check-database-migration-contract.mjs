import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const moduleSource = await readFile(
  new URL("../packages/database/src/migration-status.ts", import.meta.url),
  "utf8"
);
const id = Number(moduleSource.match(/id:\s*(\d+)/)?.[1]);
const tag = moduleSource.match(/tag:\s*"([^"]+)"/)?.[1];
const expectedHash = moduleSource.match(/hash:\s*"([a-f0-9]{64})"/)?.[1];
if (!Number.isInteger(id) || !tag || !expectedHash) {
  throw new Error("无法读取数据库迁移契约");
}

const journal = JSON.parse(
  await readFile(
    new URL("../packages/database/drizzle/meta/_journal.json", import.meta.url),
    "utf8"
  )
);
const latest = journal.entries.at(-1);
if (!latest || latest.idx + 1 !== id || latest.tag !== tag) {
  throw new Error(
    `数据库迁移契约过期：契约=${id}/${tag}，journal=${latest?.idx + 1}/${latest?.tag}`
  );
}

const migration = await readFile(
  new URL(`../packages/database/drizzle/${tag}.sql`, import.meta.url)
);
const actualHash = createHash("sha256").update(migration).digest("hex");
if (actualHash !== expectedHash) {
  throw new Error(`数据库迁移哈希不匹配：${tag}`);
}

process.stdout.write(`数据库迁移契约有效：${id}/${tag}\n`);
