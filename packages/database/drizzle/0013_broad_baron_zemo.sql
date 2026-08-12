CREATE TABLE "generation_task_unit_quality_sources" (
	"unit_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "generation_task_unit_quality_sources_unit_id_position_pk" PRIMARY KEY("unit_id","position")
);
--> statement-breakpoint
CREATE TABLE "generation_unit_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text NOT NULL,
	"provider_request_id" text,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "generation_task_outputs" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_task_unit_quality_sources" ADD CONSTRAINT "generation_task_unit_quality_sources_unit_id_generation_task_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."generation_task_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task_unit_quality_sources" ADD CONSTRAINT "generation_task_unit_quality_sources_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_unit_attempts" ADD CONSTRAINT "generation_unit_attempts_unit_id_generation_task_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."generation_task_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_task_unit_quality_sources_unit_asset_uidx" ON "generation_task_unit_quality_sources" USING btree ("unit_id","asset_id");--> statement-breakpoint
CREATE INDEX "generation_task_unit_quality_sources_asset_id_idx" ON "generation_task_unit_quality_sources" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_unit_attempts_unit_number_uidx" ON "generation_unit_attempts" USING btree ("unit_id","attempt_number");--> statement-breakpoint
CREATE INDEX "generation_unit_attempts_unit_id_idx" ON "generation_unit_attempts" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "generation_unit_attempts_status_idx" ON "generation_unit_attempts" USING btree ("status");--> statement-breakpoint
ALTER TABLE "generation_task_outputs" ADD CONSTRAINT "generation_task_outputs_unit_id_generation_task_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."generation_task_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_task_outputs_unit_id_uidx" ON "generation_task_outputs" USING btree ("unit_id");