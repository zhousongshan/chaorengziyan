import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
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
import { RequirementAiConfigurationError } from "./requirement-ai.errors.js";
import {
  CONVERSATION_REQUIREMENT_CONTRACT_VERSION,
  normalizeConversationRequirementAiOutput
} from "./conversation-requirement-ai.contract.js";
import {
  REQUIREMENT_AI_ATTEMPT_REPOSITORY,
  type RequirementAiAttemptRepository
} from "./requirement-ai-attempt.repository.js";
import { getConversationRequirementConfiguration } from "./conversation-requirement.configuration.js";
import { CONVERSATION_REQUIREMENT_PROMPT_VERSION } from "./requirement.prompt.js";
import { RequirementResultValidator } from "./requirement-result.validator.js";
import {
  REQUIREMENT_RUN_REPOSITORY,
  type RequirementRunRepository
} from "./requirement-run.repository.js";

@Injectable()
export class RequirementService {
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
    const selectedModel = this.imageModels.getEnabled(request.modelId);
    const constraints = {
      maxImageCount: Math.min(4, selectedModel.maxImageCount),
      allowedAspectRatios: selectedModel.supportedAspectRatios
    };
    const rawOutput = await this.callAi(() =>
      this.requirementAi.resolveConversation(context, constraints, images)
    );
    const firstContract = normalizeConversationRequirementAiOutput({
      rawOutput,
      currentRequirement: context.sessionState.currentRequirement,
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
      availableProductEntityIdsByImageKey: Object.fromEntries(
        images.map((image) => [image.key, image.productEntities.map((entity) => entity.id)])
      ),
      maxOutputCount: constraints.maxImageCount
    });
    await this.saveConversationAttempt(trace, 1, rawOutput, firstContract);
    let normalized = firstContract;
    if (!normalized.success) {
      const validationIssues = normalized.issues;
      const repairedRawOutput = await this.callAi(() =>
        this.requirementAi.repairConversation({
          originalInput: context,
          previousOutput: rawOutput,
          validationIssues,
          constraints,
          images
        })
      );
      normalized = normalizeConversationRequirementAiOutput({
        rawOutput: repairedRawOutput,
        currentRequirement: context.sessionState.currentRequirement,
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
        availableProductEntityIdsByImageKey: Object.fromEntries(
          images.map((image) => [image.key, image.productEntities.map((entity) => entity.id)])
        ),
        maxOutputCount: constraints.maxImageCount
      });
      await this.saveConversationAttempt(trace, 2, repairedRawOutput, normalized);
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

  private async callAi(operation: () => Promise<unknown>): Promise<unknown> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RequirementAiConfigurationError) {
        throw new ServiceUnavailableException({
          code: "REQUIREMENT_AI_NOT_CONFIGURED",
          message: error.message
        });
      }
      throw new BadGatewayException({
        code: "REQUIREMENT_AI_REQUEST_FAILED",
        message: error instanceof Error ? error.message : "需求AI调用失败"
      });
    }
  }

  private async saveConversationAttempt(
    trace: { sessionId: string; sourceMessageId: string } | undefined,
    attemptNumber: 1 | 2,
    rawOutput: unknown,
    validation: ReturnType<typeof normalizeConversationRequirementAiOutput>
  ): Promise<void> {
    if (!trace) return;
    await this.requirementAiAttempts
      .save({
        ...trace,
        attemptNumber,
        status: validation.success ? "contract_valid" : "contract_invalid",
        rawOutput,
        validationIssues: validation.success ? [] : validation.issues,
        aiModel: getConversationRequirementConfiguration(this.environment).model,
        promptVersion: CONVERSATION_REQUIREMENT_PROMPT_VERSION,
        contractVersion: CONVERSATION_REQUIREMENT_CONTRACT_VERSION
      })
      .catch(() => undefined);
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
