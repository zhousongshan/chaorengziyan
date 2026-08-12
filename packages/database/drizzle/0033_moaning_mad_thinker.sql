ALTER TABLE "prompt_optimizations" ADD COLUMN "execution_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_optimizations" ALTER COLUMN "execution_token" DROP DEFAULT;
