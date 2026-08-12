CREATE TYPE "public"."prompt_optimization_operation" AS ENUM('optimize', 'alternative', 'revise');--> statement-breakpoint
CREATE TYPE "public"."prompt_optimization_status" AS ENUM('processing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "prompt_optimization_assets" (
	"optimization_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"role" "conversation_asset_role" NOT NULL,
	"position" integer NOT NULL,
	"relation" text,
	CONSTRAINT "prompt_optimization_assets_optimization_id_position_pk" PRIMARY KEY("optimization_id","position")
);
--> statement-breakpoint
CREATE TABLE "prompt_optimizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"parent_optimization_id" uuid,
	"operation" "prompt_optimization_operation" NOT NULL,
	"status" "prompt_optimization_status" DEFAULT 'processing' NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"original_text" text NOT NULL,
	"optimized_text" text,
	"revision_instruction" text,
	"input_revision" jsonb NOT NULL,
	"ai_model" text,
	"prompt_version" text,
	"error_code" text,
	"adopted_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_optimization_assets" ADD CONSTRAINT "prompt_optimization_assets_optimization_id_prompt_optimizations_id_fk" FOREIGN KEY ("optimization_id") REFERENCES "public"."prompt_optimizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_optimization_assets" ADD CONSTRAINT "prompt_optimization_assets_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_optimizations" ADD CONSTRAINT "prompt_optimizations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_optimizations" ADD CONSTRAINT "prompt_optimizations_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_optimizations" ADD CONSTRAINT "prompt_optimizations_parent_optimization_id_prompt_optimizations_id_fk" FOREIGN KEY ("parent_optimization_id") REFERENCES "public"."prompt_optimizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_optimizations" ADD CONSTRAINT "prompt_optimizations_adopted_message_id_conversation_messages_id_fk" FOREIGN KEY ("adopted_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_optimization_assets_asset_role_uidx" ON "prompt_optimization_assets" USING btree ("optimization_id","asset_id","role");--> statement-breakpoint
CREATE INDEX "prompt_optimization_assets_asset_id_idx" ON "prompt_optimization_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_optimizations_user_idempotency_uidx" ON "prompt_optimizations" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_optimizations_adopted_message_uidx" ON "prompt_optimizations" USING btree ("adopted_message_id") WHERE "prompt_optimizations"."adopted_message_id" is not null;--> statement-breakpoint
CREATE INDEX "prompt_optimizations_session_created_idx" ON "prompt_optimizations" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "prompt_optimizations_parent_id_idx" ON "prompt_optimizations" USING btree ("parent_optimization_id");--> statement-breakpoint
CREATE INDEX "prompt_optimizations_status_updated_idx" ON "prompt_optimizations" USING btree ("status","updated_at");