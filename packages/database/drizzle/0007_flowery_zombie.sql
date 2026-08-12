ALTER TYPE "public"."subject_check_phase" ADD VALUE 'repair_generation' BEFORE 'final_inspection';--> statement-breakpoint
CREATE TABLE "subject_consistency_repairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"requirement_run_id" uuid NOT NULL,
	"generation_task_id" uuid NOT NULL,
	"generated_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subject_consistency_attempts" ADD COLUMN "generation_task_id" uuid;--> statement-breakpoint
ALTER TABLE "subject_consistency_attempts" ADD COLUMN "generated_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "subject_consistency_repairs" ADD CONSTRAINT "subject_consistency_repairs_check_id_subject_consistency_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."subject_consistency_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_consistency_repairs" ADD CONSTRAINT "subject_consistency_repairs_requirement_run_id_requirement_runs_id_fk" FOREIGN KEY ("requirement_run_id") REFERENCES "public"."requirement_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_consistency_repairs" ADD CONSTRAINT "subject_consistency_repairs_generation_task_id_generation_tasks_id_fk" FOREIGN KEY ("generation_task_id") REFERENCES "public"."generation_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_consistency_repairs" ADD CONSTRAINT "subject_consistency_repairs_generated_asset_id_media_assets_id_fk" FOREIGN KEY ("generated_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subject_repairs_check_id_uidx" ON "subject_consistency_repairs" USING btree ("check_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_repairs_generation_task_id_uidx" ON "subject_consistency_repairs" USING btree ("generation_task_id");--> statement-breakpoint
CREATE INDEX "subject_repairs_generated_asset_id_idx" ON "subject_consistency_repairs" USING btree ("generated_asset_id");--> statement-breakpoint
ALTER TABLE "subject_consistency_attempts" ADD CONSTRAINT "subject_consistency_attempts_generation_task_id_generation_tasks_id_fk" FOREIGN KEY ("generation_task_id") REFERENCES "public"."generation_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_consistency_attempts" ADD CONSTRAINT "subject_consistency_attempts_generated_asset_id_media_assets_id_fk" FOREIGN KEY ("generated_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;