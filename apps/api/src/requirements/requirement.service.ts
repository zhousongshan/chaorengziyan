import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";

import {
  resolveRequirementRequestSchema,
  type Environment,
  type ConversationRequirementAiOutput,
  type ResolveRequirementRequest,
  type ResolveRequirementResponse
} from "@chaoren/contracts";

import { AUTHORIZATION_PORT, type AuthorizationPort } from "../authorization/authorization.port.js";
import { ENVIRONMENT } from "../environment.js";
import { ImageModelCatalog } from "../image-models/image-model.catalog.js";
import { MediaAssetService } from "../media-assets/media-asset.service.js";
import { ProjectService } from "../projects/project.service.js";
import type { ConversationRequirementContext } from "../conversations/conversation-context.js";
import {
  REQUIREMENT_AI_PORT,
  type ConversationRequirementImage,
  type RequirementAiPort
} from "./requirement-ai.port.js";
import { normalizeRequirementAiError, RequirementAiError } from "./requirement-ai.errors.js";
import {
  CONVERSATION_REQUIREMENT_CONTRACT_VERSION,
  normalizeConversationRequirementAiOutput
} from "./conversation-requirement-ai.contract.js";
import {
  REQUIREMENT_AI_ATTEMPT_REPOSITORY,
  type RequirementAiAttemptRepository
} from "./requirement-ai-attempt.repository.js";
import type { RequirementAiAttemptPhase } from "./requirement-ai-attempt.repository.js";
import { getConversationRequirementConfiguration } from "./conversation-requirement.configuration.js";
import { CONVERSATION_REQUIREMENT_PROMPT_VERSION } from "./requirement.prompt.js";
import { RequirementResultValidator } from "./requirement-result.validator.js";
import {
  REQUIREMENT_RUN_REPOSITORY,
  type RequirementRunRepository
} from "./requirement-run.repository.js";

@Injectable()
export class RequirementService {
  private readonly logger = new Logger(RequirementService.name);

