import { migrate } from "drizzle-orm/postgres-js/migrator";
import { config } from "dotenv";

import { createDatabase } from "../src/client.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL 未配置");

const { db, close } = createDatabase(databaseUrl);
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
} finally {
  await close();
}
