CREATE TABLE "generation_task_regenerations" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"source_task_id" uuid NOT NULL,
	"source_unit_id" uuid NOT NULL,
	"source_asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_task_regenerations" ADD CONSTRAINT "generation_task_regenerations_task_id_generation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."generation_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task_regenerations" ADD CONSTRAINT "generation_task_regenerations_source_task_id_generation_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."generation_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task_regenerations" ADD CONSTRAINT "generation_task_regenerations_source_unit_id_generation_task_units_id_fk" FOREIGN KEY ("source_unit_id") REFERENCES "public"."generation_task_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task_regenerations" ADD CONSTRAINT "generation_task_regenerations_source_asset_id_media_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_regenerations_source_task_idx" ON "generation_task_regenerations" USING btree ("source_task_id");--> statement-breakpoint
CREATE INDEX "generation_regenerations_source_unit_idx" ON "generation_task_regenerations" USING btree ("source_unit_id");--> statement-breakpoint
CREATE INDEX "generation_regenerations_source_asset_idx" ON "generation_task_regenerations" USING btree ("source_asset_id");