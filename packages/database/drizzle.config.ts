import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: new URL("../../.env", import.meta.url), quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL },
  strict: true,
  verbose: true
});
