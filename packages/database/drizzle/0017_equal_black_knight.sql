ALTER TABLE "generation_unit_attempts" ADD COLUMN "failure_stage" text;--> statement-breakpoint
ALTER TABLE "generation_unit_attempts" ADD COLUMN "error_details" jsonb;