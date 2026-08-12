ALTER TABLE "conversation_sessions" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_sessions_user_agent_updated_idx" ON "conversation_sessions" USING btree ("user_id","agent_id","updated_at");
