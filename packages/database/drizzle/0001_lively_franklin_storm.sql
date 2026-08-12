CREATE TABLE "generation_task_outputs" (
	"task_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "generation_task_outputs_task_id_position_pk" PRIMARY KEY("task_id","position")
);
--> statement-breakpoint
CREATE TABLE "requirement_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"request" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"ai_model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD COLUMN "requirement_run_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD COLUMN "model_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "original_file_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_task_outputs" ADD CONSTRAINT "generation_task_outputs_task_id_generation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."generation_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task_outputs" ADD CONSTRAINT "generation_task_outputs_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_runs" ADD CONSTRAINT "requirement_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_task_outputs_task_asset_uidx" ON "generation_task_outputs" USING btree ("task_id","asset_id");--> statement-breakpoint
CREATE INDEX "generation_task_outputs_asset_id_idx" ON "generation_task_outputs" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "requirement_runs_user_id_idx" ON "requirement_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "requirement_runs_project_id_idx" ON "requirement_runs" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_requirement_run_id_requirement_runs_id_fk" FOREIGN KEY ("requirement_run_id") REFERENCES "public"."requirement_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_tasks_user_id_idx" ON "generation_tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "generation_tasks_requirement_run_id_idx" ON "generation_tasks" USING btree ("requirement_run_id");--> statement-breakpoint
CREATE INDEX "media_assets_user_id_idx" ON "media_assets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_storage_key_uidx" ON "media_assets" USING btree ("storage_key");--> statement-breakpoint
ALTER TABLE "generation_tasks" DROP COLUMN "request";