  public constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(AUTHORIZATION_PORT) private readonly authorization: AuthorizationPort,
    @Inject(REQUIREMENT_AI_PORT) private readonly requirementAi: RequirementAiPort,
    @Inject(REQUIREMENT_RUN_REPOSITORY)
    private readonly requirementRuns: RequirementRunRepository,
    @Inject(REQUIREMENT_AI_ATTEMPT_REPOSITORY)
    private readonly requirementAiAttempts: RequirementAiAttemptRepository,
    private readonly validator: RequirementResultValidator,
    private readonly imageModels: ImageModelCatalog,
    private readonly projects: ProjectService,
    private readonly mediaAssets: MediaAssetService
  ) {}

  public async resolveConversationOutput(
    rawRequest: unknown,
    context: ConversationRequirementContext,
    images: ConversationRequirementImage[],
    trace?: { sessionId: string; sourceMessageId: string }
  ): Promise<{
    request: ResolveRequirementRequest;
    output: ConversationRequirementAiOutput;
    aiModel: string;
    promptVersion: string;
  }> {
    const parsedRequest = resolveRequirementRequestSchema.safeParse(rawRequest);
    if (!parsedRequest.success) {
      throw new BadRequestException({
        code: "INVALID_REQUIREMENT_REQUEST",
        issues: parsedRequest.error.issues.map((issue) => ({
          field: issue.path.join(".") || "$",
          message: issue.message
        }))
      });
    }

    const request = parsedRequest.data;
    await this.assertRequestResources(request);
    const effectiveContext = isolateFreshProductContext(context);
    const hasCurrentProductAttachments = context.currentTurn.attachments.some(
      (attachment) => attachment.role === "product_source"
    );
    const selectedModel = this.imageModels.getEnabled(request.modelId);
    const constraints = {
      maxImageCount: Math.min(4, selectedModel.maxImageCount),
      allowedAspectRatios: selectedModel.supportedAspectRatios
    };
    const deadline = Date.now() + this.environment.REQUIREMENT_AI_TURN_BUDGET_MS;
    const attemptSequence = { next: 1 };
    const firstCall = await this.callAi({
      trace,
      phase: "resolve",
      deadline,
      attemptSequence,
      operation: (options) =>
        this.requirementAi.resolveConversation(effectiveContext, constraints, images, options)
    });
    const rawOutput = firstCall.rawOutput;
    const firstContract = normalizeConversationRequirementAiOutput({
      rawOutput,
      currentRequirement: effectiveContext.sessionState.currentRequirement,
      defaults: {
        userText: request.userText,
        imageCount: request.imageSettings.imageCount ?? 1,
        aspectRatio: request.imageSettings.aspectRatio ?? constraints.allowedAspectRatios[0]!,
        uiImageCount: request.imageSettings.imageCount,
        sourceImageCount: images.filter((image) => image.role === "product_source").length
      },
      availableImageKeys: images.map((image) => image.key),
      availableTargetImageKeys: editableImageKeys(images),
      availableProductSourceImageKeys: images
        .filter((image) => image.role === "product_source")
        .map((image) => image.key),
      availableReferenceImageKeys: images
        .filter((image) => image.role === "user_reference")
        .map((image) => image.key),
      availableProductEntityIdsByImageKey: Object.fromEntries(
        images.map((image) => [image.key, image.productEntities.map((entity) => entity.id)])
      ),
      hasCurrentProductAttachments,
      maxOutputCount: constraints.maxImageCount
    });
    await this.completeAttempt(firstCall, firstContract, rawOutput);
    let normalized = firstContract;
    if (!normalized.success) {
      const validationIssues = normalized.issues;
      const repairedCall = await this.callAi({
        trace,
        phase: "repair",
        deadline,
        attemptSequence,
        operation: (options) =>
          this.requirementAi.repairConversation(
            {
              originalInput: effectiveContext,
              previousOutput: rawOutput,
              validationIssues,
              constraints,
              images
            },
            options
          )
      });
      const repairedRawOutput = repairedCall.rawOutput;
      normalized = normalizeConversationRequirementAiOutput({
        rawOutput: repairedRawOutput,
        currentRequirement: effectiveContext.sessionState.currentRequirement,
        defaults: {
          userText: request.userText,
          imageCount: request.imageSettings.imageCount ?? 1,
          aspectRatio: request.imageSettings.aspectRatio ?? constraints.allowedAspectRatios[0]!,
          uiImageCount: request.imageSettings.imageCount,
          sourceImageCount: images.filter((image) => image.role === "product_source").length
        },
        availableImageKeys: images.map((image) => image.key),
        availableTargetImageKeys: editableImageKeys(images),
        availableProductSourceImageKeys: images
          .filter((image) => image.role === "product_source")
          .map((image) => image.key),
        availableReferenceImageKeys: images
          .filter((image) => image.role === "user_reference")
          .map((image) => image.key),
        availableProductEntityIdsByImageKey: Object.fromEntries(
          images.map((image) => [image.key, image.productEntities.map((entity) => entity.id)])
        ),
        hasCurrentProductAttachments,
        maxOutputCount: constraints.maxImageCount
      });
      await this.completeAttempt(repairedCall, normalized, repairedRawOutput);
    }
    if (!normalized.success) {
      throw new BadGatewayException({
        code: "INVALID_CONVERSATION_REQUIREMENT_AI_OUTPUT",
        issues: normalized.issues
      });
    }
    if (normalized.data.result === null) {
      return {
        request,
        output: normalized.data,
        aiModel: getConversationRequirementConfiguration(this.environment).model,
        promptVersion: CONVERSATION_REQUIREMENT_PROMPT_VERSION
      };
    }
    const validation = this.validator.validate(normalized.data.result, constraints);
    if (!validation.success) {
      throw new BadGatewayException({
        code: "INVALID_CONVERSATION_REQUIREMENT_AI_OUTPUT",
        issues: validation.issues
      });
    }
    return {
      request,
      output: { ...normalized.data, result: validation.data },
      aiModel: getConversationRequirementConfiguration(this.environment).model,
      promptVersion: CONVERSATION_REQUIREMENT_PROMPT_VERSION
    };
  }

  public async findById(id: string): Promise<ResolveRequirementResponse> {
    const run = await this.requirementRuns.findById(id);
    if (!run || run.userId !== this.environment.LOCAL_USER_ID) {
      throw new NotFoundException({ code: "REQUIREMENT_RUN_NOT_FOUND" });
    }
    return { requirementRunId: run.id, result: run.result };
  }

  private async callAi(input: {
    trace: { sessionId: string; sourceMessageId: string } | undefined;
    phase: RequirementAiAttemptPhase;
    deadline: number;
    attemptSequence: { next: number };
    operation: (options: { timeoutMs: number }) => Promise<unknown>;
  }): Promise<{ rawOutput: unknown; attemptId: string | null; startedAt: number }> {
    const configuration = getConversationRequirementConfiguration(this.environment);
    let phaseAttemptNumber = 0;
    while (true) {
      phaseAttemptNumber += 1;
      const remainingMs = input.deadline - Date.now();
      if (remainingMs <= 0) {
        throw this.toHttpException(
          new RequirementAiError(
            "REQUIREMENT_AI_TIMEOUT",
            "request",
            false,
            504,
            "本次需求理解等待时间过长",
            { budgetMs: this.environment.REQUIREMENT_AI_TURN_BUDGET_MS }
          )
        );
      }
      const attemptNumber = input.attemptSequence.next++;
      const startedAt = Date.now();
      const attemptId = input.trace
        ? await this.requirementAiAttempts.begin({
            ...input.trace,
            attemptNumber,
            phase: input.phase,
            phaseAttemptNumber,
            aiModel: configuration.model,
            promptVersion: CONVERSATION_REQUIREMENT_PROMPT_VERSION,
            contractVersion: CONVERSATION_REQUIREMENT_CONTRACT_VERSION,
            startedAt: new Date(startedAt)
          })
        : null;
      try {
        const rawOutput = await input.operation({
          timeoutMs: Math.min(configuration.timeoutMs, remainingMs)
        });
        return { rawOutput, attemptId, startedAt };
      } catch (error) {
        const normalized = normalizeRequirementAiError(error);
        const completedAt = Date.now();
        if (attemptId) {
          await this.requirementAiAttempts
            .fail({
              id: attemptId,
              errorCode: normalized.code,
              errorPhase: normalized.phase,
              errorDetails: normalized.diagnostics,
              completedAt: new Date(completedAt),
              durationMs: completedAt - startedAt
            })
            .catch((persistenceError: unknown) => {
              this.logger.error(
                `需求 AI 失败调用记录写入失败: ${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`
              );
            });
        }
        const nextRemainingMs = input.deadline - completedAt;
        if (
          phaseAttemptNumber === 1 &&
          shouldRetryRequirementAi(normalized, completedAt - startedAt, nextRemainingMs)
        ) {
          await delay(Math.min(500, Math.max(1, nextRemainingMs - 1)));
          continue;
        }
        throw this.toHttpException(normalized);
      }
    }
  }

  private async completeAttempt(
    call: { attemptId: string | null; startedAt: number },
    validation: ReturnType<typeof normalizeConversationRequirementAiOutput>,
    rawOutput?: unknown
  ): Promise<void> {
    if (!call.attemptId) return;
    await this.requirementAiAttempts.complete({
      id: call.attemptId,
      status: validation.success ? "contract_valid" : "contract_invalid",
      rawOutput: rawOutput ?? validation,
      validationIssues: validation.success ? [] : validation.issues,
      completedAt: new Date(),
      durationMs: Date.now() - call.startedAt
    });
  }

  private toHttpException(error: RequirementAiError): Error {
    const response = { code: error.code, message: error.publicMessage };
    if (error.code === "REQUIREMENT_AI_TIMEOUT") return new GatewayTimeoutException(response);
    if (error.code === "REQUIREMENT_AI_RATE_LIMITED") {
      return new HttpException(response, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (
      error.code === "REQUIREMENT_AI_NOT_CONFIGURED" ||
      error.code === "REQUIREMENT_AI_AUTH_FAILED" ||
      error.code === "REQUIREMENT_AI_CAPABILITY_UNSUPPORTED" ||
      error.code === "REQUIREMENT_AI_SERVICE_UNAVAILABLE"
    ) {
      return new ServiceUnavailableException(response);
    }
    return new BadGatewayException(response);
  }

  private async assertRequestResources(request: ResolveRequirementRequest): Promise<void> {
    await this.projects.assertOwned(request.projectId);
    const assetIds = requestAssetIds(request);
    await this.authorization.assertAccess({
      userId: this.environment.LOCAL_USER_ID,
      projectId: request.projectId,
      assetIds
    });
    await this.mediaAssets.getOwnedImages(assetIds, request.projectId);
    await this.mediaAssets.assertProductAvailableIds(assetIds);
  }
}

function editableImageKeys(images: ConversationRequirementImage[]): string[] {
  return images
    .filter((image) => ["edit_base", "generated_result", "selected_result"].includes(image.role))
    .map((image) => image.key);
}

function requestAssetIds(request: ResolveRequirementRequest): string[] {
  return [
    ...new Set([
      ...request.productImageIds,
      ...request.referenceImageIds,
      ...(request.editBaseImageId ? [request.editBaseImageId] : []),
      ...(request.deliverySettings.watermark.assetId
        ? [request.deliverySettings.watermark.assetId]
        : [])
    ])
  ];
}

function shouldRetryRequirementAi(
  error: RequirementAiError,
  durationMs: number,
  remainingMs: number
): boolean {
  if (!error.retryable || remainingMs <= 1_000 || durationMs > 30_000) return false;
  return (
    error.code === "REQUIREMENT_AI_RATE_LIMITED" ||
    error.code === "REQUIREMENT_AI_SERVICE_UNAVAILABLE"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isolateFreshProductContext(
  context: ConversationRequirementContext
): ConversationRequirementContext {
  const currentProducts = context.currentTurn.attachments.filter(
    (attachment) => attachment.role === "product_source"
  );
  const editsExistingImage = context.currentTurn.attachments.some(
    (attachment) => attachment.role === "edit_base"
  );
  if (currentProducts.length === 0 || editsExistingImage) return context;
  return {
    ...context,
    sessionState: {
      ...context.sessionState,
      activeProductAssetIds: currentProducts.map((attachment) => attachment.assetId),
      editBaseAssetId: null,
      currentGenerationPlan: null,
      currentRequirement: null,
      unresolvedQuestions: [],
      fieldSources: {}
    }
  };
}
