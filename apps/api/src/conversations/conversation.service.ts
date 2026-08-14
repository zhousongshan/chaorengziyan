import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";

import {
  conversationAgentQuerySchema,
  conversationHistoryQuerySchema,
  createConversationMessageRequestSchema,
  createConversationRequestSchema,
  emptyConversationState,
  type ConversationHistoryResponse,
  type ConversationMessage,
  type ConversationMessagesPageResponse,
  type ConversationMessageAsset,
  type ConversationSession,
  type CreateConversationMessageRequest,
  type CreateConversationMessageResponse,
  type Environment,
  type ResolvedGenerationPlan,
  type ResolveRequirementRequest
} from "@chaoren/contracts";

import { ENVIRONMENT } from "../environment.js";
import { AgentService } from "../agents/agent.service.js";
import { MediaAssetService } from "../media-assets/media-asset.service.js";
import { ProjectService } from "../projects/project.service.js";
import {
  ProductEntityService,
  type ProductEntityCandidate
} from "../product-entities/product-entity.service.js";
import type { ConversationRequirementImage } from "../requirements/requirement-ai.port.js";
import { RequirementService } from "../requirements/requirement.service.js";
import {
  ConversationContextAssembler,
  ConversationContextLimitError,
  extractTurnReferences
} from "./conversation-context.js";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
  type ConversationSessionRecord
} from "./conversation.repository.js";
import { ConversationStateReducer } from "./conversation-state.reducer.js";
import { CONVERSATION_TURN_QUEUE, type ConversationTurnQueue } from "./conversation-turn.queue.js";
import { ConversationVisualMemoryService } from "./conversation-visual-memory.service.js";

@Injectable()
export class ConversationService {
  private readonly contextAssembler = new ConversationContextAssembler();
  private readonly stateReducer = new ConversationStateReducer();

