import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  agents,
  conversationMemoryEntries,
  conversationMessages,
  conversationSessions,
  conversationTurnRuns,
  creationRuns,
  createDatabase,
  generationTaskOutputs,
  generationTaskUnits,
  generationTasks,
  mediaAssets,
  productEntities,
  projects,
  requirementRuns,
  subjectConsistencyChecks,
  subjectConsistencyCheckSources,
  workflowEvents
} from "@chaoren/database";
import {
  emptyConversationState,
  type RequirementResult,
  type ResolveRequirementRequest
} from "@chaoren/contracts";
import { DrizzleImageGenerationTaskRepository } from "../src/image-generations/drizzle-image-generation-task.repository.js";
import { DrizzleConversationRepository } from "../src/conversations/drizzle-conversation.repository.js";
import { DrizzleMediaAssetRepository } from "../src/media-assets/drizzle-media-asset.repository.js";
import { DrizzleProjectRepository } from "../src/projects/drizzle-project.repository.js";
import { DrizzleRequirementRunRepository } from "../src/requirements/drizzle-requirement-run.repository.js";
import { databaseTestUrl } from "./database-test-url.js";

const enabled = process.env.RUN_DATABASE_TESTS === "1";

describe.skipIf(!enabled)("PostgreSQL repositories", () => {
  it("pages complete conversation turns from newest to oldest", async () => {
    const connection = createDatabase(await databaseTestUrl());
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const agentId = randomUUID();
    const userId = "00000000-0000-4000-8000-000000000001";
    const now = new Date("2026-08-10T08:00:00.000Z");
    const repository = new DrizzleConversationRepository(connection);

    try {
      await connection.db.insert(projects).values({
        id: projectId,
        ownerUserId: userId,
        name: "会话分页测试",
        createdAt: now,
        updatedAt: now
      });
      await connection.db.insert(agents).values({
        id: agentId,
        ownerUserId: userId,
        name: "分页测试 Agent",
        type: "image",
        mode: "intelligent"
      });
      await repository.createSession({
        id: sessionId,
        snapshotId: randomUUID(),
        userId,
        projectId,
        agentId,
        title: "25 轮会话",
        state: emptyConversationState,
        createdAt: now.toISOString()
      });
      const messageRows = Array.from({ length: 25 }, (_, index) => index + 1).flatMap(
        (turnNumber) => [
          {
            id: randomUUID(),
            sessionId,
            turnNumber,
            role: "user" as const,
            content: `第 ${turnNumber} 轮用户消息`,
            status: "completed" as const,
            createdAt: new Date(now.getTime() + turnNumber * 2_000),
            updatedAt: new Date(now.getTime() + turnNumber * 2_000)
          },
          {
            id: randomUUID(),
            sessionId,
            turnNumber,
            role: "assistant" as const,
            content: `第 ${turnNumber} 轮 Agent 回复`,
            status: "completed" as const,
            createdAt: new Date(now.getTime() + turnNumber * 2_000 + 1_000),
            updatedAt: new Date(now.getTime() + turnNumber * 2_000 + 1_000)
          }
        ]
      );
      await connection.db.insert(conversationMessages).values(messageRows);

      const latest = await repository.listMessagePage(sessionId, userId, { limit: 20 });
      expect(latest.messages).toHaveLength(40);
      expect([...new Set(latest.messages.map((message) => message.turnNumber))]).toEqual(
        Array.from({ length: 20 }, (_, index) => index + 6)
      );
      expect(latest.pageInfo).toEqual({
        limit: 20,
        oldestTurn: 6,
        newestTurn: 25,
        hasMore: true,
        nextBeforeTurn: 6
      });

      const older = await repository.listMessagePage(sessionId, userId, {
        beforeTurn: latest.pageInfo.nextBeforeTurn!,
        limit: 20
      });
      expect(older.messages).toHaveLength(10);
      expect([...new Set(older.messages.map((message) => message.turnNumber))]).toEqual([
        1, 2, 3, 4, 5
      ]);
      expect(older.pageInfo).toMatchObject({ hasMore: false, nextBeforeTurn: null });
      await expect(
        repository.listMessagePage(sessionId, randomUUID(), { limit: 20 })
      ).resolves.toMatchObject({ messages: [] });

      const currentMessageId = randomUUID();
      await connection.db.insert(conversationMessages).values({
        id: currentMessageId,
        sessionId,
        turnNumber: 26,
        role: "user",
        content: "当前处理中消息",
        status: "processing"
      });
      await connection.db.insert(conversationMemoryEntries).values(
        Array.from({ length: 25 }, (_, index) => index + 1).map((turnNumber) => ({
          sessionId,
          sourceMessageId: messageRows.find(
            (message) => message.turnNumber === turnNumber && message.role === "user"
          )!.id,
          turnNumber,
          memoryType: "turn_summary",
          content: `第 ${turnNumber} 轮摘要`,
          structuredData: { summary: `第 ${turnNumber} 轮摘要` },
          searchText: `第 ${turnNumber} 轮摘要`
        }))
      );

      const contextMessages = await repository.listContextMessages(sessionId, userId, {
        currentMessageId,
        recentCompletedTurnCount: 20
      });
      expect([...new Set(contextMessages.map((message) => message.turnNumber))]).toEqual(
        Array.from({ length: 21 }, (_, index) => index + 6)
      );
      await expect(repository.listMessagesForTurns(sessionId, userId, [3])).resolves.toMatchObject([
        { turnNumber: 3, role: "user" },
        { turnNumber: 3, role: "assistant" }
      ]);

      const contextMemories = await repository.listMemoryEntriesForContext(sessionId, userId, {
        relevantTurnNumbers: [3, ...Array.from({ length: 20 }, (_, index) => index + 6)],
        beforeTurn: 6,
        olderLimit: 2
      });
      expect(contextMemories.map((entry) => entry.turnNumber)).toEqual([
        3,
        4,
        5,
        ...Array.from({ length: 20 }, (_, index) => index + 6)
      ]);
      expect(contextMemories.some((entry) => entry.turnNumber === 1)).toBe(false);
    } finally {
      await connection.db
        .delete(conversationSessions)
        .where(eq(conversationSessions.id, sessionId));
      await connection.db.delete(agents).where(eq(agents.id, agentId));
      await connection.db.delete(projects).where(eq(projects.id, projectId));
      await connection.close();
    }
  });

  it("keeps messages, versions and snapshots isolated by conversation session", async () => {
    const connection = createDatabase(await databaseTestUrl());
    const ids = {
      project: randomUUID(),
      agentA: randomUUID(),
      agentB: randomUUID(),
      sessionA: randomUUID(),
      sessionB: randomUUID(),
      initialSnapshotA: randomUUID(),
      initialSnapshotB: randomUUID(),
      nextSnapshot: randomUUID(),
      userMessage: randomUUID(),
      assistantMessage: randomUUID(),
      requirement: randomUUID(),
      rootTask: randomUUID(),
      repairTask: randomUUID()
    };
    const userId = "00000000-0000-4000-8000-000000000001";
    const turnIdempotencyKey = randomUUID();
    const now = new Date().toISOString();
    const state = {
      activeProductAssetIds: [],
      editBaseAssetId: null,
      referenceAssetIds: [],
      selectedResultAssetIds: [],
      rejectedResultAssetIds: [],
      currentRequirement: null,
      unresolvedQuestions: [],
      fieldSources: {}
    };
    const request: ResolveRequirementRequest = {
      projectId: ids.project,
      modelId: "openai-image",
      userText: "生成白底商品图",
      imageSettings: { imageCount: 1, aspectRatio: "1:1" },
      renderSettings: { resolutionPreset: "2k", providerQuality: "high" },
      deliverySettings: {
        outputFormat: "png",
        watermark: { enabled: false, assetId: null, position: "bottom_right" }
      },
      agentInstruction: "",
      productImageIds: [],
      referenceImageIds: [],
      editBaseImageId: null,
      referenceGuidance: []
    };
    const result: RequirementResult = {
      schemaVersion: "1.0",
      status: "ready",
      finalRequirement: {
        imageCount: 1,
        aspectRatio: "1:1",
        intent: "生成白底商品图",
        scene: null,
        background: "白色",
        composition: "居中",
        lighting: "柔光",
        style: "真实摄影",
        mustKeep: [],
        mustAvoid: [],
        additionalRequirements: [
          {
            key: "atmosphere",
            label: "氛围",
            instruction: "清爽明亮",
            value: { tone: "fresh", intensity: 0.8 }
          }
        ],
        subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
      },
      conflictDecisions: []
    };

    try {
      await connection.db.insert(projects).values({
        id: ids.project,
        ownerUserId: userId,
        name: "会话隔离测试",
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      await connection.db.insert(agents).values([
        {
          id: ids.agentA,
          ownerUserId: userId,
          name: "会话隔离测试 Agent A",
          type: "image",
          mode: "intelligent"
        },
        {
          id: ids.agentB,
          ownerUserId: userId,
          name: "会话隔离测试 Agent B",
          type: "image",
          mode: "intelligent"
        }
      ]);
      const repository = new DrizzleConversationRepository(connection);
      await repository.createSession({
        id: ids.sessionA,
        snapshotId: ids.initialSnapshotA,
        userId,
        projectId: ids.project,
        agentId: ids.agentA,
        title: "会话A",
        state,
        createdAt: now
      });
      await repository.createSession({
        id: ids.sessionB,
        snapshotId: ids.initialSnapshotB,
        userId,
        projectId: ids.project,
        agentId: ids.agentB,
        title: "会话B",
        state,
        createdAt: now
      });
      const started = await repository.startTurn({
        sessionId: ids.sessionA,
        userId,
        expectedVersion: 0,
        messageId: ids.userMessage,
        idempotencyKey: turnIdempotencyKey,
        content: request.userText,
        assets: [],
        request: toConversationTurnRequest(request, 0, turnIdempotencyKey)
      });
      if (started.status !== "started") throw new Error("无法开始测试轮次");
      const initialLease = await claimLease(repository, ids.userMessage);
      await expect(
        repository.failTurn({
          sessionId: ids.sessionA,
          userId,
          messageId: ids.userMessage,
          leaseToken: randomUUID(),
          errorCode: "WRONG_LEASE",
          errorMessage: "wrong lease"
        })
      ).resolves.toBe(false);
      await expect(repository.findSession(ids.sessionA, userId)).resolves.toMatchObject({
        processingMessageId: ids.userMessage
      });
      await repository.failTurn({
        sessionId: ids.sessionA,
        userId,
        messageId: ids.userMessage,
        leaseToken: initialLease,
        errorCode: "TEST_RETRYABLE_FAILURE",
        errorMessage: "temporary failure"
      });
      const resumed = await repository.startTurn({
        sessionId: ids.sessionA,
        userId,
        expectedVersion: 0,
        messageId: randomUUID(),
        idempotencyKey: turnIdempotencyKey,
        content: request.userText,
        assets: [],
        request: toConversationTurnRequest(request, 0, turnIdempotencyKey)
      });
      expect(resumed).toMatchObject({
        status: "started",
        message: { id: ids.userMessage, status: "processing" }
      });
      const resumedLease = await claimLease(repository, ids.userMessage);
      await repository.completeTurn({
        sessionId: ids.sessionA,
        userId,
        sourceMessageId: ids.userMessage,
        leaseToken: resumedLease,
        assistantMessageId: ids.assistantMessage,
        assistantContent: "需求已整理",
        snapshotId: ids.nextSnapshot,
        baseVersion: 0,
        turnNumber: 1,
        state: { ...state, currentRequirement: result.finalRequirement },
        memoryContent: "生成白底商品图\n需求已整理",
        requirementRun: {
          id: ids.requirement,
          request,
          result,
          aiModel: "integration-test",
          promptVersion: "integration-test"
        }
      });

      await expect(
        repository.listMessagesForTurns(ids.sessionA, userId, [1])
      ).resolves.toHaveLength(2);
      await expect(repository.listMessagesForTurns(ids.sessionB, userId, [1])).resolves.toEqual([]);
      await expect(repository.findLatestSnapshot(ids.sessionA, userId)).resolves.toMatchObject({
        version: 1,
        throughTurn: 1,
        state: { currentRequirement: result.finalRequirement }
      });
      await expect(
        repository.findSession(ids.sessionA, "00000000-0000-4000-8000-000000000099")
      ).resolves.toBeUndefined();

      const staleMessageId = randomUUID();
      const staleIdempotencyKey = randomUUID();
      const failedTurn = await repository.startTurn({
        sessionId: ids.sessionA,
        userId,
        expectedVersion: 1,
        messageId: staleMessageId,
        idempotencyKey: staleIdempotencyKey,
        content: "这条消息先失败",
        assets: [],
        request: toConversationTurnRequest(request, 1, staleIdempotencyKey, "这条消息先失败")
      });
      expect(failedTurn.status).toBe("started");
      const failedLease = await claimLease(repository, staleMessageId);
      await repository.failTurn({
        sessionId: ids.sessionA,
        userId,
        messageId: staleMessageId,
        leaseToken: failedLease,
        errorCode: "TEST_FAILURE",
        errorMessage: "temporary failure"
      });
      await expect(
        repository.restartFailedTurn({
          sessionId: ids.sessionA,
          userId,
          messageId: staleMessageId
        })
      ).resolves.toMatchObject({
        status: "started",
        message: { id: staleMessageId, status: "processing" }
      });
      const retriedLease = await claimLease(repository, staleMessageId);
      await repository.failTurn({
        sessionId: ids.sessionA,
        userId,
        messageId: staleMessageId,
        leaseToken: retriedLease,
        errorCode: "TEST_FAILURE",
        errorMessage: "temporary failure"
      });
      const replacementMessageId = randomUUID();
      const replacement = await repository.startTurn({
        sessionId: ids.sessionA,
        userId,
        expectedVersion: 1,
        messageId: replacementMessageId,
        idempotencyKey: randomUUID(),
        content: "同一轮的新请求",
        assets: [],
        request: toConversationTurnRequest(request, 1, randomUUID(), "同一轮的新请求")
      });
      if (replacement.status !== "started") throw new Error("无法开始替代轮次");
      const replacementLease = await claimLease(repository, replacementMessageId);
      await repository.completeTurn({
        sessionId: ids.sessionA,
        userId,
        sourceMessageId: replacementMessageId,
        leaseToken: replacementLease,
        assistantMessageId: randomUUID(),
        assistantContent: "替代请求已完成",
        snapshotId: randomUUID(),
        baseVersion: 1,
        turnNumber: 2,
        state,
        memoryContent: "同一轮的新请求\n替代请求已完成",
        requirementRun: null
      });
      await expect(
        repository.startTurn({
          sessionId: ids.sessionA,
          userId,
          expectedVersion: 2,
          messageId: randomUUID(),
          idempotencyKey: staleIdempotencyKey,
          content: "这条消息先失败",
          assets: [],
          request: toConversationTurnRequest(request, 2, staleIdempotencyKey, "这条消息先失败")
        })
      ).resolves.toEqual({ status: "idempotency_conflict" });

      const taskRepository = new DrizzleImageGenerationTaskRepository(connection);
      const rootCreatedAt = new Date(now);
      const repairCreatedAt = new Date(rootCreatedAt.getTime() + 1_000);
      await connection.db.insert(creationRuns).values({
        id: ids.rootTask,
        userId,
        projectId: ids.project,
        sessionId: ids.sessionA,
        requirementRunId: ids.requirement,
        status: "terminal",
        createdAt: rootCreatedAt,
        updatedAt: rootCreatedAt
      });
      await connection.db.insert(generationTasks).values([
        {
          id: ids.rootTask,
          creationRunId: ids.rootTask,
          userId,
          projectId: ids.project,
          requirementRunId: ids.requirement,
          sessionId: ids.sessionA,
          idempotencyKey: randomUUID(),
          kind: "image",
          modelId: "openai-image",
          instruction: "根任务",
          instructionVersion: "integration-test",
          status: "succeeded",
          createdAt: rootCreatedAt,
          updatedAt: rootCreatedAt
        },
        {
          id: ids.repairTask,
          creationRunId: ids.rootTask,
          userId,
          projectId: ids.project,
          requirementRunId: ids.requirement,
          sessionId: ids.sessionA,
          idempotencyKey: randomUUID(),
          kind: "image",
          modelId: "openai-image",
          instruction: "质检修复任务",
          instructionVersion: "integration-test",
          status: "succeeded",
          createdAt: repairCreatedAt,
          updatedAt: repairCreatedAt
        }
      ]);
      await expect(
        taskRepository.findBySessionId(ids.sessionA, userId, [ids.requirement])
      ).resolves.toMatchObject([{ taskId: ids.repairTask }, { taskId: ids.rootTask }]);
      await connection.db
        .update(generationTasks)
        .set({ status: "running", updatedAt: repairCreatedAt })
        .where(eq(generationTasks.id, ids.repairTask));
      await connection.db
        .update(creationRuns)
        .set({ status: "running", updatedAt: repairCreatedAt })
        .where(eq(creationRuns.id, ids.rootTask));
      await expect(
        taskRepository.findActiveBySessionId(ids.sessionA, userId)
      ).resolves.toMatchObject({
        taskId: ids.repairTask
      });
    } finally {
      await connection.db
        .delete(generationTasks)
        .where(inArray(generationTasks.id, [ids.rootTask, ids.repairTask]));
      await connection.db.delete(creationRuns).where(eq(creationRuns.id, ids.rootTask));
      await connection.db.delete(requirementRuns).where(eq(requirementRuns.id, ids.requirement));
      await connection.db
        .delete(conversationSessions)
        .where(eq(conversationSessions.projectId, ids.project));
      await connection.db.delete(agents).where(inArray(agents.id, [ids.agentA, ids.agentB]));
      await connection.db.delete(projects).where(eq(projects.id, ids.project));
      await connection.close();
    }
  });

  it("ensures exactly one persistent session per user and Agent", async () => {
    const connection = createDatabase(await databaseTestUrl());
    const ids = {
      project: randomUUID(),
      agentA: randomUUID(),
      agentB: randomUUID(),
      sessionA: randomUUID(),
      duplicateSessionA: randomUUID(),
      sessionB: randomUUID(),
      snapshotA: randomUUID(),
      duplicateSnapshotA: randomUUID(),
      snapshotB: randomUUID()
    };
    const userId = "00000000-0000-4000-8000-000000000001";
    const now = new Date().toISOString();
    const repository = new DrizzleConversationRepository(connection);

    try {
      await connection.db.insert(projects).values({
        id: ids.project,
        ownerUserId: userId,
        name: "Agent 会话隔离测试",
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      await connection.db.insert(agents).values([
        {
          id: ids.agentA,
          ownerUserId: userId,
          name: "Agent A",
          type: "image",
          mode: "intelligent"
        },
        {
          id: ids.agentB,
          ownerUserId: userId,
          name: "Agent B",
          type: "image",
          mode: "intelligent"
        }
      ]);
      const [firstA, repeatedA] = await Promise.all([
        repository.ensureSession({
          id: ids.sessionA,
          snapshotId: ids.snapshotA,
          userId,
          projectId: ids.project,
          agentId: ids.agentA,
          title: "A 的会话",
          state: emptyConversationState,
          createdAt: now
        }),
        repository.ensureSession({
          id: ids.duplicateSessionA,
          snapshotId: ids.duplicateSnapshotA,
          userId,
          projectId: ids.project,
          agentId: ids.agentA,
          title: "重复请求不应新建",
          state: emptyConversationState,
          createdAt: now
        })
      ]);
      const sessionB = await repository.ensureSession({
        id: ids.sessionB,
        snapshotId: ids.snapshotB,
        userId,
        projectId: ids.project,
        agentId: ids.agentB,
        title: "B 的会话",
        state: emptyConversationState,
        createdAt: now
      });

      expect(firstA.id).toBe(repeatedA.id);
      expect([ids.sessionA, ids.duplicateSessionA]).toContain(firstA.id);
      expect(sessionB).toMatchObject({ id: ids.sessionB, agentId: ids.agentB });
      await expect(repository.findSessionByAgent(userId, ids.agentA)).resolves.toMatchObject({
        id: firstA.id,
        agentId: ids.agentA
      });
      const storedSessions = await connection.db
        .select({ id: conversationSessions.id, agentId: conversationSessions.agentId })
        .from(conversationSessions)
        .where(eq(conversationSessions.projectId, ids.project));
      expect(storedSessions).toHaveLength(2);
      expect(storedSessions.map((session) => session.agentId).sort()).toEqual(
        [ids.agentA, ids.agentB].sort()
      );
    } finally {
      await connection.db
        .delete(conversationSessions)
        .where(eq(conversationSessions.projectId, ids.project));
      await connection.db.delete(agents).where(inArray(agents.id, [ids.agentA, ids.agentB]));
      await connection.db.delete(projects).where(eq(projects.id, ids.project));
      await connection.close();
    }
  });

  it("restores projects, requirements, assets and queued tasks after reconnecting", async () => {
    const databaseUrl = await databaseTestUrl();

    const ids = {
      project: randomUUID(),
      requirement: randomUUID(),
      sourceAsset: randomUUID(),
      outputAsset: randomUUID(),
      task: randomUUID(),
      unit: randomUUID(),
      check: randomUUID()
    };
    const userId = "00000000-0000-4000-8000-000000000001";
    const now = new Date().toISOString();
    const sourceFileName = `source-${ids.sourceAsset}.png`;
    const outputFileName = `output-${ids.outputAsset}.png`;
    const request: ResolveRequirementRequest = {
      projectId: ids.project,
      modelId: "openai-image",
      userText: "生成一张白底商品图",
      imageSettings: { imageCount: 1, aspectRatio: "1:1" },
      renderSettings: { resolutionPreset: "2k", providerQuality: "high" },
      deliverySettings: {
        outputFormat: "png",
        watermark: { enabled: false, assetId: null, position: "bottom_right" }
      },
      agentInstruction: "",
      productImageIds: [ids.sourceAsset],
      referenceImageIds: [],
      editBaseImageId: null,
      referenceGuidance: []
    };
    const result: RequirementResult = {
      schemaVersion: "1.0",
      status: "ready",
      finalRequirement: {
        imageCount: 1,
        aspectRatio: "1:1",
        intent: "生成一张白底商品图",
        scene: null,
        background: "纯白背景",
        composition: null,
        lighting: null,
        style: null,
        mustKeep: [],
        mustAvoid: [],
        subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
      },
      conflictDecisions: []
    };

    let connection = createDatabase(databaseUrl);
    try {
      const projectRepository = new DrizzleProjectRepository(connection);
      const requirementRepository = new DrizzleRequirementRunRepository(connection);
      const assetRepository = new DrizzleMediaAssetRepository(connection);
      const taskRepository = new DrizzleImageGenerationTaskRepository(connection);

      await projectRepository.save({
        id: ids.project,
        ownerUserId: userId,
        name: "数据库重连测试",
        description: null,
        createdAt: now,
        updatedAt: now
      });
      await assetRepository.save({
        id: ids.sourceAsset,
        userId,
        projectId: ids.project,
        kind: "image",
        origin: "uploaded",
        contentSha256: null,
        storageKey: `test/${ids.sourceAsset}.png`,
        mimeType: "image/png",
        byteSize: 10,
        originalFileName: sourceFileName,
        createdAt: now
      });
      await requirementRepository.save({
        id: ids.requirement,
        parentRequirementRunId: null,
        userId,
        request,
        result,
        aiModel: "integration-test",
        promptVersion: "integration-test",
        createdAt: now
      });
      await assetRepository.save({
        id: ids.outputAsset,
        userId,
        projectId: ids.project,
        kind: "image",
        origin: "generated",
        contentSha256: null,
        storageKey: `test/${ids.outputAsset}.png`,
        mimeType: "image/png",
        byteSize: 20,
        originalFileName: outputFileName,
        createdAt: now
      });
      await taskRepository.createOrFind({
        taskId: ids.task,
        userId,
        requirementRunId: ids.requirement,
        idempotencyKey: randomUUID(),
        projectId: ids.project,
        modelId: "openai-image",
        instruction: "生成一张白底商品图",
        instructionVersion: "integration-test",
        status: "queued",
        resultAssets: [],
        error: null,
        createdAt: now,
        updatedAt: now,
        units: [
          {
            unitId: ids.unit,
            position: 0,
            groupPosition: 0,
            variantPosition: 0,
            outputLayout: "separate_image",
            instruction: "生成一张白底商品图",
            status: "running",
            qualitySourceAssetIds: [ids.sourceAsset],
            subjectEntities: [
              {
                entityKey: "primary_product",
                label: "主商品",
                productEntityId: randomUUID(),
                lineageKind: "new_product_source",
                sourceAssetIds: [ids.sourceAsset]
              }
            ],
            sources: [
              {
                assetId: ids.sourceAsset,
                sourceRole: "product_source",
                usage: "subject_fact",
                position: 0
              }
            ]
          }
        ]
      });
      const firstDispatch = (await taskRepository.claimPendingDispatches(100)).find(
        (dispatch) => dispatch.taskId === ids.task && dispatch.unitId === ids.unit
      );
      expect(firstDispatch).toMatchObject({
        eventType: "generation.unit.enqueue",
        taskId: ids.task,
        unitId: ids.unit
      });
      await taskRepository.markDispatchFailed(firstDispatch!.eventId, "redis unavailable");
      await connection.db
        .update(workflowEvents)
        .set({ availableAt: new Date(0) })
        .where(eq(workflowEvents.id, firstDispatch!.eventId));
      const retriedDispatch = (await taskRepository.claimPendingDispatches(100)).find(
        (dispatch) => dispatch.taskId === ids.task && dispatch.unitId === ids.unit
      );
      expect(retriedDispatch).toEqual(firstDispatch);
      await connection.db
        .update(workflowEvents)
        .set({ availableAt: new Date(0) })
        .where(eq(workflowEvents.id, retriedDispatch!.eventId));
      const recoveredAfterPublishCrash = (await taskRepository.claimPendingDispatches(100)).find(
        (dispatch) => dispatch.taskId === ids.task && dispatch.unitId === ids.unit
      );
      expect(recoveredAfterPublishCrash).toEqual(firstDispatch);
      await taskRepository.markDispatchPublished(recoveredAfterPublishCrash!.eventId);
      await connection.close();
      connection = createDatabase(databaseUrl);

      const reconnectedProjects = new DrizzleProjectRepository(connection);
      const reconnectedRequirements = new DrizzleRequirementRunRepository(connection);
      const reconnectedAssets = new DrizzleMediaAssetRepository(connection);
      const reconnectedTasks = new DrizzleImageGenerationTaskRepository(connection);

      expect(await reconnectedProjects.findById(ids.project)).toMatchObject({
        id: ids.project,
        ownerUserId: userId
      });
      expect(await reconnectedRequirements.findById(ids.requirement)).toMatchObject({
        request,
        result
      });
      expect(await reconnectedAssets.findById(ids.sourceAsset)).toMatchObject({
        storageKey: `test/${ids.sourceAsset}.png`
      });
      expect(await reconnectedTasks.findById(ids.task)).toMatchObject({
        status: "queued",
        resultAssets: [],
        units: [
          {
            unitId: ids.unit,
            qualitySourceAssetIds: [ids.sourceAsset],
            subjectEntities: [
              {
                entityKey: "primary_product",
                label: "主商品",
                sourceAssetIds: [ids.sourceAsset]
              }
            ]
          }
        ]
      });
      const qualityStartedAt = new Date();
      await connection.db
        .update(generationTasks)
        .set({ status: "succeeded", updatedAt: qualityStartedAt })
        .where(eq(generationTasks.id, ids.task));
      await connection.db
        .update(generationTaskUnits)
        .set({ status: "succeeded", updatedAt: qualityStartedAt })
        .where(eq(generationTaskUnits.id, ids.unit));
      await connection.db
        .update(creationRuns)
        .set({ status: "running", updatedAt: qualityStartedAt })
        .where(eq(creationRuns.id, ids.task));
      await connection.db.insert(generationTaskOutputs).values({
        taskId: ids.task,
        assetId: ids.outputAsset,
        unitId: ids.unit,
        position: 0,
        status: "candidate"
      });
      await expect(
        reconnectedAssets.listByOwner(userId, {
          keyword: ids.outputAsset,
          source: "generated",
          sort: "newest",
          page: 1,
          pageSize: 20
        })
      ).resolves.toEqual({ total: 0, items: [] });
      await connection.db
        .update(generationTaskOutputs)
        .set({ status: "deliverable", deliverableAssetId: ids.outputAsset })
        .where(eq(generationTaskOutputs.taskId, ids.task));
      await expect(
        reconnectedAssets.listByOwner(userId, {
          keyword: ids.outputAsset,
          source: "generated",
          sort: "newest",
          page: 1,
          pageSize: 20
        })
      ).resolves.toMatchObject({
        total: 1,
        items: [{ id: ids.outputAsset, name: outputFileName, source: "generated" }]
      });
      await expect(
        reconnectedAssets.listByOwner(userId, {
          keyword: ids.sourceAsset,
          source: "uploaded",
          sort: "oldest",
          page: 1,
          pageSize: 20
        })
      ).resolves.toMatchObject({
        total: 1,
        items: [{ id: ids.sourceAsset, source: "uploaded" }]
      });
      await connection.db.insert(subjectConsistencyChecks).values({
        id: ids.check,
        userId,
        projectId: ids.project,
        generationTaskId: ids.task,
        generationUnitId: ids.unit,
        requirementRunId: ids.requirement,
        generatedAssetId: ids.outputAsset,
        status: "running",
        phase: "initial_inspection",
        inspectionModel: "integration-test",
        requirementModel: "integration-test",
        workflowVersion: "integration-test",
        createdAt: qualityStartedAt,
        updatedAt: qualityStartedAt
      });
      await connection.db.insert(subjectConsistencyCheckSources).values({
        checkId: ids.check,
        assetId: ids.sourceAsset,
        position: 0
      });
      await expect(reconnectedTasks.cancel(ids.task, userId)).resolves.toMatchObject({
        cancelled: true,
        unitIds: [ids.unit]
      });
      expect(await reconnectedTasks.findById(ids.task)).toMatchObject({
        status: "succeeded",
        lifecycleStatus: "cancelled",
        units: [
          {
            unitId: ids.unit,
            status: "succeeded",
            subjectConsistencyStatus: "cancelled"
          }
        ]
      });
    } finally {
      await connection.db
        .delete(generationTaskOutputs)
        .where(eq(generationTaskOutputs.taskId, ids.task));
      await connection.db.delete(generationTasks).where(eq(generationTasks.id, ids.task));
      await connection.db.delete(creationRuns).where(eq(creationRuns.id, ids.task));
      await connection.db.delete(requirementRuns).where(eq(requirementRuns.id, ids.requirement));
      await connection.db.delete(productEntities).where(eq(productEntities.projectId, ids.project));
      await connection.db.delete(mediaAssets).where(eq(mediaAssets.projectId, ids.project));
      await connection.db.delete(projects).where(eq(projects.id, ids.project));
      await connection.close();
    }
  });

  it("reads mixed conversation image attachments without exposing non-deliverable outputs", async () => {
    const connection = createDatabase(await databaseTestUrl());
    const ids = {
      project: randomUUID(),
      agent: randomUUID(),
      session: randomUUID(),
      snapshot: randomUUID(),
      message: randomUUID(),
      requirement: randomUUID(),
      task: randomUUID(),
      uploaded: randomUUID(),
      deliverable: randomUUID(),
      candidate: randomUUID(),
      rejected: randomUUID(),
      superseded: randomUUID()
    };
    const userId = randomUUID();
    const now = new Date().toISOString();
    const repository = new DrizzleConversationRepository(connection);
    const generatedAssetIds = [ids.deliverable, ids.candidate, ids.rejected, ids.superseded];

    try {
      await connection.db.insert(projects).values({
        id: ids.project,
        ownerUserId: userId,
        name: "会话附件资格测试",
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      await connection.db.insert(agents).values({
        id: ids.agent,
        ownerUserId: userId,
        name: "会话附件资格测试 Agent",
        type: "image",
        mode: "intelligent"
      });
      await repository.createSession({
        id: ids.session,
        snapshotId: ids.snapshot,
        userId,
        projectId: ids.project,
        agentId: ids.agent,
        title: "混合附件",
        state: emptyConversationState,
        createdAt: now
      });
      await connection.db.insert(mediaAssets).values(
        [ids.uploaded, ...generatedAssetIds].map((id) => ({
          id,
          userId,
          projectId: ids.project,
          kind: "image" as const,
          origin: id === ids.uploaded ? ("uploaded" as const) : ("generated" as const),
          contentSha256: null,
          storageKey: `integration/${ids.project}/${id}.png`,
          mimeType: "image/png",
          byteSize: 128,
          originalFileName: `${id}.png`,
          createdAt: new Date(now)
        }))
      );
      await connection.db.insert(requirementRuns).values({
        id: ids.requirement,
        userId,
        projectId: ids.project,
        request: {},
        result: {},
        aiModel: "integration-test",
        promptVersion: "integration-test",
        createdAt: new Date(now)
      });
      await connection.db.insert(creationRuns).values({
        id: ids.task,
        userId,
        projectId: ids.project,
        requirementRunId: ids.requirement,
        status: "terminal",
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      await connection.db.insert(generationTasks).values({
        id: ids.task,
        creationRunId: ids.task,
        userId,
        projectId: ids.project,
        requirementRunId: ids.requirement,
        idempotencyKey: randomUUID(),
        kind: "image",
        modelId: "integration-test",
        instruction: "混合附件资格测试",
        instructionVersion: "integration-test",
        status: "succeeded",
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      const unitIds = generatedAssetIds.map(() => randomUUID());
      await connection.db.insert(generationTaskUnits).values(
        unitIds.map((id, position) => ({
          id,
          taskId: ids.task,
          position,
          groupPosition: position,
          variantPosition: 0,
          outputLayout: "separate_image",
          status: "succeeded" as const,
          createdAt: new Date(now),
          updatedAt: new Date(now)
        }))
      );
      await connection.db.insert(generationTaskOutputs).values([
        {
          taskId: ids.task,
          unitId: unitIds[0],
          assetId: ids.deliverable,
          position: 0,
          status: "deliverable",
          deliverableAssetId: ids.deliverable
        },
        {
          taskId: ids.task,
          unitId: unitIds[1],
          assetId: ids.candidate,
          position: 1,
          status: "candidate"
        },
        {
          taskId: ids.task,
          unitId: unitIds[2],
          assetId: ids.rejected,
          position: 2,
          status: "rejected"
        },
        {
          taskId: ids.task,
          unitId: unitIds[3],
          assetId: ids.superseded,
          position: 3,
          status: "superseded",
          supersededByAssetId: ids.deliverable
        }
      ]);
      const idempotencyKey = randomUUID();
      const started = await repository.startTurn({
        sessionId: ids.session,
        userId,
        expectedVersion: 0,
        messageId: ids.message,
        idempotencyKey,
        content: "使用这些图片生成商品图",
        assets: [ids.uploaded, ...generatedAssetIds].map((assetId, position) => ({
          assetId,
          role: position === 0 ? "product_source" : "generated_result",
          position,
          relation: null
        })),
        request: toConversationTurnRequest(
          {
            projectId: ids.project,
            modelId: "openai-image",
            userText: "使用这些图片生成商品图",
            imageSettings: { imageCount: 1, aspectRatio: "1:1" },
            renderSettings: { resolutionPreset: "2k", providerQuality: "high" },
            deliverySettings: {
              outputFormat: "png",
              watermark: { enabled: false, assetId: null, position: "bottom_right" }
            },
            agentInstruction: "",
            productImageIds: [ids.uploaded],
            referenceImageIds: [],
            editBaseImageId: null,
            referenceGuidance: []
          },
          0,
          idempotencyKey
        )
      });
      expect(started.status).toBe("started");

      await expect(
        repository.listContextMessages(ids.session, userId, {
          currentMessageId: ids.message,
          recentCompletedTurnCount: 20
        })
      ).resolves.toMatchObject([
        {
          id: ids.message,
          assets: [
            { assetId: ids.uploaded, role: "product_source", position: 0 },
            { assetId: ids.deliverable, role: "generated_result", position: 1 }
          ]
        }
      ]);
      await expect(
        repository.listMessagePage(ids.session, userId, { limit: 20 })
      ).resolves.toMatchObject({
        messages: [
          {
            id: ids.message,
            assets: [{ assetId: ids.uploaded }, { assetId: ids.deliverable }]
          }
        ]
      });
    } finally {
      await connection.db
        .delete(conversationSessions)
        .where(eq(conversationSessions.id, ids.session));
      await connection.db.delete(generationTasks).where(eq(generationTasks.id, ids.task));
      await connection.db.delete(creationRuns).where(eq(creationRuns.id, ids.task));
      await connection.db.delete(requirementRuns).where(eq(requirementRuns.id, ids.requirement));
      await connection.db.delete(mediaAssets).where(eq(mediaAssets.projectId, ids.project));
      await connection.db.delete(agents).where(eq(agents.id, ids.agent));
      await connection.db.delete(projects).where(eq(projects.id, ids.project));
      await connection.close();
    }
  });

  it("recovers expired conversation leases and fences stale workers at the retry limit", async () => {
    const connection = createDatabase(await databaseTestUrl());
    const ids = {
      project: randomUUID(),
      agent: randomUUID(),
      session: randomUUID(),
      snapshot: randomUUID(),
      message: randomUUID()
    };
    const userId = randomUUID();
    const now = new Date().toISOString();
    const repository = new DrizzleConversationRepository(connection);
    const request: ResolveRequirementRequest = {
      projectId: ids.project,
      modelId: "openai-image",
      userText: "生成一张商品图",
      imageSettings: { imageCount: 1, aspectRatio: "1:1" },
      renderSettings: { resolutionPreset: "2k", providerQuality: "high" },
      deliverySettings: {
        outputFormat: "png",
        watermark: { enabled: false, assetId: null, position: "bottom_right" }
      },
      agentInstruction: "",
      productImageIds: [],
      referenceImageIds: [],
      editBaseImageId: null,
      referenceGuidance: []
    };

    try {
      await connection.db.insert(projects).values({
        id: ids.project,
        ownerUserId: userId,
        name: "会话租约测试",
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      await connection.db.insert(agents).values({
        id: ids.agent,
        ownerUserId: userId,
        name: "会话租约测试 Agent",
        type: "image",
        mode: "intelligent"
      });
      await repository.createSession({
        id: ids.session,
        snapshotId: ids.snapshot,
        userId,
        projectId: ids.project,
        agentId: ids.agent,
        title: "租约恢复",
        state: emptyConversationState,
        createdAt: now
      });
      const idempotencyKey = randomUUID();
      await repository.startTurn({
        sessionId: ids.session,
        userId,
        expectedVersion: 0,
        messageId: ids.message,
        idempotencyKey,
        content: request.userText,
        assets: [],
        request: toConversationTurnRequest(request, 0, idempotencyKey)
      });

      const first = await repository.claimTurnRun(ids.message, {
        leaseExpiresAt: new Date(Date.now() - 1_000).toISOString()
      });
      expect(first).toBeDefined();
      await expect(
        repository.renewTurnLease({
          messageId: ids.message,
          leaseToken: first!.leaseToken,
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString()
        })
      ).resolves.toBe(false);
      await expect(
        repository.failTurn({
          sessionId: ids.session,
          userId,
          messageId: ids.message,
          leaseToken: first!.leaseToken,
          errorCode: "STALE_WORKER",
          errorMessage: "旧 Worker 不得写入"
        })
      ).resolves.toBe(false);
      await expect(
        repository.completeTurn({
          sessionId: ids.session,
          userId,
          sourceMessageId: ids.message,
          leaseToken: first!.leaseToken,
          assistantMessageId: randomUUID(),
          assistantContent: "旧 Worker 的结果",
          snapshotId: randomUUID(),
          baseVersion: 0,
          turnNumber: 1,
          state: emptyConversationState,
          memoryContent: "旧 Worker 的结果",
          requirementRun: null
        })
      ).rejects.toThrow("会话任务租约已经失效");

      const firstRecovery = await repository.findDispatchableTurnMessageIds({
        now: new Date().toISOString(),
        maxAttempts: 2,
        limit: 100
      });
      expect(firstRecovery).toContain(ids.message);
      const second = await repository.claimTurnRun(ids.message, {
        leaseExpiresAt: new Date(Date.now() - 1_000).toISOString()
      });
      expect(second?.leaseToken).not.toBe(first!.leaseToken);
      const afterRetryLimit = await repository.findDispatchableTurnMessageIds({
        now: new Date().toISOString(),
        maxAttempts: 2,
        limit: 100
      });
      expect(afterRetryLimit).not.toContain(ids.message);
      await expect(
        repository.renewTurnLease({
          messageId: ids.message,
          leaseToken: second!.leaseToken,
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString()
        })
      ).resolves.toBe(false);
      await expect(
        repository.failTurn({
          sessionId: ids.session,
          userId,
          messageId: ids.message,
          leaseToken: second!.leaseToken,
          errorCode: "STALE_WORKER",
          errorMessage: "达到上限后不得覆盖失败状态"
        })
      ).resolves.toBe(false);

      const [message, run] = await Promise.all([
        connection.db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.id, ids.message)),
        connection.db
          .select()
          .from(conversationTurnRuns)
          .where(eq(conversationTurnRuns.messageId, ids.message))
      ]);
      expect(message[0]).toMatchObject({
        status: "failed",
        errorCode: "CONVERSATION_TURN_INTERRUPTED"
      });
      expect(run[0]).toMatchObject({
        status: "failed",
        attemptCount: 2,
        leaseToken: null,
        leaseExpiresAt: null
      });
      await expect(repository.findSession(ids.session, userId)).resolves.toMatchObject({
        processingMessageId: null,
        version: 0
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

async function claimLease(repository: DrizzleConversationRepository, messageId: string) {
  const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const [first, second] = await Promise.all([
    repository.claimTurnRun(messageId, { leaseExpiresAt }),
    repository.claimTurnRun(messageId, { leaseExpiresAt })
  ]);
  const claimed = [first, second].filter((run) => run !== undefined);
  expect(claimed).toHaveLength(1);
  return claimed[0]!.leaseToken;
}

function toConversationTurnRequest(
  request: ResolveRequirementRequest,
  expectedVersion: number,
  idempotencyKey: string,
  text = request.userText
) {
  return {
    expectedVersion,
    idempotencyKey,
    modelId: request.modelId,
    text,
    imageSettings: request.imageSettings,
    renderSettings: request.renderSettings,
    deliverySettings: request.deliverySettings,
    agentInstruction: request.agentInstruction,
    clearProductImage: false,
    clearReferenceImages: false,
    attachments: []
  };
}
