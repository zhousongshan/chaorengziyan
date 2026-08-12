CREATE TYPE "public"."generation_output_status" AS ENUM('candidate', 'deliverable', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."product_entity_lineage_status" AS ENUM('trusted', 'legacy_unverified');--> statement-breakpoint
CREATE TYPE "public"."product_entity_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TABLE "product_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text,
	"status" "product_entity_status" DEFAULT 'active' NOT NULL,
	"lineage_status" "product_entity_lineage_status" DEFAULT 'trusted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_entity_sources" (
	"product_entity_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "product_entity_sources_product_entity_id_position_pk" PRIMARY KEY("product_entity_id","position")
);
--> statement-breakpoint
ALTER TABLE "generation_task_outputs" ADD COLUMN "status" "generation_output_status" DEFAULT 'candidate' NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_task_outputs" ADD COLUMN "deliverable_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_task_outputs" ADD COLUMN "superseded_by_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_task_outputs" ADD COLUMN "rejection_code" text;--> statement-breakpoint
ALTER TABLE "generation_task_outputs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_unit_subject_entities" ADD COLUMN "product_entity_id" uuid;--> statement-breakpoint
INSERT INTO "product_entities" (
	"id",
	"user_id",
	"project_id",
	"label",
	"status",
	"lineage_status",
	"created_at",
	"updated_at"
)
SELECT
	entity."id",
	task."user_id",
	task."project_id",
	entity."label",
	'active',
	'legacy_unverified',
	task."created_at",
	task."updated_at"
FROM "generation_unit_subject_entities" entity
INNER JOIN "generation_task_units" unit ON unit."id" = entity."unit_id"
INNER JOIN "generation_tasks" task ON task."id" = unit."task_id";--> statement-breakpoint
INSERT INTO "product_entity_sources" ("product_entity_id", "asset_id", "position")
SELECT entity_source."entity_id", entity_source."asset_id", entity_source."position"
FROM "generation_unit_subject_entity_sources" entity_source;--> statement-breakpoint
UPDATE "generation_unit_subject_entities"
SET "product_entity_id" = "id";--> statement-breakpoint
WITH latest_direct_check AS (
	SELECT DISTINCT ON ("generated_asset_id")
		"generated_asset_id", "status", "deliverable_asset_id", "error_code", "updated_at"
	FROM "subject_consistency_checks"
	ORDER BY "generated_asset_id", "updated_at" DESC
)
UPDATE "generation_task_outputs" output
SET
	"status" = CASE
		WHEN direct_check."generated_asset_id" IS NULL THEN 'deliverable'::"generation_output_status"
		WHEN direct_check."status" = 'completed' AND direct_check."deliverable_asset_id" IS NOT NULL
			THEN 'deliverable'::"generation_output_status"
		WHEN direct_check."status" IN ('completed', 'source_unusable', 'execution_failed', 'cancelled')
			THEN 'rejected'::"generation_output_status"
		ELSE 'candidate'::"generation_output_status"
	END,
	"deliverable_asset_id" = CASE
		WHEN direct_check."generated_asset_id" IS NULL THEN output."asset_id"
		WHEN direct_check."status" = 'completed' THEN direct_check."deliverable_asset_id"
		ELSE NULL
	END,
	"rejection_code" = CASE
		WHEN direct_check."status" = 'source_unusable' THEN 'SOURCE_UNUSABLE'
		WHEN direct_check."status" IN ('completed', 'execution_failed', 'cancelled') AND direct_check."deliverable_asset_id" IS NULL
			THEN COALESCE(direct_check."error_code", 'SUBJECT_CONSISTENCY_REJECTED')
		ELSE NULL
	END,
	"updated_at" = COALESCE(direct_check."updated_at", output."updated_at")
FROM latest_direct_check direct_check
WHERE direct_check."generated_asset_id" = output."asset_id";--> statement-breakpoint
UPDATE "generation_task_outputs" output
SET
	"status" = 'deliverable'::"generation_output_status",
	"deliverable_asset_id" = output."asset_id",
	"rejection_code" = NULL
WHERE NOT EXISTS (
	SELECT 1 FROM "subject_consistency_checks" check_record
	WHERE check_record."generated_asset_id" = output."asset_id"
) AND NOT EXISTS (
	SELECT 1 FROM "subject_consistency_repairs" repair_record
	WHERE repair_record."generation_task_id" = output."task_id"
);--> statement-breakpoint
UPDATE "generation_task_outputs" output
SET
	"status" = 'superseded'::"generation_output_status",
	"deliverable_asset_id" = NULL,
	"superseded_by_asset_id" = repair."generated_asset_id",
	"rejection_code" = NULL,
	"updated_at" = repair."updated_at"
