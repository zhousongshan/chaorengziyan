CREATE TABLE "subject_consistency_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subject_consistency_responses" ADD CONSTRAINT "subject_consistency_responses_check_id_subject_consistency_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."subject_consistency_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subject_responses_check_id_uidx" ON "subject_consistency_responses" USING btree ("check_id");--> statement-breakpoint
CREATE INDEX "subject_responses_check_id_idx" ON "subject_consistency_responses" USING btree ("check_id");