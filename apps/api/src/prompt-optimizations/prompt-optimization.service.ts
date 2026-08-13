import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";

import {
  createPromptOptimizationRequestSchema,
  type CreatePromptOptimizationRequest,
  type Environment,
  type PromptOptimization,
  type PromptOptimizationCandidateImage,
  type PromptOptimizationInputRevision
} from "@chaoren/contracts";

import { AgentService } from "../agents/agent.service.js";
import { extractTurnReferences } from "../conversations/conversation-context.js";
import { ENVIRONMENT } from "../environment.js";
import { ImageModelCatalog } from "../image-models/image-model.catalog.js";
import { MediaAssetService } from "../media-assets/media-asset.service.js";
import { getPromptOptimizationConfiguration } from "../requirements/conversation-requirement.configuration.js";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
  type ConversationSessionRecord
} from "../conversations/conversation.repository.js";
import {
  PROMPT_OPTIMIZATION_AI_PORT,
  type PromptOptimizationAiInput,
  type PromptOptimizationAiPort,
  type PromptOptimizationImage
} from "./prompt-optimization-ai.port.js";
import {
  PromptOptimizationAiConfigurationError,
  PromptOptimizationAiRequestError,
  PromptOptimizationAiResponseError
} from "./openai-compatible-prompt-optimization-ai.adapter.js";
import {
  PROMPT_OPTIMIZATION_REPOSITORY,
  type PromptOptimizationRecord,
  type PromptOptimizationRepository
} from "./prompt-optimization.repository.js";
import {
  validatePromptOptimizationInput,
  validatePromptOptimizationOutput
} from "./prompt-optimization-output.validator.js";
import { PROMPT_OPTIMIZATION_PROMPT_VERSION } from "./prompt-optimization.prompt.js";

