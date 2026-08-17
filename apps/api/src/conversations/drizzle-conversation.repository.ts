import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, inArray, lt, lte, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import {
  conversationMemoryEntries,
  conversationMessageAssets,
  conversationMessages,
  conversationSessions,
  conversationStateSnapshots,
  conversationTurnRuns,
  generationStartRequests,
  generationTaskOutputs,
  mediaAssets,
  promptOptimizations,
  requirementRuns,
  type DatabaseConnection
} from "@chaoren/database";
import {
  createConversationMessageRequestSchema,
  promptOptimizationInputRevisionSchema,
  requirementResultSchema,
  conversationStateSchema,
  type ConversationMessage,
  type ConversationMessageAsset,
  type ConversationStateSnapshot
} from "@chaoren/contracts";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import { assetIsProductAvailable } from "../media-assets/media-asset-eligibility.js";
import { parsePersistedConversationState } from "./persisted-conversation-state.js";
import type {
  CompleteConversationTurnInput,
  ConversationMemoryEntryRecord,
  ConversationRepository,
  ConversationSessionRecord,
  RestartConversationTurnResult,
  StartConversationTurnInput,
  StartConversationTurnResult
} from "./conversation.repository.js";

@Injectable()
export class DrizzleConversationRepository implements ConversationRepository {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async createSession(input: {
    id: string;
    snapshotId: string;
    userId: string;
    projectId: string;
    agentId: string;
    title: string;
    state: ReturnType<typeof conversationStateSchema.parse>;
    createdAt: string;
  }): Promise<ConversationSessionRecord> {
    return this.connection.db.transaction(async (tx) => {
      const [session] = await tx
        .insert(conversationSessions)
        .values({
          id: input.id,
          userId: input.userId,
          projectId: input.projectId,
          agentId: input.agentId,
          title: input.title,
          mode: "image",
          status: "active",
          version: 0,
          createdAt: new Date(input.createdAt),
          updatedAt: new Date(input.createdAt)
        })
        .returning();
      if (!session) throw new Error("创建会话失败");
      await tx.insert(conversationStateSnapshots).values({
        id: input.snapshotId,
        sessionId: input.id,
        sourceMessageId: null,
        throughTurn: 0,
        version: 0,
        state: input.state,
        createdAt: new Date(input.createdAt)
      });
      return toSessionRecord(session);
    });
  }

  public async ensureSession(input: {
    id: string;
    snapshotId: string;
    userId: string;
    projectId: string;
    agentId: string;
    title: string;
    state: ReturnType<typeof conversationStateSchema.parse>;
    createdAt: string;
  }): Promise<ConversationSessionRecord> {
    return this.connection.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${input.userId}:${input.agentId}`}))`
      );
      const [existing] = await tx
        .select()
        .from(conversationSessions)
        .where(
          and(
            eq(conversationSessions.userId, input.userId),
            eq(conversationSessions.agentId, input.agentId)
          )
        )
        .limit(1);
      if (existing) return toSessionRecord(existing);

