ALTER TABLE "conversation_turn_runs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_turn_runs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "conversation_turn_runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_turn_runs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "conversation_turn_runs_status_lease_idx" ON "conversation_turn_runs" USING btree ("status","lease_expires_at");--> statement-breakpoint
UPDATE "conversation_messages" AS message
SET
	"status" = 'failed',
	"error_code" = 'CONVERSATION_TURN_INTERRUPTED',
	"error_message" = '会话处理进程中断，请重新尝试',
	"updated_at" = now()
FROM "conversation_turn_runs" AS run
WHERE run."message_id" = message."id"
	AND run."status" = 'processing'
	AND run."lease_token" IS NULL;--> statement-breakpoint
UPDATE "conversation_sessions" AS session
SET "processing_message_id" = NULL, "updated_at" = now()
FROM "conversation_turn_runs" AS run
WHERE run."session_id" = session."id"
	AND run."message_id" = session."processing_message_id"
	AND run."status" = 'processing'
	AND run."lease_token" IS NULL;--> statement-breakpoint
UPDATE "conversation_turn_runs"
SET
	"status" = 'failed',
	"completed_at" = now(),
	"last_error" = '部署时终止无租约的历史处理中任务',
	"updated_at" = now()
WHERE "status" = 'processing' AND "lease_token" IS NULL;
