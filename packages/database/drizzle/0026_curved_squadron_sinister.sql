ALTER TABLE "projects" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
WITH "ranked_projects" AS (
	SELECT "id", row_number() OVER (
		PARTITION BY "owner_user_id"
		ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
	) AS "position"
	FROM "projects"
)
UPDATE "projects"
SET "is_default" = true
FROM "ranked_projects"
WHERE "projects"."id" = "ranked_projects"."id"
	AND "ranked_projects"."position" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_owner_active_name_uidx" ON "agents" USING btree ("owner_user_id",lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'))) WHERE "agents"."owner_user_id" is not null and "agents"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_system_active_name_uidx" ON "agents" USING btree (lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'))) WHERE "agents"."owner_user_id" is null and "agents"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_owner_default_uidx" ON "projects" USING btree ("owner_user_id") WHERE "projects"."is_default" = true;
