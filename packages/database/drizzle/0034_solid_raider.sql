CREATE TYPE "public"."prompt_optimization_image_decision_status" AS ENUM('not_needed', 'resolved', 'missing', 'ambiguous');--> statement-breakpoint
ALTER TABLE "prompt_optimizations" ADD COLUMN "image_decision_status" "prompt_optimization_image_decision_status";--> statement-breakpoint
ALTER TABLE "prompt_optimizations" ADD COLUMN "selected_image_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;