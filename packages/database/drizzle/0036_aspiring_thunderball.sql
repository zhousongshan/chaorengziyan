ALTER TABLE "requirement_ai_attempts" ALTER COLUMN "raw_output" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ADD COLUMN "phase_attempt_number" integer;--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ADD COLUMN "error_phase" text;--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ADD COLUMN "error_details" jsonb;--> statement-breakpoint
UPDATE "requirement_ai_attempts"
SET
  "phase" = CASE WHEN "attempt_number" = 1 THEN 'resolve' ELSE 'repair' END,
  "phase_attempt_number" = 1,
  "started_at" = "created_at",
  "completed_at" = "created_at"
WHERE "phase" IS NULL OR "phase_attempt_number" IS NULL OR "started_at" IS NULL;--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ALTER COLUMN "phase" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ALTER COLUMN "phase_attempt_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ALTER COLUMN "started_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "requirement_ai_attempts" ALTER COLUMN "started_at" SET NOT NULL;