FROM "subject_consistency_repairs" repair
INNER JOIN "subject_consistency_checks" check_record ON check_record."id" = repair."check_id"
WHERE check_record."generated_asset_id" = output."asset_id"
	AND repair."generated_asset_id" IS NOT NULL;--> statement-breakpoint
WITH repair_outputs AS (
	SELECT
		repair."generation_task_id",
		check_record."status",
		check_record."deliverable_asset_id",
		check_record."error_code",
		check_record."updated_at"
	FROM "subject_consistency_repairs" repair
	INNER JOIN "subject_consistency_checks" check_record ON check_record."id" = repair."check_id"
)
UPDATE "generation_task_outputs" output
SET
	"status" = CASE
		WHEN repair_check."status" = 'completed' AND repair_check."deliverable_asset_id" IS NOT NULL
			THEN 'deliverable'::"generation_output_status"
		WHEN repair_check."status" IN ('completed', 'source_unusable', 'execution_failed', 'cancelled')
			THEN 'rejected'::"generation_output_status"
		ELSE 'candidate'::"generation_output_status"
	END,
	"deliverable_asset_id" = CASE
		WHEN repair_check."status" = 'completed' THEN repair_check."deliverable_asset_id"
		ELSE NULL
	END,
	"rejection_code" = CASE
		WHEN repair_check."status" = 'source_unusable' THEN 'SOURCE_UNUSABLE'
		WHEN repair_check."status" IN ('completed', 'execution_failed', 'cancelled') AND repair_check."deliverable_asset_id" IS NULL
			THEN COALESCE(repair_check."error_code", 'SUBJECT_CONSISTENCY_REJECTED')
		ELSE NULL
	END,
	"updated_at" = repair_check."updated_at"
FROM repair_outputs repair_check
WHERE repair_check."generation_task_id" = output."task_id";--> statement-breakpoint
ALTER TABLE "product_entities" ADD CONSTRAINT "product_entities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_entity_sources" ADD CONSTRAINT "product_entity_sources_product_entity_id_product_entities_id_fk" FOREIGN KEY ("product_entity_id") REFERENCES "public"."product_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_entity_sources" ADD CONSTRAINT "product_entity_sources_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_entities_user_id_idx" ON "product_entities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "product_entities_project_id_idx" ON "product_entities" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "product_entities_project_status_idx" ON "product_entities" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "product_entity_sources_entity_asset_uidx" ON "product_entity_sources" USING btree ("product_entity_id","asset_id");--> statement-breakpoint
CREATE INDEX "product_entity_sources_asset_id_idx" ON "product_entity_sources" USING btree ("asset_id");--> statement-breakpoint
CREATE FUNCTION "prevent_product_entity_source_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' AND EXISTS (
		SELECT 1 FROM "product_entities" WHERE "id" = OLD."product_entity_id"
	) THEN
		RAISE EXCEPTION 'product entity sources are immutable';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		RAISE EXCEPTION 'product entity sources are immutable';
	END IF;
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "product_entity_sources_immutable_trg"
BEFORE UPDATE OR DELETE ON "product_entity_sources"
FOR EACH ROW EXECUTE FUNCTION "prevent_product_entity_source_mutation"();--> statement-breakpoint
ALTER TABLE "generation_task_outputs" ADD CONSTRAINT "generation_task_outputs_deliverable_asset_id_media_assets_id_fk" FOREIGN KEY ("deliverable_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task_outputs" ADD CONSTRAINT "generation_task_outputs_superseded_by_asset_id_media_assets_id_fk" FOREIGN KEY ("superseded_by_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_unit_subject_entities" ADD CONSTRAINT "generation_unit_subject_entities_product_entity_id_product_entities_id_fk" FOREIGN KEY ("product_entity_id") REFERENCES "public"."product_entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_task_outputs_deliverable_asset_id_idx" ON "generation_task_outputs" USING btree ("deliverable_asset_id");--> statement-breakpoint
CREATE INDEX "generation_task_outputs_status_idx" ON "generation_task_outputs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_unit_subject_entities_unit_product_uidx" ON "generation_unit_subject_entities" USING btree ("unit_id","product_entity_id");
