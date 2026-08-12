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
	"superseded_by_asset_id" = NULL,
	"rejection_code" = CASE
		WHEN repair_check."status" = 'source_unusable' THEN 'SOURCE_UNUSABLE'
		WHEN repair_check."status" IN ('completed', 'execution_failed', 'cancelled') AND repair_check."deliverable_asset_id" IS NULL
			THEN COALESCE(repair_check."error_code", 'SUBJECT_CONSISTENCY_REJECTED')
		ELSE NULL
	END,
	"updated_at" = repair_check."updated_at"
FROM repair_outputs repair_check
WHERE repair_check."generation_task_id" = output."task_id";
