CREATE TYPE "public"."conversation_asset_role" AS ENUM('product_source', 'user_reference', 'edit_base', 'generated_result', 'selected_result', 'rejected_result');--> statement-breakpoint
CREATE TYPE "public"."conversation_memory_status" AS ENUM('active', 'superseded', 'rejected', 'historical');--> statement-breakpoint
CREATE TYPE "public"."conversation_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."conversation_message_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "asset_visual_memories" (
	"session_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"asset_role" "conversation_asset_role" NOT NULL,
	"caption" text NOT NULL,
	"ocr_text" text,
	"product_facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"creative_facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"analysis_model" text NOT NULL,
	"analysis_version" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_visual_memories_session_id_asset_id_pk" PRIMARY KEY("session_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"source_message_id" uuid NOT NULL,
	"turn_number" integer NOT NULL,
	"memory_type" text NOT NULL,
	"content" text NOT NULL,
	"structured_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "conversation_memory_status" DEFAULT 'active' NOT NULL,
	"search_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_message_assets" (
	"message_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"role" "conversation_asset_role" NOT NULL,
	"position" integer NOT NULL,
	"relation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_message_assets_message_id_position_pk" PRIMARY KEY("message_id","position")
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_number" integer NOT NULL,
	"role" "conversation_message_role" NOT NULL,
	"content" text NOT NULL,
	"status" "conversation_message_status" NOT NULL,
	"idempotency_key" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"mode" text DEFAULT 'image' NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"processing_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_state_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"source_message_id" uuid,
	"through_turn" integer NOT NULL,
	"version" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD COLUMN "state_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "requirement_runs" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "requirement_runs" ADD COLUMN "source_message_id" uuid;--> statement-breakpoint
ALTER TABLE "requirement_runs" ADD COLUMN "state_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_visual_memories" ADD CONSTRAINT "asset_visual_memories_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_visual_memories" ADD CONSTRAINT "asset_visual_memories_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_memory_entries" ADD CONSTRAINT "conversation_memory_entries_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_memory_entries" ADD CONSTRAINT "conversation_memory_entries_source_message_id_conversation_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_assets" ADD CONSTRAINT "conversation_message_assets_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_assets" ADD CONSTRAINT "conversation_message_assets_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_state_snapshots" ADD CONSTRAINT "conversation_state_snapshots_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_state_snapshots" ADD CONSTRAINT "conversation_state_snapshots_source_message_id_conversation_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_visual_memories_asset_id_idx" ON "asset_visual_memories" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "conversation_memory_session_turn_idx" ON "conversation_memory_entries" USING btree ("session_id","turn_number");--> statement-breakpoint
CREATE INDEX "conversation_memory_source_message_idx" ON "conversation_memory_entries" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "conversation_memory_status_idx" ON "conversation_memory_entries" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_assets_message_asset_role_uidx" ON "conversation_message_assets" USING btree ("message_id","asset_id","role");--> statement-breakpoint
CREATE INDEX "conversation_message_assets_asset_id_idx" ON "conversation_message_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_session_turn_role_uidx" ON "conversation_messages" USING btree ("session_id","turn_number","role");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_session_idempotency_uidx" ON "conversation_messages" USING btree ("session_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "conversation_messages_session_created_idx" ON "conversation_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_status_idx" ON "conversation_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conversation_sessions_user_id_idx" ON "conversation_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversation_sessions_project_id_idx" ON "conversation_sessions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "conversation_sessions_updated_at_idx" ON "conversation_sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_snapshots_session_version_uidx" ON "conversation_state_snapshots" USING btree ("session_id","version");--> statement-breakpoint
CREATE INDEX "conversation_snapshots_session_turn_idx" ON "conversation_state_snapshots" USING btree ("session_id","through_turn");--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_state_snapshot_id_conversation_state_snapshots_id_fk" FOREIGN KEY ("state_snapshot_id") REFERENCES "public"."conversation_state_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_runs" ADD CONSTRAINT "requirement_runs_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_runs" ADD CONSTRAINT "requirement_runs_source_message_id_conversation_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_runs" ADD CONSTRAINT "requirement_runs_state_snapshot_id_conversation_state_snapshots_id_fk" FOREIGN KEY ("state_snapshot_id") REFERENCES "public"."conversation_state_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_tasks_session_id_idx" ON "generation_tasks" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "requirement_runs_session_id_idx" ON "requirement_runs" USING btree ("session_id");