@Injectable()
export class PromptOptimizationService {
  public constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversations: ConversationRepository,
    @Inject(PROMPT_OPTIMIZATION_REPOSITORY)
    private readonly optimizations: PromptOptimizationRepository,
    @Inject(PROMPT_OPTIMIZATION_AI_PORT)
    private readonly ai: PromptOptimizationAiPort,
    private readonly mediaAssets: MediaAssetService,
    private readonly imageModels: ImageModelCatalog,
    private readonly agents: AgentService
  ) {}

  public async optimize(sessionId: string, rawRequest: unknown): Promise<PromptOptimization> {
    const request = this.parseRequest(rawRequest);
    const session = await this.findSession(sessionId);
    const requestHash = hashRequest({ sessionId, projectId: session.projectId, request });
    const existing = await this.optimizations.findByIdempotencyKey(
      this.environment.LOCAL_USER_ID,
      request.idempotencyKey
    );
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw this.idempotencyConflict();
      }
      if (existing.status !== "processing") return this.returnExisting(existing);
    }
    const generationModel = this.imageModels.getEnabled(request.modelId);
    const maxImageCount = Math.min(4, generationModel.maxImageCount);
    const inputIssues = validatePromptOptimizationInput(
      request,
      maxImageCount,
      generationModel.supportedAspectRatios
    );
    if (inputIssues.length > 0) {
      throw new BadRequestException({
        code: "INVALID_PROMPT_OPTIMIZATION_INPUT",
        issues: inputIssues
      });
    }

    const snapshot = existing
      ? undefined
      : await this.conversations.findLatestSnapshot(sessionId, this.environment.LOCAL_USER_ID);
    if (!existing && !snapshot) {
      throw new ConflictException({ code: "PROMPT_OPTIMIZATION_CONTEXT_MISSING" });
    }
    const agent = !existing && session.agentId ? await this.agents.findById(session.agentId) : null;
    if (!existing && !agent) {
      throw new ConflictException({ code: "PROMPT_OPTIMIZATION_CONTEXT_MISSING" });
    }
    const agentInstruction = existing
      ? (existing.inputRevision.agentInstruction ?? "")
      : (request.agentInstruction ?? agent!.agentInstruction).trim();
    const candidateImages = existing
      ? existing.inputRevision.candidateImages
      : await this.collectCandidateImages(request, session, snapshot!);
    const executionToken = randomUUID();
    const now = new Date();
    const inputRevision: PromptOptimizationInputRevision = existing?.inputRevision ?? {
      text: request.text,
      attachments: request.attachments,
      imageSettings: request.imageSettings,
      modelId: request.modelId,
      agentId: session.agentId ?? undefined,
      agentInstruction,
      agentInstructionHash: hashText(agentInstruction),
      candidateImages,
      stateSnapshotId: snapshot!.id,
      stateSnapshotVersion: snapshot!.version
    };
    const result = await this.optimizations.createOrFind({
      id: randomUUID(),
      userId: this.environment.LOCAL_USER_ID,
      projectId: session.projectId,
      sessionId,
      idempotencyKey: request.idempotencyKey,
      requestHash,
      executionToken,
      staleBefore: new Date(now.getTime() - this.executionStaleMs()).toISOString(),
      request,
      inputRevision,
      createdAt: now.toISOString()
    });
    if (result.status === "idempotency_conflict") {
      throw this.idempotencyConflict();
    }
    if (result.status === "parent_not_available") {
      throw new ConflictException({
        code: "PROMPT_OPTIMIZATION_PARENT_NOT_AVAILABLE",
        message: "上一版提示词优化结果不存在、尚未完成或不属于当前会话"
      });
    }
    if (result.status === "duplicate") return this.returnExisting(result.record);

    try {
      const executionSnapshotId = result.record.inputRevision.stateSnapshotId;
      const executionSnapshot = executionSnapshotId
        ? await this.conversations.findSnapshot(
            executionSnapshotId,
            sessionId,
            this.environment.LOCAL_USER_ID
          )
        : undefined;
      if (
        !executionSnapshot ||
        executionSnapshot.version !== result.record.inputRevision.stateSnapshotVersion
      ) {
        throw new PromptOptimizationContextError();
      }
      const assets = await this.loadOwnedCandidateAssets(
        result.record.inputRevision.candidateImages,
        session.projectId
      );
      const images = await Promise.all(
        result.record.inputRevision.candidateImages.map(
          async (candidate): Promise<PromptOptimizationImage> => {
            const asset = assets.get(candidate.assetId);
            if (!asset) throw new PromptOptimizationContextError();
            return {
              key: candidate.key,
              role: candidate.role,
              relation: candidate.relation,
              source: candidate.source,
              mimeType: asset.mimeType,
              content: await streamToBuffer(await this.mediaAssets.read(asset))
            };
          }
        )
      );
      const aiInput: PromptOptimizationAiInput = {
        operation: request.operation,
        text: request.text,
        revisionInstruction: request.revisionInstruction,
        imageSettings: request.imageSettings,
        limitedContext: {
          currentRequirement: executionSnapshot.state.currentRequirement,
          agentInstruction: result.record.inputRevision.agentInstruction ?? ""
        },
        generationModel: {
          id: generationModel.id,
          provider: generationModel.provider,
          maxImageCount,
          supportedAspectRatios: generationModel.supportedAspectRatios
        },
        images
      };
      const validationContext = {
        request,
        maxImageCount,
        allowedAspectRatios: generationModel.supportedAspectRatios,
        availableImageKeys: images.map((image) => image.key),
        explicitImageKeys: result.record.inputRevision.candidateImages
          .filter((candidate) => candidate.source === "explicit")
          .map((candidate) => candidate.key),
        candidateImages: result.record.inputRevision.candidateImages.map(({ key, role }) => ({
          key,
          role
        }))
      };
      const rawOutput = await this.ai.optimize(aiInput);
      let validated = validatePromptOptimizationOutput(rawOutput, validationContext);
      if (!validated.success) {
        const repairedOutput = await this.ai.repair({
          ...aiInput,
          previousOutput: rawOutput,
          validationIssues: validated.issues
        });
        validated = validatePromptOptimizationOutput(repairedOutput, validationContext);
      }
      if (!validated.success) {
        throw new PromptOptimizationAiResponseError();
      }
      if (validated.imageDecisionStatus === "missing") {
        throw new PromptOptimizationImageDecisionError("missing");
      }
      if (validated.imageDecisionStatus === "ambiguous") {
        throw new PromptOptimizationImageDecisionError("ambiguous");
      }
      if (!validated.optimizedText) throw new PromptOptimizationAiResponseError();
      return this.completeExecution(
        result.record,
        executionToken,
        validated.optimizedText,
        validated.imageDecisionStatus,
        validated.selectedImageKeys
      );
    } catch (error) {
      return this.failOrThrow(
        result.record,
        executionToken,
        toExecutionErrorCode(error),
        error instanceof PromptOptimizationImageDecisionError ? error.status : undefined
      );
    }
  }

  public async get(sessionId: string, optimizationId: string): Promise<PromptOptimization> {
    const session = await this.findSession(sessionId);
    const record = await this.optimizations.findById(
      optimizationId,
      this.environment.LOCAL_USER_ID
    );
    if (!record || record.sessionId !== session.id || record.projectId !== session.projectId) {
      throw new NotFoundException({ code: "PROMPT_OPTIMIZATION_NOT_FOUND" });
    }
    return toPublic(record);
  }

  private parseRequest(rawRequest: unknown): CreatePromptOptimizationRequest {
    const parsed = createPromptOptimizationRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_PROMPT_OPTIMIZATION_REQUEST",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "$",
          message: issue.message
        }))
      });
    }
    return parsed.data;
  }

  private async findSession(sessionId: string): Promise<ConversationSessionRecord> {
    const session = await this.conversations.findSession(sessionId, this.environment.LOCAL_USER_ID);
    if (!session) throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND" });
    return session;
  }

  private async loadOwnedCandidateAssets(
    candidates: PromptOptimizationCandidateImage[],
    projectId: string
  ) {
    const assetIds = [...new Set(candidates.map((candidate) => candidate.assetId))];
    const records = await this.mediaAssets.getOwnedImages(assetIds, projectId);
    await this.mediaAssets.assertProductAvailableIds(assetIds);
    return new Map(records.map((record) => [record.id, record]));
  }

  private async completeExecution(
    record: PromptOptimizationRecord,
    executionToken: string,
    optimizedText: string,
    imageDecisionStatus: "not_needed" | "resolved",
    selectedImageKeys: string[]
  ): Promise<PromptOptimization> {
    const completed = await this.optimizations.complete({
      id: record.id,
      userId: this.environment.LOCAL_USER_ID,
      executionToken,
      optimizedText,
      imageDecisionStatus,
      selectedImageKeys,
      aiModel: this.ai.getModelName(),
      promptVersion: PROMPT_OPTIMIZATION_PROMPT_VERSION,
      completedAt: new Date().toISOString()
    });
    if (!completed) throw new NotFoundException({ code: "PROMPT_OPTIMIZATION_NOT_FOUND" });
    if (completed.status === "failed") {
      throw createExecutionException(
        completed.errorCode ?? "PROMPT_OPTIMIZATION_FAILED",
        completed.id
      );
    }
    return toPublic(completed);
  }

  private returnExisting(record: PromptOptimizationRecord): PromptOptimization {
    if (record.status === "failed") {
      throw createExecutionException(record.errorCode ?? "PROMPT_OPTIMIZATION_FAILED", record.id);
    }
    return toPublic(record);
  }

  private idempotencyConflict(): ConflictException {
    return new ConflictException({
      code: "PROMPT_OPTIMIZATION_IDEMPOTENCY_CONFLICT",
      message: "同一优化提交标识不能用于不同输入"
    });
  }

  private async failOrThrow(
    record: PromptOptimizationRecord,
    executionToken: string,
    errorCode: string,
    imageDecisionStatus?: "missing" | "ambiguous",
    selectedImageKeys: string[] = []
  ): Promise<PromptOptimization> {
    const failed = await this.optimizations.fail({
      id: record.id,
      userId: this.environment.LOCAL_USER_ID,
      executionToken,
      errorCode,
      ...(imageDecisionStatus ? { imageDecisionStatus } : {}),
      selectedImageKeys,
      completedAt: new Date().toISOString()
    });
    if (!failed) throw new NotFoundException({ code: "PROMPT_OPTIMIZATION_NOT_FOUND" });
    if (failed.status !== "failed") return toPublic(failed);
    throw createExecutionException(failed.errorCode ?? errorCode, failed.id);
  }

  private executionStaleMs(): number {
    const timeout = getPromptOptimizationConfiguration(this.environment).timeoutMs;
    return Math.max(120_000, timeout * 3);
  }

  private async collectCandidateImages(
    request: CreatePromptOptimizationRequest,
    session: ConversationSessionRecord,
    snapshot: Awaited<ReturnType<ConversationRepository["findLatestSnapshot"]>> & {}
  ): Promise<PromptOptimizationCandidateImage[]> {
    const candidates: Array<Omit<PromptOptimizationCandidateImage, "key">> =
      request.attachments.map((attachment) => ({ ...attachment, source: "explicit" as const }));
    const add = (candidate: Omit<PromptOptimizationCandidateImage, "key">) => {
      if (
        !candidates.some(
          (item) => item.assetId === candidate.assetId && item.role === candidate.role
        )
      )
        candidates.push(candidate);
    };
    for (const assetId of snapshot.state.activeProductAssetIds) {
      add({
        assetId,
        role: "product_source",
        relation: "当前有效商品图",
        source: "active_context"
      });
    }
    for (const guidance of snapshot.state.referenceGuidance) {
      add({
        assetId: guidance.assetId,
        role: "user_reference",
        relation: guidance.instruction,
        source: "active_context"
      });
    }
    if (snapshot.state.editBaseAssetId) {
      add({
        assetId: snapshot.state.editBaseAssetId,
        role: "edit_base",
        relation: "当前会话编辑基图",
        source: "active_context"
      });
    }
    for (const assetId of snapshot.state.selectedResultAssetIds) {
      add({
        assetId,
        role: "selected_result",
        relation: "用户已选择的生成结果",
        source: "selected_result"
      });
    }
    const referencedTurns = extractTurnReferences(request.text);
    const [recentPage, referencedMessages] = await Promise.all([
      this.conversations.listMessagePage(session.id, this.environment.LOCAL_USER_ID, { limit: 4 }),
      this.conversations.listMessagesForTurns(
        session.id,
        this.environment.LOCAL_USER_ID,
        referencedTurns
      )
    ]);
    const explicitTurnSet = new Set(referencedTurns);
    for (const message of [...referencedMessages, ...recentPage.messages].sort(
      (left, right) => right.turnNumber - left.turnNumber
    )) {
      for (const asset of message.assets) {
        if (!["generated_result", "selected_result"].includes(asset.role)) continue;
        add({
          assetId: asset.assetId,
          role: asset.role as "generated_result" | "selected_result",
          relation: asset.relation ?? `会话第 ${message.turnNumber} 轮生成结果`,
          source: explicitTurnSet.has(message.turnNumber) ? "referenced_turn" : "recent_result"
        });
      }
    }
    const availableIds = new Set(
      await this.mediaAssets.filterProductAvailableIds(
        candidates.map((candidate) => candidate.assetId)
      )
    );
    const explicitIds = new Set(request.attachments.map((attachment) => attachment.assetId));
    if ([...explicitIds].some((assetId) => !availableIds.has(assetId))) {
      throw new ConflictException({ code: "PROMPT_OPTIMIZATION_IMAGE_NOT_AVAILABLE" });
    }
    return candidates
      .filter((candidate) => availableIds.has(candidate.assetId))
      .slice(0, 12)
      .map((candidate, index) => ({ ...candidate, key: `image_${index + 1}` }));
  }
}

