CREATE TABLE "requirement_ai_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"source_message_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text NOT NULL,
	"raw_output" jsonb NOT NULL,
	"validation_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"contract_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ADD CONSTRAINT "requirement_ai_attempts_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ADD CONSTRAINT "requirement_ai_attempts_source_message_id_conversation_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requirement_ai_attempts_session_id_idx" ON "requirement_ai_attempts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "requirement_ai_attempts_source_message_id_idx" ON "requirement_ai_attempts" USING btree ("source_message_id");