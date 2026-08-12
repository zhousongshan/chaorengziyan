CREATE TABLE "subject_consistency_check_sources" (
	"check_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "subject_consistency_check_sources_check_id_position_pk" PRIMARY KEY("check_id","position")
);
--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" DROP CONSTRAINT "subject_consistency_checks_source_product_asset_id_media_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "subject_consistency_check_sources" ADD CONSTRAINT "subject_consistency_check_sources_check_id_subject_consistency_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."subject_consistency_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_consistency_check_sources" ADD CONSTRAINT "subject_consistency_check_sources_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subject_check_sources_check_asset_uidx" ON "subject_consistency_check_sources" USING btree ("check_id","asset_id");--> statement-breakpoint
CREATE INDEX "subject_check_sources_asset_id_idx" ON "subject_consistency_check_sources" USING btree ("asset_id");--> statement-breakpoint
INSERT INTO "subject_consistency_check_sources" ("check_id", "asset_id", "position")
SELECT "id", "source_product_asset_id", 0
FROM "subject_consistency_checks";--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" DROP COLUMN "source_product_asset_id";--> statement-breakpoint
UPDATE "conversation_state_snapshots"
SET "state" = ("state" - 'activeProductAssetId') || jsonb_build_object(
	'activeProductAssetIds',
	CASE
		WHEN "state"->>'activeProductAssetId' IS NULL THEN '[]'::jsonb
		ELSE jsonb_build_array("state"->>'activeProductAssetId')
	END
)
WHERE "state" ? 'activeProductAssetId';
