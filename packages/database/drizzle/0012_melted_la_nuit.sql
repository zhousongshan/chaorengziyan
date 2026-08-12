CREATE TABLE "generation_task_unit_sources" (
	"unit_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_role" text NOT NULL,
	"usage" text NOT NULL,
	CONSTRAINT "generation_task_unit_sources_unit_id_position_pk" PRIMARY KEY("unit_id","position")
);
--> statement-breakpoint
CREATE TABLE "generation_task_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"group_position" integer NOT NULL,
	"variant_position" integer NOT NULL,
	"output_layout" text NOT NULL,
	"instruction" text,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requirement_runs" ADD COLUMN "execution_plan" jsonb;--> statement-breakpoint
ALTER TABLE "requirement_runs" ADD COLUMN "execution_plan_hash" text;--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" ADD COLUMN "generation_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_task_unit_sources" ADD CONSTRAINT "generation_task_unit_sources_unit_id_generation_task_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."generation_task_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task_unit_sources" ADD CONSTRAINT "generation_task_unit_sources_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task_units" ADD CONSTRAINT "generation_task_units_task_id_generation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."generation_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_task_unit_sources_asset_id_idx" ON "generation_task_unit_sources" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_task_units_task_position_uidx" ON "generation_task_units" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "generation_task_units_task_id_idx" ON "generation_task_units" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "generation_task_units_status_idx" ON "generation_task_units" USING btree ("status");--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" ADD CONSTRAINT "subject_consistency_checks_generation_unit_id_generation_task_units_id_fk" FOREIGN KEY ("generation_unit_id") REFERENCES "public"."generation_task_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subject_checks_generation_unit_id_idx" ON "subject_consistency_checks" USING btree ("generation_unit_id");