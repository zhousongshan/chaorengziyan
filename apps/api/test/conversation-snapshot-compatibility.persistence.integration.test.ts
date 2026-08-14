import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  agents,
  conversationSessions,
  conversationStateSnapshots,
  createDatabase,
  projects
} from "@chaoren/database";
import { emptyConversationState, type ConversationState } from "@chaoren/contracts";

import { DrizzleConversationRepository } from "../src/conversations/drizzle-conversation.repository.js";
import { databaseTestUrl } from "./database-test-url.js";

const enabled = process.env.RUN_DATABASE_TESTS === "1";

describe.skipIf(!enabled)("Conversation snapshot compatibility", () => {
  it("loads an early v3 snapshot through the PostgreSQL repository", async () => {
    const connection = createDatabase(await databaseTestUrl());
    const repository = new DrizzleConversationRepository(connection);
    const ids = {
      user: "00000000-0000-4000-8000-000000000001",
      project: randomUUID(),
      agent: randomUUID(),
      session: randomUUID(),
      snapshot: randomUUID(),
      productAsset: randomUUID()
    };
    const now = new Date("2026-08-14T09:00:00.000Z");

    try {
      await connection.db.insert(projects).values({
        id: ids.project,
        ownerUserId: ids.user,
        name: "旧会话快照兼容测试",
        createdAt: now,
        updatedAt: now
      });
      await connection.db.insert(agents).values({
        id: ids.agent,
        ownerUserId: ids.user,
        name: "旧会话快照兼容 Agent",
        type: "image",
        mode: "intelligent"
      });
      await repository.createSession({
        id: ids.session,
        snapshotId: ids.snapshot,
        userId: ids.user,
        projectId: ids.project,
        agentId: ids.agent,
        title: "旧会话",
        state: emptyConversationState,
        createdAt: now.toISOString()
      });

      const earlyV3State = {
        ...emptyConversationState,
        currentGenerationPlan: {
          schemaVersion: "3.0",
          summary: "早期 v3 参考图计划",
          groups: [
            {
              sourceImages: [
                {
                  assetId: ids.productAsset,
                  sourceRole: "product_source",
                  usage: "subject_fact",
                  position: 0
                }
              ],
              subjectEntities: [],
              subjectPolicy: { defaultAction: "preserve", allowedChanges: [] },
              referenceAnalyses: [],
              outputCount: 1,
              outputLayout: "separate_image",
              instruction: "保持商品事实并生成一张图片"
            }
          ]
        }
      } as unknown as ConversationState;
      await connection.db
        .update(conversationStateSnapshots)
        .set({ state: earlyV3State })
        .where(eq(conversationStateSnapshots.id, ids.snapshot));

      await expect(repository.findLatestSnapshot(ids.session, ids.user)).resolves.toMatchObject({
        id: ids.snapshot,
        state: {
          currentGenerationPlan: {
            schemaVersion: "2.0",
            summary: "早期 v3 参考图计划"
          }
        }
      });
    } finally {
      await connection.db
        .delete(conversationSessions)
        .where(eq(conversationSessions.id, ids.session));
      await connection.db.delete(agents).where(eq(agents.id, ids.agent));
      await connection.db.delete(projects).where(eq(projects.id, ids.project));
      await connection.close();
    }
  });
});
