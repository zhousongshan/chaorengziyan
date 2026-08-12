CREATE TYPE "public"."subject_check_phase" AS ENUM('initial_inspection', 'requirement_reconciliation', 'final_inspection');--> statement-breakpoint
CREATE TYPE "public"."subject_check_status" AS ENUM('queued', 'running', 'completed', 'needs_user_input', 'execution_failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."subject_check_verdict" AS ENUM('passed', 'rejected');--> statement-breakpoint
CREATE TABLE "subject_consistency_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"requirement_snapshot" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subject_consistency_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"generation_task_id" uuid NOT NULL,
	"requirement_run_id" uuid NOT NULL,
	"source_product_asset_id" uuid NOT NULL,
	"generated_asset_id" uuid NOT NULL,
	"status" "subject_check_status" DEFAULT 'queued' NOT NULL,
	"phase" "subject_check_phase" DEFAULT 'initial_inspection' NOT NULL,
	"verdict" "subject_check_verdict",
	"reconciliation" jsonb,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_message" text,
	"error_code" text,
	"error_message" text,
	"inspection_model" text NOT NULL,
	"requirement_model" text NOT NULL,
	"workflow_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subject_consistency_attempts" ADD CONSTRAINT "subject_consistency_attempts_check_id_subject_consistency_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."subject_consistency_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" ADD CONSTRAINT "subject_consistency_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" ADD CONSTRAINT "subject_consistency_checks_generation_task_id_generation_tasks_id_fk" FOREIGN KEY ("generation_task_id") REFERENCES "public"."generation_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" ADD CONSTRAINT "subject_consistency_checks_requirement_run_id_requirement_runs_id_fk" FOREIGN KEY ("requirement_run_id") REFERENCES "public"."requirement_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" ADD CONSTRAINT "subject_consistency_checks_source_product_asset_id_media_assets_id_fk" FOREIGN KEY ("source_product_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" ADD CONSTRAINT "subject_consistency_checks_generated_asset_id_media_assets_id_fk" FOREIGN KEY ("generated_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subject_attempts_check_round_uidx" ON "subject_consistency_attempts" USING btree ("check_id","round");--> statement-breakpoint
CREATE INDEX "subject_attempts_check_id_idx" ON "subject_consistency_attempts" USING btree ("check_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_checks_output_workflow_uidx" ON "subject_consistency_checks" USING btree ("generation_task_id","generated_asset_id","workflow_version");--> statement-breakpoint
CREATE INDEX "subject_checks_user_id_idx" ON "subject_consistency_checks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subject_checks_project_id_idx" ON "subject_consistency_checks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "subject_checks_generation_task_id_idx" ON "subject_consistency_checks" USING btree ("generation_task_id");--> statement-breakpoint
CREATE INDEX "subject_checks_generated_asset_id_idx" ON "subject_consistency_checks" USING btree ("generated_asset_id");--> statement-breakpoint
CREATE INDEX "subject_checks_status_idx" ON "subject_consistency_checks" USING btree ("status");