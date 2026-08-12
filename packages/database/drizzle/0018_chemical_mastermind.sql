CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"agent_instruction" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'image' NOT NULL,
	"mode" text DEFAULT 'intelligent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agents_owner_user_id_idx" ON "agents" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "agents_created_at_idx" ON "agents" USING btree ("created_at");--> statement-breakpoint
INSERT INTO "agents" (
	"id",
	"owner_user_id",
	"name",
	"description",
	"agent_instruction",
	"type",
	"mode",
	"created_at",
	"updated_at"
) VALUES (
	'00000000-0000-4000-8000-000000000100',
	NULL,
	'家居推广图 Agent',
	'为家居商品生成带生活场景的营销推广图。',
	'优先为家居商品设计真实、可信的生活场景推广图；在用户未明确授权时，保持商品主体的身份、结构、材质、颜色、图案、Logo 和包装不变。',
	'image',
	'normal',
	'2026-07-13T14:30:00+08:00',
	'2026-07-13T14:30:00+08:00'
);
