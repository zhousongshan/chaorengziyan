ALTER TABLE "generation_tasks" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD COLUMN "instruction" text;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD COLUMN "instruction_version" text;--> statement-breakpoint
UPDATE "generation_tasks" SET "idempotency_key" = "id"::text, "instruction" = '', "instruction_version" = 'legacy-v0' WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "generation_tasks" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_tasks" ALTER COLUMN "instruction" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_tasks" ALTER COLUMN "instruction_version" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_tasks_user_idempotency_uidx" ON "generation_tasks" USING btree ("user_id","idempotency_key");