function hashRequest(input: {
  sessionId: string;
  projectId: string;
  request: CreatePromptOptimizationRequest;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toExecutionErrorCode(error: unknown): string {
  if (error instanceof PromptOptimizationImageDecisionError) {
    return error.status === "missing"
      ? "PROMPT_OPTIMIZATION_IMAGE_REQUIRED"
      : "PROMPT_OPTIMIZATION_IMAGE_AMBIGUOUS";
  }
  if (error instanceof PromptOptimizationContextError) {
    return "PROMPT_OPTIMIZATION_CONTEXT_MISSING";
  }
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const code =
      typeof response === "object" && response !== null && "code" in response
        ? (response as { code?: unknown }).code
        : undefined;
    if (code === "SOURCE_IMAGE_NOT_AVAILABLE" || code === "GENERATION_SOURCE_NOT_DELIVERABLE") {
      return "PROMPT_OPTIMIZATION_IMAGE_NOT_AVAILABLE";
    }
  }
  if (error instanceof PromptOptimizationAiConfigurationError) {
    return "PROMPT_OPTIMIZATION_NOT_CONFIGURED";
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return "PROMPT_OPTIMIZATION_TIMEOUT";
  }
  if (error instanceof PromptOptimizationAiRequestError) {
    if (error.statusCode === 429) return "PROMPT_OPTIMIZATION_RATE_LIMITED";
    return "PROMPT_OPTIMIZATION_SERVICE_UNAVAILABLE";
  }
  if (error instanceof PromptOptimizationAiResponseError) {
    return "PROMPT_OPTIMIZATION_INVALID_RESPONSE";
  }
  return "PROMPT_OPTIMIZATION_FAILED";
}

function createExecutionException(errorCode: string, optimizationId: string): HttpException {
  const status =
    errorCode === "PROMPT_OPTIMIZATION_TIMEOUT"
      ? HttpStatus.GATEWAY_TIMEOUT
      : errorCode === "PROMPT_OPTIMIZATION_RATE_LIMITED"
        ? HttpStatus.TOO_MANY_REQUESTS
        : errorCode === "PROMPT_OPTIMIZATION_INVALID_RESPONSE"
          ? HttpStatus.BAD_GATEWAY
          : errorCode === "PROMPT_OPTIMIZATION_CONTEXT_MISSING" ||
              errorCode === "PROMPT_OPTIMIZATION_IMAGE_NOT_AVAILABLE" ||
              errorCode === "PROMPT_OPTIMIZATION_IMAGE_REQUIRED" ||
              errorCode === "PROMPT_OPTIMIZATION_IMAGE_AMBIGUOUS"
            ? HttpStatus.CONFLICT
            : HttpStatus.SERVICE_UNAVAILABLE;
  return new HttpException({ code: errorCode, optimizationId }, status);
}

class PromptOptimizationContextError extends Error {}
class PromptOptimizationImageDecisionError extends Error {
  public constructor(public readonly status: "missing" | "ambiguous") {
    super(status);
  }
}

function toPublic(record: PromptOptimizationRecord): PromptOptimization {
  return {
    id: record.id,
    sessionId: record.sessionId,
    operation: record.operation,
    status: record.status,
    parentOptimizationId: record.parentOptimizationId,
    originalText: record.originalText,
    optimizedText: record.optimizedText,
    revisionInstruction: record.revisionInstruction,
    inputRevision: record.inputRevision,
    adoptedMessageId: record.adoptedMessageId,
    errorCode: record.errorCode,
    imageDecisionStatus: record.imageDecisionStatus,
    selectedImageKeys: record.selectedImageKeys,
    createdAt: record.createdAt,
    completedAt: record.completedAt
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