  public constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversations: ConversationRepository,
    private readonly agents: AgentService,
    private readonly projects: ProjectService,
    private readonly productEntities: ProductEntityService,
    private readonly mediaAssets: MediaAssetService,
    private readonly requirements: RequirementService,
    private readonly visualMemories: ConversationVisualMemoryService,
    @Inject(CONVERSATION_TURN_QUEUE) private readonly turnQueue: ConversationTurnQueue
  ) {}

  public async create(rawRequest: unknown): Promise<ConversationSession> {
    const parsed = createConversationRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new BadRequestException({ code: "INVALID_CONVERSATION_REQUEST" });
    }
    await this.projects.assertOwned(parsed.data.projectId);
    await this.agents.findById(parsed.data.agentId);
    const createdAt = new Date().toISOString();
    const session = await this.conversations.ensureSession({
      id: randomUUID(),
      snapshotId: randomUUID(),
      userId: this.environment.LOCAL_USER_ID,
      projectId: parsed.data.projectId,
      agentId: parsed.data.agentId,
      title: parsed.data.title,
      state: emptyConversationState,
      createdAt
    });
    if (session.projectId !== parsed.data.projectId) {
      throw new ConflictException({
        code: "CONVERSATION_PROJECT_MISMATCH",
        message: "当前 Agent 会话属于另一个项目，不能直接切换项目"
      });
    }
    return toPublicSession(session);
  }

  public async current(rawQuery: unknown): Promise<{ session: ConversationSession | null }> {
    const query = this.parseAgentQuery(rawQuery);
    await this.agents.findById(query.agentId);
    const session = await this.conversations.findSessionByAgent(
      this.environment.LOCAL_USER_ID,
      query.agentId
    );
    return { session: session ? toPublicSession(session) : null };
  }

  public async getHistory(
    sessionId: string,
    rawQuery: unknown
  ): Promise<ConversationHistoryResponse> {
    const query = this.parseHistoryQuery(rawQuery);
    await this.agents.findById(query.agentId);
    const [session, snapshot, messagePage, latestRequirementRun] = await Promise.all([
      this.conversations.findSession(sessionId, this.environment.LOCAL_USER_ID),
      this.conversations.findLatestSnapshot(sessionId, this.environment.LOCAL_USER_ID),
      this.conversations.listMessagePage(sessionId, this.environment.LOCAL_USER_ID, {
        ...(query.beforeTurn !== undefined ? { beforeTurn: query.beforeTurn } : {}),
        limit: query.limit
      }),
      this.conversations.findLatestRequirementRun(sessionId, this.environment.LOCAL_USER_ID)
    ]);
    if (!session || !snapshot) {
      throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND" });
    }
    this.assertSessionAgent(session, query.agentId);
    const requirementRuns = await this.conversations.listRequirementRunsForMessages(
      sessionId,
      this.environment.LOCAL_USER_ID,
      messagePage.messages.filter((message) => message.role === "user").map((message) => message.id)
    );
    return {
      session: toPublicSession(session),
      messages: messagePage.messages,
      latestSnapshot: snapshot,
      requirementRuns,
      latestRequirementRun: latestRequirementRun ?? null,
      messagePage: messagePage.pageInfo
    };
  }

  public async getMessages(
    sessionId: string,
    rawQuery: unknown
  ): Promise<ConversationMessagesPageResponse> {
    const query = this.parseHistoryQuery(rawQuery);
    await this.agents.findById(query.agentId);
    const [session, messagePage] = await Promise.all([
      this.conversations.findSession(sessionId, this.environment.LOCAL_USER_ID),
      this.conversations.listMessagePage(sessionId, this.environment.LOCAL_USER_ID, {
        ...(query.beforeTurn !== undefined ? { beforeTurn: query.beforeTurn } : {}),
        limit: query.limit
      })
    ]);
    if (!session) throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND" });
    this.assertSessionAgent(session, query.agentId);
    const requirementRuns = await this.conversations.listRequirementRunsForMessages(
      sessionId,
      this.environment.LOCAL_USER_ID,
      messagePage.messages.filter((message) => message.role === "user").map((message) => message.id)
    );
    return {
      messages: messagePage.messages,
      requirementRuns,
      messagePage: messagePage.pageInfo
    };
  }

  public async sendMessage(
    sessionId: string,
    rawQuery: unknown,
    rawRequest: unknown
  ): Promise<CreateConversationMessageResponse> {
    const query = this.parseAgentQuery(rawQuery);
    const parsed = createConversationMessageRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_CONVERSATION_MESSAGE",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "$",
          message: issue.message
        }))
      });
    }
    const session = await this.conversations.findSession(sessionId, this.environment.LOCAL_USER_ID);
    if (!session) throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND" });
    this.assertSessionAgent(session, query.agentId);
    const request = parsed.data;
    const assetIds = [
      ...new Set([
        ...request.attachments.map((attachment) => attachment.assetId),
        ...(request.deliverySettings?.watermark.assetId
          ? [request.deliverySettings.watermark.assetId]
          : [])
      ])
    ];
    await this.mediaAssets.getOwnedImages(assetIds, session.projectId);
    await this.mediaAssets.assertProductAvailableIds(assetIds);

    const messageId = randomUUID();
    const assets: ConversationMessageAsset[] = request.attachments.map((attachment, position) => ({
      assetId: attachment.assetId,
      role: attachment.role,
      position,
      relation: attachment.relation
    }));
    const started = await this.conversations.startTurn({
      sessionId,
      userId: this.environment.LOCAL_USER_ID,
      expectedVersion: request.expectedVersion,
      messageId,
      idempotencyKey: request.idempotencyKey,
      content: request.text,
      assets,
      request
    });
    if (started.status === "not_found") {
      throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND" });
    }
    if (started.status === "version_conflict") {
      throw new ConflictException({
        code: "CONVERSATION_VERSION_CONFLICT",
        actualVersion: started.actualVersion
      });
    }
    if (started.status === "busy") {
      throw new ConflictException({
        code: "CONVERSATION_BUSY",
        processingMessageId: started.processingMessageId
      });
    }
    if (started.status === "idempotency_conflict") {
      throw new ConflictException({
        code: "CONVERSATION_IDEMPOTENCY_CONFLICT",
        message: "同一消息提交标识不能用于不同内容"
      });
    }
    if (started.status === "prompt_optimization_not_adoptable") {
      throw new ConflictException({
        code: "PROMPT_OPTIMIZATION_NOT_ADOPTABLE",
        message: "提示词优化结果已变化、已被使用或不属于当前会话"
      });
    }
    if (started.status === "duplicate") {
      if (started.message.status === "failed") {
        throw new ConflictException({
          code: "DUPLICATE_CONVERSATION_MESSAGE",
          messageId: started.message.id
        });
      }
      const currentSession =
        (await this.conversations.findSession(sessionId, this.environment.LOCAL_USER_ID)) ??
        session;
      return {
        session: toPublicSession(currentSession),
        userMessage: started.message,
        status: started.message.status === "completed" ? "completed" : "processing"
      };
    }
    const activeMessageId = started.message.id;

    // Queue delivery is retried from the durable turn-run row when Redis is unavailable.
    void this.turnQueue.enqueue(activeMessageId).catch(() => undefined);
    return {
      session: toPublicSession(started.session),
      userMessage: started.message,
      status: "processing"
    };
  }

  public async processTurn(messageId: string): Promise<void> {
    const leaseDurationMs = this.environment.CONVERSATION_TURN_STALE_MS;
    const run = await this.conversations.claimTurnRun(messageId, {
      leaseExpiresAt: new Date(Date.now() + leaseDurationMs).toISOString()
    });
    if (!run) return;
    const heartbeatTimer = setInterval(
      () => {
        void this.conversations
          .renewTurnLease({
            messageId,
            leaseToken: run.leaseToken,
            leaseExpiresAt: new Date(Date.now() + leaseDurationMs).toISOString()
          })
          .catch(() => false);
      },
      Math.max(1_000, Math.floor(leaseDurationMs / 3))
    );
    heartbeatTimer.unref();
    try {
      const [session, snapshot, recentMessages] = await Promise.all([
        this.conversations.findSession(run.sessionId, run.userId),
        this.conversations.findLatestSnapshot(run.sessionId, run.userId),
        this.conversations.listContextMessages(run.sessionId, run.userId, {
          currentMessageId: messageId,
          recentCompletedTurnCount: this.environment.CONVERSATION_RECENT_FULL_TURNS
        })
      ]);
      const activeMessage = recentMessages.find((message) => message.id === messageId);
      if (!session || !snapshot || !activeMessage || session.processingMessageId !== messageId) {
        await this.conversations.failTurn({
          sessionId: run.sessionId,
          userId: run.userId,
          messageId,
          leaseToken: run.leaseToken,
          errorCode: "CONVERSATION_TURN_STATE_INVALID",
          errorMessage: "会话处理状态不完整"
        });
        return;
      }
      const request = run.request;
      const loadedTurns = new Set(recentMessages.map((message) => message.turnNumber));
      const referencedTurns = [
        ...new Set([
          ...extractTurnReferences(request.text),
          ...Object.values(snapshot.state.fieldSources).map((source) => source.turnNumber)
        ])
      ].filter((turnNumber) => !loadedTurns.has(turnNumber));
      const historicalMessages = await this.conversations.listMessagesForTurns(
        run.sessionId,
        run.userId,
        referencedTurns
      );
      const unfilteredMessages = mergeMessages(recentMessages, historicalMessages);
      const recentCompletedTurns = recentMessages
        .filter((message) => message.id !== messageId && message.status === "completed")
        .map((message) => message.turnNumber);
      const firstRecentTurn = Math.min(...recentCompletedTurns, activeMessage.turnNumber);
      const memoryEntries = await this.conversations.listMemoryEntriesForContext(
        run.sessionId,
        run.userId,
        {
          relevantTurnNumbers: [
            ...new Set(unfilteredMessages.map((message) => message.turnNumber))
          ],
          beforeTurn: firstRecentTurn,
          olderLimit: 100
        }
      );
      const collectedAssets = collectRelevantAssets(request, snapshot.state, unfilteredMessages);
      const availableAssetIds = new Set(
        await this.mediaAssets.filterProductAvailableIds(
          collectedAssets.map((asset) => asset.assetId)
        )
      );
      const relevantAssets = collectedAssets.filter((asset) =>
        availableAssetIds.has(asset.assetId)
      );
      const messages = unfilteredMessages.map((message) => ({
        ...message,
        assets: message.assets.filter(
          (asset) =>
            !["generated_result", "selected_result", "rejected_result"].includes(asset.role) ||
            availableAssetIds.has(asset.assetId)
        )
      }));
      const assetMemories = await this.visualMemories.findMany(
        run.sessionId,
        relevantAssets.map((asset) => asset.assetId)
      );
      const productEntityCandidates = await this.productEntities.findInheritableByAssetIds(
        relevantAssets.map((asset) => asset.assetId),
        session.projectId,
        run.userId
      );
      const requirementImages = await loadRequirementImages(
        this.mediaAssets,
        session.projectId,
        relevantAssets,
        productEntityCandidates
      );
      const context = this.contextAssembler.assemble({
        messages,
        currentMessageId: messageId,
        currentRequest: request,
        state: snapshot.state,
        recentTurnCount: this.environment.CONVERSATION_RECENT_FULL_TURNS,
        maximumCharacters: this.environment.CONVERSATION_MAX_CONTEXT_CHARACTERS,
        maximumTokens: this.environment.CONVERSATION_MAX_CONTEXT_TOKENS,
        imageCount: requirementImages.length,
        imageTokenEstimate: this.environment.CONVERSATION_IMAGE_TOKEN_ESTIMATE,
        assetMemories,
        memoryEntries
      });
      const requirementRequest = toRequirementRequest(session, request, snapshot.state);
      const resolution = await this.requirements.resolveConversationOutput(
        requirementRequest,
        context,
        requirementImages.map((image) => image.modelInput),
        { sessionId: run.sessionId, sourceMessageId: messageId }
      );
      const imageBindings = new Map(
        requirementImages.map((image) => [image.modelInput.key, image])
      );
      const generationPlan = bindGenerationPlan(resolution.output.generationPlan, imageBindings);
      const effectiveRequest = bindSelectedEditTarget(
        request,
        resolution.output.targetImageKey,
        imageBindings
      );
      const generationRequirementRequest = toRequirementRequest(
        session,
        effectiveRequest,
        snapshot.state
      );
      try {
        await this.visualMemories.saveMany({
          sessionId: run.sessionId,
          analysisModel: resolution.aiModel,
          memories: resolution.output.assetMemories.flatMap((memory) => {
            const binding = imageBindings.get(memory.key);
            return binding
              ? [{ assetId: binding.assetId, role: binding.modelInput.role, memory }]
              : [];
          })
        });
      } catch {
        // Visual memory is an optional retrieval cache. The accepted requirement
        // and the real image assets remain authoritative when this write fails.
      }
      const reduced = this.stateReducer.reduce({
        previous: snapshot.state,
        request: effectiveRequest,
        output: resolution.output,
        generationPlan,
        messageId,
        turnNumber: activeMessage.turnNumber
      });
      const requirementRunId = resolution.output.action === "generate" ? randomUUID() : null;
      const snapshotId = randomUUID();
      const turnMemory = buildTurnMemory({
        turnNumber: activeMessage.turnNumber,
        userText: request.text,
        assistantText: resolution.output.assistantReply,
        changedFields: resolution.output.changedFields,
        assetIds: relevantAssets.map((asset) => asset.assetId),
        action: resolution.output.action,
        responseType: resolution.output.responseType,
        result: reduced.result
      });
      await this.conversations.completeTurn({
        sessionId: run.sessionId,
        userId: run.userId,
        sourceMessageId: messageId,
        leaseToken: run.leaseToken,
        assistantMessageId: randomUUID(),
        assistantContent: resolution.output.assistantReply,
        snapshotId,
        baseVersion: session.version,
        turnNumber: activeMessage.turnNumber,
        state: reduced.state,
        memoryContent: turnMemory.content,
        memoryStructuredData: turnMemory.structuredData,
        memorySearchText: turnMemory.searchText,
        requirementRun:
          requirementRunId && reduced.result?.status === "ready"
            ? {
                id: requirementRunId,
                request: generationRequirementRequest,
                result: reduced.result,
                executionPlan: generationPlan!,
                executionPlanHash: hashGenerationPlan(generationPlan!),
                aiModel: resolution.aiModel,
                promptVersion: resolution.promptVersion
              }
            : null
      });
    } catch (error) {
      const classifiedError = classifyConversationTurnError(error);
      await this.conversations.failTurn({
        sessionId: run.sessionId,
        userId: run.userId,
        messageId,
        leaseToken: run.leaseToken,
        errorCode: classifiedError.code,
        errorMessage: classifiedError.message
      });
      throw error instanceof Error ? error : new Error("会话处理失败");
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  public async retryMessage(
    sessionId: string,
    messageId: string,
    rawQuery: unknown
  ): Promise<CreateConversationMessageResponse> {
    const query = this.parseAgentQuery(rawQuery);
    const session = await this.conversations.findSession(sessionId, this.environment.LOCAL_USER_ID);
    if (!session) throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND" });
    this.assertSessionAgent(session, query.agentId);
    const restarted = await this.conversations.restartFailedTurn({
      sessionId,
      userId: this.environment.LOCAL_USER_ID,
      messageId
    });
    if (restarted.status === "not_found") {
      throw new NotFoundException({ code: "CONVERSATION_MESSAGE_NOT_FOUND" });
    }
    if (restarted.status === "not_failed") {
      throw new ConflictException({ code: "CONVERSATION_MESSAGE_NOT_FAILED" });
    }
    if (restarted.status === "busy") {
      throw new ConflictException({
        code: "CONVERSATION_BUSY",
        processingMessageId: restarted.processingMessageId
      });
    }
    if (restarted.status === "version_conflict") {
      throw new ConflictException({
        code: "CONVERSATION_VERSION_CONFLICT",
        actualVersion: restarted.actualVersion
      });
    }
    void this.turnQueue.enqueue(messageId).catch(() => undefined);
    return {
      session: toPublicSession(restarted.session),
      userMessage: restarted.message,
      status: "processing"
    };
  }

  private parseAgentQuery(rawQuery: unknown) {
    const parsed = conversationAgentQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({ code: "INVALID_CONVERSATION_AGENT_QUERY" });
    }
    return parsed.data;
  }

  private parseHistoryQuery(rawQuery: unknown) {
    const parsed = conversationHistoryQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({ code: "INVALID_CONVERSATION_HISTORY_QUERY" });
    }
    return parsed.data;
  }

  private assertSessionAgent(session: ConversationSessionRecord, expectedAgentId: string) {
    if (session.agentId === expectedAgentId) return;
    throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND" });
  }
}

