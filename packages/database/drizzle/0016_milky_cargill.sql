CREATE TABLE "generation_unit_subject_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"entity_key" text NOT NULL,
	"label" text,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_unit_subject_entity_sources" (
	"entity_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "generation_unit_subject_entity_sources_entity_id_position_pk" PRIMARY KEY("entity_id","position")
);
--> statement-breakpoint
ALTER TABLE "generation_unit_subject_entities" ADD CONSTRAINT "generation_unit_subject_entities_unit_id_generation_task_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."generation_task_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_unit_subject_entity_sources" ADD CONSTRAINT "generation_unit_subject_entity_sources_entity_id_generation_unit_subject_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."generation_unit_subject_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_unit_subject_entity_sources" ADD CONSTRAINT "generation_unit_subject_entity_sources_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "generation_unit_subject_entities" ("unit_id", "entity_key", "label", "position")
SELECT DISTINCT "unit_id", 'legacy_product', '历史商品主体', 0
FROM "generation_task_unit_quality_sources";--> statement-breakpoint
INSERT INTO "generation_unit_subject_entity_sources" ("entity_id", "asset_id", "position")
SELECT entity."id", source."asset_id", source."position"
FROM "generation_unit_subject_entities" entity
JOIN "generation_task_unit_quality_sources" source ON source."unit_id" = entity."unit_id"
WHERE entity."entity_key" = 'legacy_product';--> statement-breakpoint
CREATE UNIQUE INDEX "generation_unit_subject_entities_unit_key_uidx" ON "generation_unit_subject_entities" USING btree ("unit_id","entity_key");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_unit_subject_entities_unit_position_uidx" ON "generation_unit_subject_entities" USING btree ("unit_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_unit_subject_entity_sources_entity_asset_uidx" ON "generation_unit_subject_entity_sources" USING btree ("entity_id","asset_id");--> statement-breakpoint
CREATE INDEX "generation_unit_subject_entity_sources_asset_id_idx" ON "generation_unit_subject_entity_sources" USING btree ("asset_id");
