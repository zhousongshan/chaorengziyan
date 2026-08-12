CREATE TYPE "public"."conversation_turn_run_status" AS ENUM('queued', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "conversation_turn_runs" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"request" jsonb NOT NULL,
	"status" "conversation_turn_run_status" DEFAULT 'queued' NOT NULL,
	"enqueue_attempts" integer DEFAULT 0 NOT NULL,
	"last_enqueue_attempt_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_turn_runs" ADD CONSTRAINT "conversation_turn_runs_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turn_runs" ADD CONSTRAINT "conversation_turn_runs_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_turn_runs_status_updated_idx" ON "conversation_turn_runs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "conversation_turn_runs_session_id_idx" ON "conversation_turn_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "conversation_turn_runs_user_id_idx" ON "conversation_turn_runs" USING btree ("user_id");