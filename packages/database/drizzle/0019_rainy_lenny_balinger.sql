CREATE TABLE "asset_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_asset_library_entries" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text,
	"folder_id" uuid,
	"favorited_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_asset_library_entries" ADD CONSTRAINT "media_asset_library_entries_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_library_entries" ADD CONSTRAINT "media_asset_library_entries_folder_id_asset_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."asset_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_folders_user_name_uidx" ON "asset_folders" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "asset_folders_user_updated_idx" ON "asset_folders" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "media_asset_library_user_idx" ON "media_asset_library_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "media_asset_library_folder_idx" ON "media_asset_library_entries" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "media_asset_library_favorited_idx" ON "media_asset_library_entries" USING btree ("user_id","favorited_at");--> statement-breakpoint
CREATE INDEX "media_asset_library_hidden_idx" ON "media_asset_library_entries" USING btree ("user_id","hidden_at");