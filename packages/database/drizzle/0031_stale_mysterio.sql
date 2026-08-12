CREATE TYPE "public"."media_asset_origin" AS ENUM('uploaded', 'generated');--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "origin" "media_asset_origin";--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "content_sha256" text;--> statement-breakpoint
UPDATE "media_assets" AS asset
SET "origin" = 'generated'
WHERE EXISTS (
	SELECT 1
	FROM "generation_task_outputs" AS output
	WHERE output."asset_id" = asset."id"
		OR output."deliverable_asset_id" = asset."id"
);--> statement-breakpoint
UPDATE "media_assets" SET "origin" = 'uploaded' WHERE "origin" IS NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "origin" SET DEFAULT 'uploaded';--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "origin" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_uploaded_content_uidx" ON "media_assets" USING btree ("user_id","project_id","kind","content_sha256") WHERE "media_assets"."origin" = 'uploaded' and "media_assets"."content_sha256" is not null;