      const [session] = await tx
        .insert(conversationSessions)
        .values({
          id: input.id,
          userId: input.userId,
          projectId: input.projectId,
          agentId: input.agentId,
          title: input.title,
          mode: "image",
          status: "active",
          version: 0,
          createdAt: new Date(input.createdAt),
          updatedAt: new Date(input.createdAt)
        })
        .returning();
      if (!session) throw new Error("创建会话失败");
      await tx.insert(conversationStateSnapshots).values({
        id: input.snapshotId,
        sessionId: input.id,
        sourceMessageId: null,
        throughTurn: 0,
        version: 0,
        state: input.state,
        createdAt: new Date(input.createdAt)
      });
      return toSessionRecord(session);
    });
  }

  public async findSessionByAgent(
    userId: string,
    agentId: string
  ): Promise<ConversationSessionRecord | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(conversationSessions)
      .where(
        and(eq(conversationSessions.userId, userId), eq(conversationSessions.agentId, agentId))
      )
      .limit(1);
    return row ? toSessionRecord(row) : undefined;
  }

  public async findSession(
    sessionId: string,
    userId: string
  ): Promise<ConversationSessionRecord | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(conversationSessions)
      .where(and(eq(conversationSessions.id, sessionId), eq(conversationSessions.userId, userId)))
      .limit(1);
    return row ? toSessionRecord(row) : undefined;
  }

  public async findLatestSnapshot(
    sessionId: string,
    userId: string
  ): Promise<ConversationStateSnapshot | undefined> {
    const [row] = await this.connection.db
      .select({ snapshot: conversationStateSnapshots })
      .from(conversationStateSnapshots)
      .innerJoin(
        conversationSessions,
        eq(conversationSessions.id, conversationStateSnapshots.sessionId)
      )
      .where(
        and(
          eq(conversationStateSnapshots.sessionId, sessionId),
          eq(conversationSessions.userId, userId)
        )
      )
      .orderBy(desc(conversationStateSnapshots.version))
      .limit(1);
    return row ? toSnapshot(row.snapshot) : undefined;
  }

  public async findSnapshot(
    snapshotId: string,
    sessionId: string,
    userId: string
  ): Promise<ConversationStateSnapshot | undefined> {
    const [row] = await this.connection.db
      .select({ snapshot: conversationStateSnapshots })
      .from(conversationStateSnapshots)
      .innerJoin(
        conversationSessions,
        eq(conversationSessions.id, conversationStateSnapshots.sessionId)
      )
      .where(
        and(
          eq(conversationStateSnapshots.id, snapshotId),
          eq(conversationStateSnapshots.sessionId, sessionId),
          eq(conversationSessions.userId, userId)
        )
      )
      .limit(1);
    return row ? toSnapshot(row.snapshot) : undefined;
  }

  public async listContextMessages(
    sessionId: string,
    userId: string,
    input: { currentMessageId: string; recentCompletedTurnCount: number }
  ): Promise<ConversationMessage[]> {
    const [completedTurnRows, [currentTurnRow]] = await Promise.all([
      this.connection.db
        .selectDistinct({ turnNumber: conversationMessages.turnNumber })
        .from(conversationMessages)
        .innerJoin(
          conversationSessions,
          eq(conversationSessions.id, conversationMessages.sessionId)
        )
        .where(
          and(
            eq(conversationMessages.sessionId, sessionId),
            eq(conversationSessions.userId, userId),
            eq(conversationMessages.status, "completed")
          )
        )
        .orderBy(desc(conversationMessages.turnNumber))
        .limit(input.recentCompletedTurnCount),
      this.connection.db
        .select({ turnNumber: conversationMessages.turnNumber })
        .from(conversationMessages)
        .innerJoin(
          conversationSessions,
          eq(conversationSessions.id, conversationMessages.sessionId)
        )
        .where(
          and(
            eq(conversationMessages.sessionId, sessionId),
            eq(conversationSessions.userId, userId),
            eq(conversationMessages.id, input.currentMessageId)
          )
        )
        .limit(1)
    ]);
    const turnNumbers = [
      ...new Set([
        ...completedTurnRows.map((row) => row.turnNumber),
        ...(currentTurnRow ? [currentTurnRow.turnNumber] : [])
      ])
    ];
    return this.listMessagesForTurns(sessionId, userId, turnNumbers);
  }

  public async listMessagesForTurns(
    sessionId: string,
    userId: string,
    turnNumbers: number[]
  ): Promise<ConversationMessage[]> {
    if (turnNumbers.length === 0) return [];
    const rows = await this.connection.db
      .select({ message: conversationMessages })
      .from(conversationMessages)
      .innerJoin(conversationSessions, eq(conversationSessions.id, conversationMessages.sessionId))
      .where(
        and(
          eq(conversationMessages.sessionId, sessionId),
          eq(conversationSessions.userId, userId),
          inArray(conversationMessages.turnNumber, [...new Set(turnNumbers)])
        )
      )
      .orderBy(asc(conversationMessages.turnNumber), asc(conversationMessages.createdAt));
    const assets = await this.listAssets(rows.map((row) => row.message.id));
    return rows.map((row) => toMessage(row.message, assets.get(row.message.id) ?? []));
  }

  public async listMessagePage(
    sessionId: string,
    userId: string,
    input: { beforeTurn?: number; limit: number }
  ) {
    const conditions = [
      eq(conversationMessages.sessionId, sessionId),
      eq(conversationSessions.userId, userId)
    ];
    if (input.beforeTurn !== undefined) {
      conditions.push(lt(conversationMessages.turnNumber, input.beforeTurn));
    }
    const turnRows = await this.connection.db
      .selectDistinct({ turnNumber: conversationMessages.turnNumber })
      .from(conversationMessages)
      .innerJoin(conversationSessions, eq(conversationSessions.id, conversationMessages.sessionId))
      .where(and(...conditions))
      .orderBy(desc(conversationMessages.turnNumber))
      .limit(input.limit + 1);
    const selectedTurns = turnRows.slice(0, input.limit).map((row) => row.turnNumber);
    if (selectedTurns.length === 0) {
      return {
        messages: [],
        pageInfo: {
          limit: input.limit,
          oldestTurn: null,
          newestTurn: null,
          hasMore: false,
          nextBeforeTurn: null
        }
      };
    }

    const rows = await this.connection.db
      .select({ message: conversationMessages })
      .from(conversationMessages)
      .innerJoin(conversationSessions, eq(conversationSessions.id, conversationMessages.sessionId))
      .where(
        and(
          eq(conversationMessages.sessionId, sessionId),
          eq(conversationSessions.userId, userId),
          inArray(conversationMessages.turnNumber, selectedTurns)
        )
      )
      .orderBy(asc(conversationMessages.turnNumber), asc(conversationMessages.createdAt));
    const assets = await this.listAssets(rows.map((row) => row.message.id));
    const oldestTurn = Math.min(...selectedTurns);
    const newestTurn = Math.max(...selectedTurns);
    const hasMore = turnRows.length > input.limit;
    return {
      messages: rows.map((row) => toMessage(row.message, assets.get(row.message.id) ?? [])),
      pageInfo: {
        limit: input.limit,
        oldestTurn,
        newestTurn,
        hasMore,
        nextBeforeTurn: hasMore ? oldestTurn : null
      }
    };
  }

  public async listMemoryEntriesForContext(
    sessionId: string,
    userId: string,
    input: { relevantTurnNumbers: number[]; beforeTurn: number; olderLimit: number }
  ): Promise<ConversationMemoryEntryRecord[]> {
    const ownershipConditions = [
      eq(conversationMemoryEntries.sessionId, sessionId),
      eq(conversationSessions.userId, userId)
    ];
    const [relevantRows, olderRows] = await Promise.all([
      input.relevantTurnNumbers.length > 0
        ? this.connection.db
            .select({ memory: conversationMemoryEntries })
            .from(conversationMemoryEntries)
            .innerJoin(
              conversationSessions,
              eq(conversationSessions.id, conversationMemoryEntries.sessionId)
            )
            .where(
              and(
                ...ownershipConditions,
                inArray(conversationMemoryEntries.turnNumber, [
                  ...new Set(input.relevantTurnNumbers)
                ])
              )
            )
            .orderBy(
              desc(conversationMemoryEntries.turnNumber),
              desc(conversationMemoryEntries.createdAt)
            )
        : Promise.resolve([]),
      this.connection.db
        .select({ memory: conversationMemoryEntries })
        .from(conversationMemoryEntries)
        .innerJoin(
          conversationSessions,
          eq(conversationSessions.id, conversationMemoryEntries.sessionId)
        )
        .where(
          and(...ownershipConditions, lt(conversationMemoryEntries.turnNumber, input.beforeTurn))
        )
        .orderBy(
          desc(conversationMemoryEntries.turnNumber),
          desc(conversationMemoryEntries.createdAt)
        )
        .limit(input.olderLimit)
    ]);
    const byTurn = new Map<number, (typeof olderRows)[number]["memory"]>();
    for (const { memory } of [...relevantRows, ...olderRows]) {
      if (!byTurn.has(memory.turnNumber)) byTurn.set(memory.turnNumber, memory);
    }
    return [...byTurn.values()]
      .sort((left, right) => left.turnNumber - right.turnNumber)
      .map((memory) => ({
        turnNumber: memory.turnNumber,
        content: memory.content,
        structuredData: asRecord(memory.structuredData),
        status: memory.status
      }));
  }

  public async findLatestRequirementRun(sessionId: string, userId: string) {
    const [row] = await this.connection.db
      .select({
        sourceMessageId: requirementRuns.sourceMessageId,
        requirementRunId: requirementRuns.id,
        result: requirementRuns.result
      })
      .from(requirementRuns)
      .innerJoin(conversationSessions, eq(conversationSessions.id, requirementRuns.sessionId))
      .where(and(eq(requirementRuns.sessionId, sessionId), eq(conversationSessions.userId, userId)))
      .orderBy(desc(requirementRuns.createdAt))
      .limit(1);
    if (!row?.sourceMessageId) return undefined;
    return {
      sourceMessageId: row.sourceMessageId,
      requirementRunId: row.requirementRunId,
      result: requirementResultSchema.parse(row.result)
    };
  }

  public async listRequirementRunsForMessages(
    sessionId: string,
    userId: string,
    sourceMessageIds: string[]
  ) {
    if (sourceMessageIds.length === 0) return [];
    const rows = await this.connection.db
      .select({
        sourceMessageId: requirementRuns.sourceMessageId,
        requirementRunId: requirementRuns.id,
        result: requirementRuns.result
      })
      .from(requirementRuns)
      .innerJoin(conversationSessions, eq(conversationSessions.id, requirementRuns.sessionId))
      .where(
        and(
          eq(requirementRuns.sessionId, sessionId),
          eq(conversationSessions.userId, userId),
          inArray(requirementRuns.sourceMessageId, sourceMessageIds)
        )
      )
      .orderBy(asc(requirementRuns.createdAt));
    return rows.flatMap((row) =>
      row.sourceMessageId
        ? [
            {
              sourceMessageId: row.sourceMessageId,
              requirementRunId: row.requirementRunId,
              result: requirementResultSchema.parse(row.result)
            }
          ]
        : []
    );
  }

  public async startTurn(input: StartConversationTurnInput): Promise<StartConversationTurnResult> {
    return this.connection.db.transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(conversationSessions)
        .where(
          and(
            eq(conversationSessions.id, input.sessionId),
            eq(conversationSessions.userId, input.userId)
          )
        )
        .for("update")
        .limit(1);
      if (!session) return { status: "not_found" as const };

      const [duplicate] = await tx
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.sessionId, input.sessionId),
            eq(conversationMessages.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1);
      if (duplicate) {
        const duplicateAssets = await tx
          .select()
          .from(conversationMessageAssets)
          .where(eq(conversationMessageAssets.messageId, duplicate.id))
          .orderBy(asc(conversationMessageAssets.position));
        const [duplicateRun] = await tx
          .select({ request: conversationTurnRuns.request })
          .from(conversationTurnRuns)
          .where(eq(conversationTurnRuns.messageId, duplicate.id))
          .limit(1);
        const storedRequest = createConversationMessageRequestSchema.safeParse(
          duplicateRun?.request
        );
        if (
          duplicate.content !== input.content ||
          !storedRequest.success ||
          JSON.stringify(storedRequest.data) !== JSON.stringify(input.request)
        ) {
          return { status: "idempotency_conflict" as const };
        }
        if (duplicate.status === "failed") {
          if (duplicate.turnNumber !== session.version + 1) {
            return { status: "duplicate" as const, message: toMessage(duplicate, duplicateAssets) };
          }
          if (session.version !== input.expectedVersion) {
            return { status: "version_conflict" as const, actualVersion: session.version };
          }
          if (session.processingMessageId) {
            return { status: "busy" as const, processingMessageId: session.processingMessageId };
          }
          const now = new Date();
          const [resumedMessage] = await tx
            .update(conversationMessages)
            .set({
              status: "processing",
              errorCode: null,
              errorMessage: null,
              updatedAt: now
            })
            .where(eq(conversationMessages.id, duplicate.id))
            .returning();
          const [resumedSession] = await tx
            .update(conversationSessions)
            .set({ processingMessageId: duplicate.id, updatedAt: now })
            .where(eq(conversationSessions.id, input.sessionId))
            .returning();
          await tx
            .insert(conversationTurnRuns)
            .values({
              messageId: duplicate.id,
              sessionId: input.sessionId,
              userId: input.userId,
              request: input.request,
              status: "queued",
              createdAt: now,
              updatedAt: now
            })
            .onConflictDoUpdate({
              target: conversationTurnRuns.messageId,
              set: {
                request: input.request,
                status: "queued",
                attemptCount: 0,
                startedAt: null,
                leaseToken: null,
                leaseExpiresAt: null,
                heartbeatAt: null,
                completedAt: null,
                lastError: null,
                updatedAt: now
              }
            });
          const [snapshot] = await tx
            .select()
            .from(conversationStateSnapshots)
            .where(eq(conversationStateSnapshots.sessionId, input.sessionId))
            .orderBy(desc(conversationStateSnapshots.version))
            .limit(1);
          if (!resumedMessage || !resumedSession || !snapshot) {
            throw new Error("恢复失败会话消息时状态不完整");
          }
          return {
            status: "started" as const,
            session: toSessionRecord(resumedSession),
            message: toMessage(resumedMessage, duplicateAssets),
            snapshot: toSnapshot(snapshot)
          };
        }
        return { status: "duplicate" as const, message: toMessage(duplicate, duplicateAssets) };
      }

      if (session.version !== input.expectedVersion) {
        return { status: "version_conflict" as const, actualVersion: session.version };
      }
      if (session.processingMessageId) {
        return { status: "busy" as const, processingMessageId: session.processingMessageId };
      }

      if (input.request.promptOptimizationId) {
        const [optimization] = await tx
          .select({
            id: promptOptimizations.id,
            inputRevision: promptOptimizations.inputRevision,
            imageDecisionStatus: promptOptimizations.imageDecisionStatus,
            selectedImageKeys: promptOptimizations.selectedImageKeys
          })
          .from(promptOptimizations)
          .where(
            and(
              eq(promptOptimizations.id, input.request.promptOptimizationId),
              eq(promptOptimizations.userId, input.userId),
              eq(promptOptimizations.projectId, session.projectId),
              eq(promptOptimizations.sessionId, input.sessionId),
              eq(promptOptimizations.status, "succeeded"),
              eq(promptOptimizations.optimizedText, input.content),
              sql`${promptOptimizations.adoptedMessageId} is null`
            )
          )
          .for("update")
          .limit(1);
        const inputRevision = promptOptimizationInputRevisionSchema.safeParse(
          optimization?.inputRevision
        );
        const selectedImageKeys = parseStringArray(optimization?.selectedImageKeys);
        const expectedAttachments = inputRevision.success
          ? resolveOptimizationAttachments(inputRevision.data, selectedImageKeys)
          : undefined;
        const expectedAssetIds = expectedAttachments
          ? [...new Set(expectedAttachments.map((attachment) => attachment.assetId))]
          : [];
        const ownedAssets =
          expectedAssetIds.length > 0
            ? await tx
                .select({ id: mediaAssets.id, origin: mediaAssets.origin })
                .from(mediaAssets)
                .where(
                  and(
                    inArray(mediaAssets.id, expectedAssetIds),
                    eq(mediaAssets.userId, input.userId),
                    eq(mediaAssets.projectId, session.projectId),
                    eq(mediaAssets.kind, "image")
                  )
                )
                .for("update")
            : [];
        const generatedAssetIds = ownedAssets
          .filter((asset) => asset.origin === "generated")
          .map((asset) => asset.id);
        const deliverableOutputs =
          generatedAssetIds.length > 0
            ? await tx
                .select({ assetId: generationTaskOutputs.deliverableAssetId })
                .from(generationTaskOutputs)
                .where(
                  and(
                    inArray(generationTaskOutputs.deliverableAssetId, generatedAssetIds),
                    eq(generationTaskOutputs.status, "deliverable")
                  )
                )
                .for("update")
            : [];
        const deliverableAssetIds = new Set(
          deliverableOutputs.flatMap((output) => (output.assetId ? [output.assetId] : []))
        );
        if (
          !optimization ||
          !inputRevision.success ||
          !expectedAttachments ||
          ownedAssets.length !== expectedAssetIds.length ||
          generatedAssetIds.some((assetId) => !deliverableAssetIds.has(assetId)) ||
          !["not_needed", "resolved"].includes(optimization.imageDecisionStatus ?? "") ||
          inputRevision.data.stateSnapshotVersion !== session.version ||
          inputRevision.data.agentId !== session.agentId ||
          inputRevision.data.agentInstructionHash !==
            hashText(input.request.agentInstruction ?? "") ||
          JSON.stringify(expectedAttachments) !== JSON.stringify(input.request.attachments) ||
          JSON.stringify(inputRevision.data.imageSettings) !==
            JSON.stringify(input.request.imageSettings) ||
          inputRevision.data.modelId !== input.request.modelId
        ) {
          return { status: "prompt_optimization_not_adoptable" as const };
        }
      }

      const turnNumber = session.version + 1;
      const now = new Date();
      const [message] = await tx
        .insert(conversationMessages)
        .values({
          id: input.messageId,
          sessionId: input.sessionId,
          turnNumber,
          role: "user",
          content: input.content,
          status: "processing",
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
          updatedAt: now
        })
        .returning();
      if (!message) throw new Error("创建会话消息失败");
      if (input.assets.length > 0) {
        await tx.insert(conversationMessageAssets).values(
          input.assets.map((asset) => ({
            messageId: input.messageId,
            assetId: asset.assetId,
            role: asset.role,
            position: asset.position,
            relation: asset.relation
          }))
        );
      }
      await tx.insert(conversationTurnRuns).values({
        messageId: input.messageId,
        sessionId: input.sessionId,
        userId: input.userId,
        request: input.request,
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      if (input.request.promptOptimizationId) {
        const adopted = await tx
          .update(promptOptimizations)
          .set({ adoptedMessageId: input.messageId, updatedAt: now })
          .where(
            and(
              eq(promptOptimizations.id, input.request.promptOptimizationId),
              sql`${promptOptimizations.adoptedMessageId} is null`
            )
          )
          .returning({ id: promptOptimizations.id });
        if (adopted.length !== 1) throw new Error("采用提示词优化结果时并发状态发生变化");
      }
      const [updatedSession] = await tx
        .update(conversationSessions)
        .set({ processingMessageId: input.messageId, updatedAt: now })
        .where(eq(conversationSessions.id, input.sessionId))
        .returning();
      const [snapshot] = await tx
        .select()
        .from(conversationStateSnapshots)
        .where(eq(conversationStateSnapshots.sessionId, input.sessionId))
        .orderBy(desc(conversationStateSnapshots.version))
        .limit(1);
      if (!updatedSession || !snapshot) throw new Error("会话状态不完整");
      return {
        status: "started" as const,
        session: toSessionRecord(updatedSession),
        message: toMessage(message, input.assets),
        snapshot: toSnapshot(snapshot)
      };
    });
  }

  public async claimTurnRun(messageId: string, input: { leaseExpiresAt: string }) {
    return this.connection.db.transaction(async (tx) => {
      const [queued] = await tx
        .select()
        .from(conversationTurnRuns)
        .where(
          and(
            eq(conversationTurnRuns.messageId, messageId),
            eq(conversationTurnRuns.status, "queued")
          )
        )
        .for("update", { skipLocked: true })
        .limit(1);
      if (!queued) return undefined;
      const request = createConversationMessageRequestSchema.parse(queued.request);
      const now = new Date();
      const leaseToken = randomUUID();
      const [row] = await tx
        .update(conversationTurnRuns)
        .set({
          status: "processing",
          startedAt: now,
          leaseToken,
          leaseExpiresAt: new Date(input.leaseExpiresAt),
          heartbeatAt: now,
          attemptCount: sql`${conversationTurnRuns.attemptCount} + 1`,
          lastError: null,
          updatedAt: now
        })
        .where(
          and(
            eq(conversationTurnRuns.messageId, messageId),
            eq(conversationTurnRuns.status, "queued")
          )
        )
        .returning();
      if (!row) return undefined;
      return {
        messageId: row.messageId,
        sessionId: row.sessionId,
        userId: row.userId,
        request,
        status: row.status,
        leaseToken
      };
    });
  }

  public async renewTurnLease(input: {
    messageId: string;
    leaseToken: string;
    leaseExpiresAt: string;
  }): Promise<boolean> {
    const now = new Date();
    const rows = await this.connection.db
      .update(conversationTurnRuns)
      .set({
        leaseExpiresAt: new Date(input.leaseExpiresAt),
        heartbeatAt: now,
        updatedAt: now
      })
      .where(
        and(
          eq(conversationTurnRuns.messageId, input.messageId),
          eq(conversationTurnRuns.status, "processing"),
          eq(conversationTurnRuns.leaseToken, input.leaseToken),
          gt(conversationTurnRuns.leaseExpiresAt, now)
        )
      )
      .returning({ messageId: conversationTurnRuns.messageId });
    return rows.length === 1;
  }

  public async restartFailedTurn(input: {
    sessionId: string;
    userId: string;
    messageId: string;
  }): Promise<RestartConversationTurnResult> {
    return this.connection.db.transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(conversationSessions)
        .where(
          and(
            eq(conversationSessions.id, input.sessionId),
            eq(conversationSessions.userId, input.userId)
          )
        )
        .for("update")
        .limit(1);
      if (!session) return { status: "not_found" as const };
      if (session.processingMessageId) {
        return { status: "busy" as const, processingMessageId: session.processingMessageId };
      }
      const [message] = await tx
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.id, input.messageId),
            eq(conversationMessages.sessionId, input.sessionId)
          )
        )
        .limit(1);
      if (!message) return { status: "not_found" as const };
      if (message.status !== "failed") return { status: "not_failed" as const };
      if (message.turnNumber !== session.version + 1) {
        return { status: "version_conflict" as const, actualVersion: session.version };
      }

      const now = new Date();
      const [updatedMessage] = await tx
        .update(conversationMessages)
        .set({ status: "processing", errorCode: null, errorMessage: null, updatedAt: now })
        .where(eq(conversationMessages.id, input.messageId))
        .returning();
      const [updatedSession] = await tx
        .update(conversationSessions)
        .set({ processingMessageId: input.messageId, updatedAt: now })
        .where(eq(conversationSessions.id, input.sessionId))
        .returning();
      const [updatedRun] = await tx
        .update(conversationTurnRuns)
        .set({
          status: "queued",
          attemptCount: 0,
          startedAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          completedAt: null,
          lastError: null,
          updatedAt: now
        })
        .where(eq(conversationTurnRuns.messageId, input.messageId))
        .returning();
      if (!updatedMessage || !updatedSession || !updatedRun) {
        throw new Error("恢复失败会话任务时状态不完整");
      }
      const assets = await tx
        .select()
        .from(conversationMessageAssets)
        .where(eq(conversationMessageAssets.messageId, input.messageId))
        .orderBy(asc(conversationMessageAssets.position));
      return {
        status: "started" as const,
        session: toSessionRecord(updatedSession),
        message: toMessage(updatedMessage, assets)
      };
    });
  }

  public async findDispatchableTurnMessageIds(input: {
    now: string;
    maxAttempts: number;
    maxEnqueueAttempts?: number;
    limit: number;
  }): Promise<string[]> {
    const now = new Date();
    const expiresAt = new Date(input.now);
    const maxEnqueueAttempts = input.maxEnqueueAttempts ?? input.maxAttempts;
    await this.connection.db.transaction(async (tx) => {
      const exhausted = await tx
        .select({
          messageId: conversationTurnRuns.messageId,
          sessionId: conversationTurnRuns.sessionId,
          userId: conversationTurnRuns.userId
        })
        .from(conversationTurnRuns)
        .where(
          and(
            eq(conversationTurnRuns.status, "processing"),
            lte(conversationTurnRuns.leaseExpiresAt, expiresAt),
            sql`${conversationTurnRuns.attemptCount} >= ${input.maxAttempts}`
          )
        )
        .for("update");
      for (const run of exhausted) {
        await tx
          .update(conversationMessages)
          .set({
            status: "failed",
            errorCode: "CONVERSATION_TURN_INTERRUPTED",
            errorMessage: "会话处理进程中断，请重新尝试",
            updatedAt: now
          })
          .where(
            and(
              eq(conversationMessages.id, run.messageId),
              eq(conversationMessages.sessionId, run.sessionId)
            )
          );
        await tx
          .update(conversationSessions)
          .set({ processingMessageId: null, updatedAt: now })
          .where(
            and(
              eq(conversationSessions.id, run.sessionId),
              eq(conversationSessions.userId, run.userId),
              eq(conversationSessions.processingMessageId, run.messageId)
            )
          );
        await tx
          .update(conversationTurnRuns)
          .set({
            status: "failed",
            leaseToken: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            completedAt: now,
            lastError: "会话处理进程中断，已达到自动恢复上限",
            updatedAt: now
          })
          .where(eq(conversationTurnRuns.messageId, run.messageId));
      }
      await tx
        .update(conversationTurnRuns)
        .set({
          status: "queued",
          startedAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          lastError: "会话处理进程中断，任务已恢复",
          updatedAt: now
        })
        .where(
          and(
            eq(conversationTurnRuns.status, "processing"),
            lte(conversationTurnRuns.leaseExpiresAt, expiresAt),
            sql`${conversationTurnRuns.attemptCount} < ${input.maxAttempts}`
          )
        );
      const enqueueExhausted = await tx
        .select({
          messageId: conversationTurnRuns.messageId,
          sessionId: conversationTurnRuns.sessionId,
          userId: conversationTurnRuns.userId
        })
        .from(conversationTurnRuns)
        .where(
          and(
            eq(conversationTurnRuns.status, "queued"),
            sql`${conversationTurnRuns.enqueueAttempts} >= ${maxEnqueueAttempts}`
          )
        )
        .for("update");
      for (const run of enqueueExhausted) {
        await tx
          .update(conversationMessages)
          .set({
            status: "failed",
            errorCode: "CONVERSATION_TURN_QUEUE_UNAVAILABLE",
            errorMessage: "会话任务队列投递失败，已达到自动恢复上限",
            updatedAt: now
          })
          .where(
            and(
              eq(conversationMessages.id, run.messageId),
              eq(conversationMessages.sessionId, run.sessionId)
            )
          );
        await tx
          .update(conversationSessions)
          .set({ processingMessageId: null, updatedAt: now })
          .where(
            and(
              eq(conversationSessions.id, run.sessionId),
              eq(conversationSessions.userId, run.userId),
              eq(conversationSessions.processingMessageId, run.messageId)
            )
          );
        await tx
          .update(conversationTurnRuns)
          .set({
            status: "failed",
            completedAt: now,
            lastError: "会话任务队列投递失败，已达到自动恢复上限",
            updatedAt: now
          })
          .where(eq(conversationTurnRuns.messageId, run.messageId));
      }
    });
    const rows = await this.connection.db
      .select({ messageId: conversationTurnRuns.messageId })
      .from(conversationTurnRuns)
      .where(
        and(
          eq(conversationTurnRuns.status, "queued"),
          sql`${conversationTurnRuns.enqueueAttempts} < ${maxEnqueueAttempts}`
        )
      )
      .orderBy(asc(conversationTurnRuns.createdAt))
      .limit(input.limit);
    return rows.map((row) => row.messageId);
  }

  public async recordTurnEnqueueAttempt(messageId: string, errorMessage?: string): Promise<void> {
    await this.connection.db
      .update(conversationTurnRuns)
      .set({
        enqueueAttempts: sql`${conversationTurnRuns.enqueueAttempts} + 1`,
        lastEnqueueAttemptAt: new Date(),
        lastError: errorMessage ? "会话任务队列投递失败，等待自动恢复" : null,
        updatedAt: new Date()
      })
      .where(eq(conversationTurnRuns.messageId, messageId));
  }

  public async completeTurn(input: CompleteConversationTurnInput) {
    return this.connection.db.transaction(async (tx) => {
      const now = new Date();
      const [leasedRun] = await tx
        .select({ messageId: conversationTurnRuns.messageId })
        .from(conversationTurnRuns)
        .where(
          and(
            eq(conversationTurnRuns.messageId, input.sourceMessageId),
            eq(conversationTurnRuns.status, "processing"),
            eq(conversationTurnRuns.leaseToken, input.leaseToken),
            gt(conversationTurnRuns.leaseExpiresAt, now)
          )
        )
        .for("update")
        .limit(1);
      if (!leasedRun) throw new Error("会话任务租约已经失效");
      const [session] = await tx
        .select()
        .from(conversationSessions)
        .where(
          and(
            eq(conversationSessions.id, input.sessionId),
            eq(conversationSessions.userId, input.userId)
          )
        )
        .for("update")
        .limit(1);
      if (
        !session ||
        session.processingMessageId !== input.sourceMessageId ||
        session.version !== input.baseVersion
      ) {
        throw new Error("会话版本已变化，无法提交本轮结果");
      }

      const [assistantMessage] = await tx
        .insert(conversationMessages)
        .values({
          id: input.assistantMessageId,
          sessionId: input.sessionId,
          turnNumber: input.turnNumber,
          role: "assistant",
          content: input.assistantContent,
          status: "completed",
          createdAt: now,
          updatedAt: now
        })
        .returning();
      const [snapshot] = await tx
        .insert(conversationStateSnapshots)
        .values({
          id: input.snapshotId,
          sessionId: input.sessionId,
          sourceMessageId: input.sourceMessageId,
          throughTurn: input.turnNumber,
          version: input.baseVersion + 1,
          state: input.state,
          createdAt: now
        })
        .returning();
      if (input.requirementRun) {
        await tx.insert(requirementRuns).values({
          id: input.requirementRun.id,
          parentRequirementRunId: null,
          userId: input.userId,
          projectId: input.requirementRun.request.projectId,
          sessionId: input.sessionId,
          sourceMessageId: input.sourceMessageId,
          stateSnapshotId: input.snapshotId,
          request: input.requirementRun.request,
          result: input.requirementRun.result,
          executionPlan: input.requirementRun.executionPlan,
          executionPlanHash: input.requirementRun.executionPlanHash,
          aiModel: input.requirementRun.aiModel,
          promptVersion: input.requirementRun.promptVersion,
          createdAt: now
        });
        await tx.insert(generationStartRequests).values({
          requirementRunId: input.requirementRun.id,
          userId: input.userId,
          sessionId: input.sessionId,
          idempotencyKey: input.requirementRun.id,
          status: "pending",
          createdAt: now,
          updatedAt: now
        });
      }
      await tx
        .update(conversationTurnRuns)
        .set({
          status: "completed",
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          completedAt: now,
          lastError: null,
          updatedAt: now
        })
        .where(
          and(
            eq(conversationTurnRuns.messageId, input.sourceMessageId),
            eq(conversationTurnRuns.leaseToken, input.leaseToken)
          )
        );
      await tx
        .update(conversationMessages)
        .set({ status: "completed", updatedAt: now, errorCode: null, errorMessage: null })
        .where(eq(conversationMessages.id, input.sourceMessageId));
      await tx.insert(conversationMemoryEntries).values({
        sessionId: input.sessionId,
        sourceMessageId: input.sourceMessageId,
        turnNumber: input.turnNumber,
        memoryType: "turn",
        content: input.memoryContent,
        structuredData: input.memoryStructuredData ?? input.state,
        status: "active",
        searchText: input.memorySearchText ?? input.memoryContent,
        createdAt: now
      });
      const [updatedSession] = await tx
        .update(conversationSessions)
        .set({
          version: input.baseVersion + 1,
          processingMessageId: null,
          updatedAt: now
        })
        .where(eq(conversationSessions.id, input.sessionId))
        .returning();
      if (!assistantMessage || !snapshot || !updatedSession) {
        throw new Error("保存会话结果失败");
      }
      return {
        session: toSessionRecord(updatedSession),
        assistantMessage: toMessage(assistantMessage, []),
        snapshot: toSnapshot(snapshot)
      };
    });
  }

  public async failTurn(input: {
    sessionId: string;
    userId: string;
    messageId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<boolean> {
    return this.connection.db.transaction(async (tx) => {
      const now = new Date();
      const [run] = await tx
        .select({ messageId: conversationTurnRuns.messageId })
        .from(conversationTurnRuns)
        .where(
          and(
            eq(conversationTurnRuns.messageId, input.messageId),
            eq(conversationTurnRuns.status, "processing"),
            eq(conversationTurnRuns.leaseToken, input.leaseToken),
            gt(conversationTurnRuns.leaseExpiresAt, now)
          )
        )
        .for("update")
        .limit(1);
      if (!run) return false;
      await tx
        .update(conversationMessages)
        .set({
          status: "failed",
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(conversationMessages.id, input.messageId),
            eq(conversationMessages.sessionId, input.sessionId)
          )
        );
      await tx
        .update(conversationSessions)
        .set({ processingMessageId: null, updatedAt: new Date() })
        .where(
          and(
            eq(conversationSessions.id, input.sessionId),
            eq(conversationSessions.userId, input.userId),
            eq(conversationSessions.processingMessageId, input.messageId)
          )
        );
      await tx
        .update(conversationTurnRuns)
        .set({
          status: "failed",
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          completedAt: now,
          lastError: input.errorMessage,
          updatedAt: now
        })
        .where(
          and(
            eq(conversationTurnRuns.messageId, input.messageId),
            eq(conversationTurnRuns.leaseToken, input.leaseToken)
          )
        );
      return true;
    });
  }

  private async listAssets(messageIds: string[]) {
    const byMessage = new Map<string, ConversationMessageAsset[]>();
    if (messageIds.length === 0) return byMessage;
    const rows = await this.connection.db
      .select()
      .from(conversationMessageAssets)
      .where(
        and(
          inArray(conversationMessageAssets.messageId, messageIds),
          assetIsProductAvailable(this.connection.db, conversationMessageAssets.assetId)
        )
      )
      .orderBy(asc(conversationMessageAssets.messageId), asc(conversationMessageAssets.position));
    for (const row of rows) {
      const assets = byMessage.get(row.messageId) ?? [];
      assets.push({
        assetId: row.assetId,
        role: row.role,
        position: row.position,
        relation: row.relation
      });
      byMessage.set(row.messageId, assets);
    }
    return byMessage;
  }
}

function toSessionRecord(row: typeof conversationSessions.$inferSelect): ConversationSessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    agentId: row.agentId,
    title: row.title,
    mode: "image",
    status: row.status,
    version: row.version,
    processingMessageId: row.processingMessageId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toMessage(
  row: typeof conversationMessages.$inferSelect,
  assets: ConversationMessageAsset[] | (typeof conversationMessageAssets.$inferSelect)[]
): ConversationMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    turnNumber: row.turnNumber,
    role: row.role,
    content: row.content,
    status: row.status,
    assets: assets.map((asset) => ({
      assetId: asset.assetId,
      role: asset.role,
      position: asset.position,
      relation: asset.relation
    })),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString()
  };
}

