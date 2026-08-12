CREATE TYPE "public"."creation_run_status" AS ENUM('queued', 'running', 'cancelling', 'terminal', 'cancelled');--> statement-breakpoint
CREATE TABLE "creation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid,
	"requirement_run_id" uuid NOT NULL,
	"status" "creation_run_status" DEFAULT 'queued' NOT NULL,
	"cancel_requested_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"attempt_number" integer,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD COLUMN "creation_run_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_unit_attempts" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_unit_attempts" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_unit_attempts" ADD COLUMN "provider_cancellation_status" text;--> statement-breakpoint
ALTER TABLE "generation_unit_attempts" ADD COLUMN "late_result_discarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creation_runs" ADD CONSTRAINT "creation_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creation_runs" ADD CONSTRAINT "creation_runs_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creation_runs" ADD CONSTRAINT "creation_runs_requirement_run_id_requirement_runs_id_fk" FOREIGN KEY ("requirement_run_id") REFERENCES "public"."requirement_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_run_id_creation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."creation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "creation_runs" (
	"id", "user_id", "project_id", "session_id", "requirement_run_id", "status",
	"cancel_requested_at", "cancelled_at", "cancel_requested_by", "created_at", "updated_at"
)
SELECT
	t."id", t."user_id", t."project_id", t."session_id", t."requirement_run_id",
	CASE
		WHEN t."status" = 'cancelled' THEN 'cancelled'::"creation_run_status"
		WHEN t."status" IN ('queued', 'running') THEN t."status"::text::"creation_run_status"
		WHEN EXISTS (
			SELECT 1 FROM "subject_consistency_checks" c
			WHERE c."generation_task_id" = t."id" AND c."status" IN ('queued', 'running')
		) THEN 'running'::"creation_run_status"
		ELSE 'terminal'::"creation_run_status"
	END,
	CASE WHEN t."status" = 'cancelled' THEN t."updated_at" ELSE NULL END,
	CASE WHEN t."status" = 'cancelled' THEN t."updated_at" ELSE NULL END,
	CASE WHEN t."status" = 'cancelled' THEN t."user_id" ELSE NULL END,
	t."created_at", t."updated_at"
FROM "generation_tasks" t
WHERE NOT EXISTS (
	SELECT 1 FROM "subject_consistency_repairs" r WHERE r."generation_task_id" = t."id"
);--> statement-breakpoint
UPDATE "generation_tasks" t
SET "creation_run_id" = t."id"
WHERE EXISTS (SELECT 1 FROM "creation_runs" r WHERE r."id" = t."id");--> statement-breakpoint
UPDATE "generation_tasks" repair_task
SET "creation_run_id" = check_row."generation_task_id"
FROM "subject_consistency_repairs" repair
JOIN "subject_consistency_checks" check_row ON check_row."id" = repair."check_id"
WHERE repair."generation_task_id" = repair_task."id";--> statement-breakpoint
INSERT INTO "creation_runs" (
	"id", "user_id", "project_id", "session_id", "requirement_run_id", "status", "created_at", "updated_at"
)
SELECT t."id", t."user_id", t."project_id", t."session_id", t."requirement_run_id", 'terminal', t."created_at", t."updated_at"
FROM "generation_tasks" t
WHERE t."creation_run_id" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "generation_tasks" SET "creation_run_id" = "id" WHERE "creation_run_id" IS NULL;--> statement-breakpoint
ALTER TABLE "generation_tasks" ALTER COLUMN "creation_run_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "creation_runs_user_id_idx" ON "creation_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "creation_runs_project_id_idx" ON "creation_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "creation_runs_session_id_idx" ON "creation_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "creation_runs_status_idx" ON "creation_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_events_run_sequence_uidx" ON "workflow_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "workflow_events_pending_idx" ON "workflow_events" USING btree ("published_at","available_at");--> statement-breakpoint
CREATE INDEX "workflow_events_entity_idx" ON "workflow_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_creation_run_id_creation_runs_id_fk" FOREIGN KEY ("creation_run_id") REFERENCES "public"."creation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_tasks_creation_run_id_idx" ON "generation_tasks" USING btree ("creation_run_id");