function classifyConversationTurnError(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof ConversationContextLimitError) {
    return {
      code: "CONVERSATION_CONTEXT_LIMIT_EXCEEDED",
      message: "当前会话内容过多，请新建会话后继续创作。"
    };
  }
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (isErrorResponse(response) && typeof response.code === "string") {
      return {
        code: response.code,
        message:
          typeof response.message === "string" ? response.message : "会话处理失败，请稍后重试。"
      };
    }
  }
  return {
    code: "CONVERSATION_TURN_FAILED",
    message: "会话处理失败，请稍后重试。"
  };
}

function isErrorResponse(value: unknown): value is { code: unknown; message?: unknown } {
  return typeof value === "object" && value !== null && "code" in value;
}

function mergeMessages(...groups: ConversationMessage[][]): ConversationMessage[] {
  const byId = new Map(groups.flat().map((message) => [message.id, message]));
  return [...byId.values()].sort(
    (left, right) =>
      left.turnNumber - right.turnNumber || left.createdAt.localeCompare(right.createdAt)
  );
}

function bindGenerationPlan(
  draft: NonNullable<
    Awaited<ReturnType<RequirementService["resolveConversationOutput"]>>["output"]["generationPlan"]
  > | null,
  imageBindings: Map<
    string,
    {
      assetId: string;
      modelInput: ConversationRequirementImage;
      productEntities: ProductEntityCandidate[];
    }
  >
): ResolvedGenerationPlan | null {
  if (!draft) return null;
  const newEntityIds = new Map<string, string>();
  return {
    schemaVersion: "3.0",
    summary: draft.summary,
    groups: draft.groups.map((group) => {
      const qualityImageKeys = new Set(
        group.sourceImages
          .filter((source) => source.usage !== "style_reference" && source.usage !== "layout_cell")
          .map((source) => source.imageKey)
      );
      return {
        outputCount: group.outputCount,
        outputLayout: group.outputLayout,
        instruction: group.instruction,
        subjectPolicy: group.subjectPolicy,
        referenceDesignPlan: group.referenceDesignPlan,
        copyPlan: group.copyPlan,
        referenceAnalyses: group.referenceAnalyses.map((analysis) => {
          const binding = imageBindings.get(analysis.imageKey);
          if (!binding || binding.modelInput.role !== "user_reference") {
            throw new Error("参考分析只能绑定本分组的参考图");
          }
          return {
            assetId: binding.assetId,
            observedDesign: analysis.observedDesign,
            transferPlan: analysis.transferPlan
          };
        }),
        subjectEntities: group.subjectEntities.map((entity) => ({
          entityKey: entity.entityKey,
          label: entity.label,
          ...(entity.lineageKind === "new_product_source"
            ? bindNewProductEntity(
                entity.entityKey,
                entity.sourceImageKeys,
                imageBindings,
                newEntityIds,
                qualityImageKeys
              )
            : bindInheritedProductEntity(
                entity.productEntityId,
                entity.sourceImageKey,
                imageBindings,
                qualityImageKeys
              ))
        })),
        sourceImages: group.sourceImages.map((source, position) => {
          const binding = imageBindings.get(source.imageKey);
          if (!binding) throw new Error("生图计划引用的图片不存在");
          return {
            assetId: binding.assetId,
            sourceRole: binding.modelInput.role,
            usage: source.usage,
            position
          };
        })
      };
    })
  };
}