function toSnapshot(
  row: typeof conversationStateSnapshots.$inferSelect
): ConversationStateSnapshot {
  return {
    id: row.id,
    sessionId: row.sessionId,
    throughTurn: row.throughTurn,
    version: row.version,
    state: parsePersistedConversationState(row.state),
    createdAt: row.createdAt.toISOString()
  };
}

function resolveOptimizationAttachments(
  revision: ReturnType<typeof promptOptimizationInputRevisionSchema.parse>,
  selectedImageKeys: string[]
) {
  const candidates = new Map(
    revision.candidateImages.map((candidate) => [candidate.key, candidate])
  );
  const selected = selectedImageKeys.map((key) => candidates.get(key));
  if (selected.some((candidate) => !candidate)) return undefined;
  const attachments = selected.map((candidate) => {
    const value = candidate!;
    const role = ["generated_result", "selected_result"].includes(value.role)
      ? ("edit_base" as const)
      : value.role;
    return { assetId: value.assetId, role, relation: value.relation };
  });
  const byIdentity = new Map(attachments.map((item) => [`${item.assetId}:${item.role}`, item]));
  const unique = [...byIdentity.values()];
  if (unique.filter((item) => item.role === "edit_base").length > 1) return undefined;
  if (unique.filter((item) => item.role === "product_source").length > 4) return undefined;
  if (unique.filter((item) => item.role === "user_reference").length > 1) return undefined;
  return unique;
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function hashText(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
