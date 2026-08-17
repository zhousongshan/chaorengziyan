CREATE TYPE "public"."generation_start_request_status" AS ENUM('pending', 'processing', 'dispatched', 'failed');--> statement-breakpoint
CREATE TABLE "generation_start_requests" (
	"requirement_run_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"idempotency_key" uuid NOT NULL,
	"status" "generation_start_request_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "generation_start_requests" ADD CONSTRAINT "generation_start_requests_requirement_run_id_requirement_runs_id_fk" FOREIGN KEY ("requirement_run_id") REFERENCES "public"."requirement_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_start_requests" ADD CONSTRAINT "generation_start_requests_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_start_requests_idempotency_uidx" ON "generation_start_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "generation_start_requests_status_available_idx" ON "generation_start_requests" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "generation_start_requests_session_idx" ON "generation_start_requests" USING btree ("session_id");--> statement-breakpoint
INSERT INTO "generation_start_requests" (
	"requirement_run_id",
	"user_id",
	"session_id",
	"idempotency_key",
	"status",
	"created_at",
	"updated_at"
)
SELECT
	rr."id",
	rr."user_id",
	rr."session_id",
	rr."id",
	'pending',
	now(),
	now()
FROM "requirement_runs" rr
WHERE rr."parent_requirement_run_id" IS NULL
	AND rr."result"->>'status' = 'ready'
	AND rr."execution_plan"->>'schemaVersion' = '3.0'
	AND NOT EXISTS (
		SELECT 1
		FROM "generation_tasks" gt
		WHERE gt."requirement_run_id" = rr."id"
	)
	AND NOT EXISTS (
		SELECT 1
		FROM jsonb_array_elements(rr."execution_plan"->'groups') AS group_row
		WHERE NOT (group_row ? 'referenceDesignPlan')
			OR NOT (group_row ? 'copyPlan')
	)
ON CONFLICT ("requirement_run_id") DO NOTHING;