function bindNewProductEntity(
  entityKey: string,
  imageKeys: string[],
  imageBindings: Map<
    string,
    {
      assetId: string;
      modelInput: ConversationRequirementImage;
      productEntities: ProductEntityCandidate[];
    }
  >,
  newEntityIds: Map<string, string>,
  qualityImageKeys: Set<string>
) {
  const sourceAssetIds = imageKeys.map((imageKey) => {
    const binding = imageBindings.get(imageKey);
    if (
      !binding ||
      binding.modelInput.role !== "product_source" ||
      !qualityImageKeys.has(imageKey)
    ) {
      throw new Error("新商品实体只能引用本轮商品原图");
    }
    return binding.assetId;
  });
  const uniqueSourceAssetIds = [...new Set(sourceAssetIds)];
  const identityKey = `${entityKey}:${[...uniqueSourceAssetIds].sort().join(",")}`;
  const productEntityId = newEntityIds.get(identityKey) ?? randomUUID();
  newEntityIds.set(identityKey, productEntityId);
  return {
    productEntityId,
    lineageKind: "new_product_source" as const,
    inheritedFromAssetId: null,
    sourceAssetIds: uniqueSourceAssetIds
  };
}

function bindInheritedProductEntity(
  productEntityId: string,
  imageKey: string,
  imageBindings: Map<
    string,
    {
      assetId: string;
      modelInput: ConversationRequirementImage;
      productEntities: ProductEntityCandidate[];
    }
  >,
  qualityImageKeys: Set<string>
) {
  const binding = imageBindings.get(imageKey);
  const candidate = binding?.productEntities.find((item) => item.id === productEntityId);
  if (!binding || !candidate || !qualityImageKeys.has(imageKey)) {
    throw new Error("历史商品实体不属于所选可交付图片");
  }
  return {
    productEntityId,
    lineageKind: "inherited_product_entity" as const,
    inheritedFromAssetId: binding.assetId,
    sourceAssetIds: [...candidate.sourceAssetIds]
  };
}

