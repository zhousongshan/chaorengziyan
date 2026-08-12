DROP TABLE "subject_consistency_responses" CASCADE;--> statement-breakpoint
DELETE FROM "subject_consistency_checks"
WHERE "workflow_version" <> 'subject-consistency-v4'
   OR "status" = 'needs_user_input';--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" ALTER COLUMN "status" SET DEFAULT 'queued'::text;--> statement-breakpoint
DROP TYPE "public"."subject_check_status";--> statement-breakpoint
CREATE TYPE "public"."subject_check_status" AS ENUM('queued', 'running', 'completed', 'source_unusable', 'execution_failed', 'cancelled');--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" ALTER COLUMN "status" SET DEFAULT 'queued'::"public"."subject_check_status";--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" ALTER COLUMN "status" SET DATA TYPE "public"."subject_check_status" USING "status"::"public"."subject_check_status";--> statement-breakpoint
ALTER TABLE "subject_consistency_checks" DROP COLUMN "questions";
