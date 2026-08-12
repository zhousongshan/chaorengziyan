ALTER TABLE "agents" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "agents_archived_at_idx" ON "agents" USING btree ("archived_at");