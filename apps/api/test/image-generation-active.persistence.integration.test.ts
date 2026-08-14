import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  conversationSessions,
  createDatabase,
  creationRuns,
  generationTasks,
  projects,
  requirementRuns
} from "@chaoren/database";

import { DrizzleImageGenerationTaskRepository } from "../src/image-generations/drizzle-image-generation-task.repository.js";
import { CreationRunCoordinator } from "../../worker/src/creation-run.coordinator.js";
import { databaseTestUrl } from "./database-test-url.js";

const enabled = process.env.RUN_DATABASE_TESTS === "1";

describe.skipIf(!enabled)("active image generation PostgreSQL contract", () => {
  it("uses the Creation Run lifecycle as the session activity authority", async () => {
    const connection = createDatabase(await databaseTestUrl());
    const ids = {
      user: randomUUID(),
      otherUser: randomUUID(),
      project: randomUUID(),
      session: randomUUID(),
      requirement: randomUUID(),
      run: randomUUID(),
      rootTask: randomUUID(),
      repairTask: randomUUID(),
      nextTask: randomUUID()
    };
    const repository = new DrizzleImageGenerationTaskRepository(connection);
    const startedAt = new Date("2026-08-12T00:00:00.000Z");
    const repairedAt = new Date("2026-08-12T00:01:00.000Z");

    try {
      await connection.db.insert(projects).values({
        id: ids.project,
        ownerUserId: ids.user,
        name: "Active generation contract",
        createdAt: startedAt,
        updatedAt: startedAt
      });
      await connection.db.insert(conversationSessions).values({
        id: ids.session,
        userId: ids.user,
        projectId: ids.project,
        title: "Active generation contract",
        createdAt: startedAt,
        updatedAt: startedAt
      });
      await connection.db.insert(requirementRuns).values({
        id: ids.requirement,
        userId: ids.user,
        projectId: ids.project,
        sessionId: ids.session,
        request: {},
        result: {},
        aiModel: "integration-test",
        promptVersion: "integration-test",
        createdAt: startedAt
      });
      await connection.db.insert(creationRuns).values({
        id: ids.run,
        userId: ids.user,
        projectId: ids.project,
        sessionId: ids.session,
        requirementRunId: ids.requirement,
        status: "running",
        createdAt: startedAt,
        updatedAt: startedAt
      });
      await connection.db
        .insert(generationTasks)
        .values([
          taskRow(ids.rootTask, ids, startedAt, "根任务"),
          taskRow(ids.repairTask, ids, repairedAt, "修复任务")
        ]);

      await expect(repository.findActiveBySessionId(ids.session, ids.user)).resolves.toMatchObject({
        taskId: ids.repairTask,
        status: "succeeded",
        lifecycleStatus: "running"
      });
      await expect(
        repository.findActiveBySessionId(ids.session, ids.otherUser)
      ).resolves.toBeUndefined();

      const coordinator = new CreationRunCoordinator(connection);
      await expect(coordinator.finalizeOrphanedRuns()).resolves.toBe(1);
      await expect(
        repository.findActiveBySessionId(ids.session, ids.user)
      ).resolves.toBeUndefined();

      await connection.db
        .update(creationRuns)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(creationRuns.id, ids.run));

      await connection.db
        .update(creationRuns)
        .set({ status: "cancelling", updatedAt: new Date() })
        .where(eq(creationRuns.id, ids.run));
      await expect(repository.findActiveBySessionId(ids.session, ids.user)).resolves.toMatchObject({
        taskId: ids.repairTask,
        lifecycleStatus: "cancelling"
      });

      await connection.db
        .update(creationRuns)
        .set({ status: "terminal", updatedAt: new Date() })
        .where(eq(creationRuns.id, ids.run));
      await expect(
        repository.findActiveBySessionId(ids.session, ids.user)
      ).resolves.toBeUndefined();

      await expect(
        repository.createOrFind({
          taskId: ids.nextTask,
          userId: ids.user,
          requirementRunId: ids.requirement,
          sessionId: ids.session,
          idempotencyKey: randomUUID(),
          projectId: ids.project,
          modelId: "openai-image",
          instruction: "恢复后的下一次任务",
          instructionVersion: "integration-test",
          status: "queued",
          resultAssets: [],
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          units: [
            {
              unitId: randomUUID(),
              position: 0,
              groupPosition: 0,
              variantPosition: 0,
              outputLayout: "separate_image",
              instruction: "恢复后的下一次任务冻结执行单元",
              qualitySourceAssetIds: [],
              subjectEntities: [],
              sources: []
            }
          ]
        })
      ).resolves.toMatchObject({ created: true, record: { taskId: ids.nextTask } });
    } finally {
      await connection.db
        .delete(generationTasks)
        .where(inArray(generationTasks.id, [ids.rootTask, ids.repairTask, ids.nextTask]));
      await connection.db
        .delete(creationRuns)
        .where(inArray(creationRuns.id, [ids.run, ids.nextTask]));
      await connection.db.delete(requirementRuns).where(eq(requirementRuns.id, ids.requirement));
      await connection.db
        .delete(conversationSessions)
        .where(eq(conversationSessions.id, ids.session));
      await connection.db.delete(projects).where(eq(projects.id, ids.project));
      await connection.close();
    }
  });
});

function taskRow(
  id: string,
  ids: {
    user: string;
    project: string;
    session: string;
    requirement: string;
    run: string;
  },
  createdAt: Date,
  instruction: string
) {
  return {
    id,
    creationRunId: ids.run,
    userId: ids.user,
    projectId: ids.project,
    requirementRunId: ids.requirement,
    sessionId: ids.session,
    idempotencyKey: randomUUID(),
    kind: "image" as const,
    modelId: "openai-image",
    instruction,
    instructionVersion: "integration-test",
    status: "succeeded" as const,
    createdAt,
    updatedAt: createdAt
  };
}