function hashGenerationPlan(plan: ResolvedGenerationPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function collectRelevantAssets(
  request: CreateConversationMessageRequest,
  state: ConversationHistoryResponse["latestSnapshot"]["state"],
  messages: ConversationMessage[]
): Array<Pick<ConversationMessageAsset, "assetId" | "role" | "relation">> {
  const assets: Array<Pick<ConversationMessageAsset, "assetId" | "role" | "relation">> = [
    ...request.attachments
  ];
  const hasCurrentProduct = request.attachments.some(
    (attachment) => attachment.role === "product_source"
  );
  const hasCurrentReferences = request.attachments.some(
    (attachment) => attachment.role === "user_reference"
  );
  const isLocalEdit =
    request.attachments.some((attachment) => attachment.role === "edit_base") &&
    !hasCurrentReferences;
  if (!hasCurrentProduct && !request.clearProductImage) {
    assets.push(
      ...state.activeProductAssetIds.map((assetId) => ({
        assetId,
        role: "product_source" as const,
        relation: null
      }))
    );
  }
  if (!hasCurrentReferences && !request.clearReferenceImages && !isLocalEdit) {
    assets.push(
      ...state.referenceAssetIds.map((assetId) => ({
        assetId,
        role: "user_reference" as const,
        relation: null
      }))
    );
  }
  const referencedTurns = new Set(
    [...request.text.matchAll(/第\s*(\d{1,4})\s*轮/g)].map((match) => Number(match[1]))
  );
  for (const message of messages) {
    if (referencedTurns.has(message.turnNumber)) {
      assets.push(...message.assets);
    }
  }
  const recentGenerated = messages
    .flatMap((message) =>
      message.assets.map((asset) => ({ ...asset, turnNumber: message.turnNumber }))
    )
    .filter((asset) => ["generated_result", "selected_result"].includes(asset.role))
    .sort((left, right) => right.turnNumber - left.turnNumber || right.position - left.position)
    .slice(0, 4);
  assets.push(...recentGenerated);
  const byId = new Map<string, (typeof assets)[number]>();
  for (const asset of assets) {
    if (!byId.has(asset.assetId)) byId.set(asset.assetId, asset);
  }
  return [...byId.values()];
}

async function loadRequirementImages(
  mediaAssets: MediaAssetService,
  projectId: string,
  assets: Array<Pick<ConversationMessageAsset, "assetId" | "role" | "relation">>,
  productEntityCandidates: Map<string, ProductEntityCandidate[]>
): Promise<
  Array<{
    assetId: string;
    modelInput: ConversationRequirementImage;
    productEntities: ProductEntityCandidate[];
  }>
> {
  if (assets.length === 0) return [];
  const records = await mediaAssets.getOwnedImages(
    assets.map((asset) => asset.assetId),
    projectId
  );
  const recordsById = new Map(records.map((record) => [record.id, record]));
  return Promise.all(
    assets.map(async (asset, index) => {
      const record = recordsById.get(asset.assetId);
      if (!record) throw new Error(`图片资产不存在: ${asset.assetId}`);
      return {
        assetId: asset.assetId,
        productEntities: productEntityCandidates.get(asset.assetId) ?? [],
        modelInput: {
          key: `image_${index + 1}`,
          role: asset.role,
          relation: asset.relation,
          productEntities: (productEntityCandidates.get(asset.assetId) ?? []).map((entity) => ({
            id: entity.id,
            label: entity.label
          })),
          mimeType: record.mimeType,
          content: await streamToBuffer(await mediaAssets.read(record))
        }
      };
    })
  );
}

function toRequirementRequest(
  session: ConversationSessionRecord,
  request: CreateConversationMessageRequest,
  state: ConversationHistoryResponse["latestSnapshot"]["state"]
): ResolveRequirementRequest {
  const productAttachments = request.attachments.filter(
    (attachment) => attachment.role === "product_source"
  );
  const editBaseAttachment = request.attachments.find(
    (attachment) => attachment.role === "edit_base"
  );
  const referenceAttachments = request.attachments.filter(
    (attachment) => attachment.role === "user_reference"
  );
  const references =
    referenceAttachments.length > 0
      ? referenceAttachments.map((attachment) => attachment.assetId)
      : editBaseAttachment
        ? []
        : request.clearReferenceImages
          ? []
          : state.referenceAssetIds;
  const editBaseId = editBaseAttachment?.assetId ?? null;
  const referenceGuidance =
    referenceAttachments.length > 0
      ? referenceAttachments.map((attachment) => ({
          assetId: attachment.assetId,
          instruction:
            attachment.relation ??
            "先理解参考图的优点、问题、版式和文字层级，再按当前商品重新设计；默认不复制参考商品、品牌或原文案，可规划非事实型创意文字"
        }))
      : editBaseAttachment
        ? []
        : request.clearReferenceImages
          ? []
          : state.referenceGuidance;
  return {
    projectId: session.projectId,
    modelId: request.modelId,
    userText: request.text,
    imageSettings: request.imageSettings,
    renderSettings: request.renderSettings ?? state.renderSettings,
    deliverySettings: request.deliverySettings ?? state.deliverySettings,
    agentInstruction: request.agentInstruction ?? state.agentInstruction,
    productImageIds:
      productAttachments.length > 0
        ? productAttachments.map((attachment) => attachment.assetId)
        : !request.clearProductImage
          ? state.activeProductAssetIds
          : [],
    referenceImageIds: references,
    editBaseImageId: editBaseId,
    referenceGuidance: referenceGuidance.filter((guidance) => references.includes(guidance.assetId))
  };
}

function bindSelectedEditTarget(
  request: CreateConversationMessageRequest,
  targetImageKey: string | null,
  imageBindings: Map<string, { assetId: string; modelInput: ConversationRequirementImage }>
): CreateConversationMessageRequest {
  if (!targetImageKey) return request;
  const binding = imageBindings.get(targetImageKey);
  if (!binding) throw new Error("需求AI选择的目标图片不存在");
  return {
    ...request,
    attachments: [
      ...request.attachments.filter((attachment) => attachment.role !== "edit_base"),
      {
        assetId: binding.assetId,
        role: "edit_base",
        relation: `需求AI选择的会话图片：${targetImageKey}`
      }
    ]
  };
}

function buildTurnMemory(input: {
  turnNumber: number;
  userText: string;
  assistantText: string;
  changedFields: string[];
  assetIds: string[];
  action: string;
  responseType: string;
  result: unknown;
}) {
  const summary =
    `第${input.turnNumber}轮：${input.userText || "页面设置已更新"}。${input.assistantText}`.slice(
      0,
      2_000
    );
  return {
    content: summary,
    structuredData: {
      schemaVersion: "1.0",
      summary,
      changedFields: input.changedFields,
      assetIds: [...new Set(input.assetIds)],
      action: input.action,
      responseType: input.responseType,
      result: input.result
    },
    searchText: `${input.userText}\n${input.assistantText}\n${JSON.stringify(input.result)}`
  };
}

function toPublicSession(session: ConversationSessionRecord): ConversationSession {
  return {
    id: session.id,
    projectId: session.projectId,
    agentId: session.agentId,
    title: session.title,
    mode: session.mode,
    status: session.status,
    version: session.version,
    processingMessageId: session.processingMessageId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    else if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
