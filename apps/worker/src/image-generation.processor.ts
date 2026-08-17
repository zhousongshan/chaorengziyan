import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import type { Environment, ImageGenerationError } from "@chaoren/contracts";
import {
  getEnabledImageModel,
  ImageModelNotAvailableError,
  ImageProviderError,
  type ImageGenerationInput,
  type ImageGenerationPort,
  type ImageGenerationSource
} from "@chaoren/image-generation";
import type { StoragePort } from "@chaoren/storage";

import type {
  ImageGenerationTaskStore,
  WorkerExecutableUnit,
  WorkerExecutableTask,
  WorkerOutputAsset
} from "./image-generation-task.store.js";
import { WorkerTaskDataError } from "./image-generation-task.store.js";
import type { SubjectConsistencyQueuePublisher } from "./subject-consistency.queue.js";
import { SUBJECT_CONSISTENCY_WORKFLOW_VERSION } from "@chaoren/subject-consistency";
import { ImageContentValidationError, validateImageContent } from "./image-content.validator.js";
import {
  deliveryRequiresDerivedAsset,
  ImageDeliveryRenderError,
  renderDeliveryImage
} from "./image-delivery.renderer.js";

const terminalStatuses = new Set(["succeeded", "failed", "cancelled"]);
const extensionByMimeType = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

export interface GenerationFailure extends ImageGenerationError {
  retryable: boolean;
  stage?: "submission" | "polling" | "download" | "validation";
  details?: Record<string, unknown>;
}

export class ImageGenerationCancelledError extends Error {
  public constructor() {
    super("生图任务已停止");
    this.name = "ImageGenerationCancelledError";
  }
}

export class ImageGenerationProcessor {
  public constructor(
    private readonly environment: Environment,
    private readonly tasks: ImageGenerationTaskStore,
    private readonly storage: StoragePort,
    private readonly generator: ImageGenerationPort,
    private readonly subjectConsistencyQueue?: SubjectConsistencyQueuePublisher
  ) {}

  public async executeUnit(taskId: string, unitId: string, attemptNumber: number): Promise<void> {
    const currentTask = await this.tasks.load(taskId);
    if (!currentTask) {
      throw new WorkerTaskDataError("IMAGE_GENERATION_TASK_NOT_FOUND", "生图任务不存在");
    }
    if (terminalStatuses.has(currentTask.status)) return;
    const loaded = await this.tasks.loadUnit(taskId, unitId);
    if (!loaded) {
      throw new WorkerTaskDataError("IMAGE_GENERATION_UNIT_NOT_FOUND", "生图输出单元不存在");
    }
    if (loaded.unit.status && terminalStatuses.has(loaded.unit.status)) return;
    if (!(await this.tasks.claimUnit(taskId, unitId))) return;

    const previousAttempt = await this.tasks.loadPreviousFailedUnitAttempt(unitId, attemptNumber);
    const resume = resumableProviderAttempt(previousAttempt);
    const providerAttemptNumber = reusableProviderAttempt(previousAttempt) ? 1 : attemptNumber;
    const requestId = `${taskId}:${unitId}:attempt:${providerAttemptNumber}`;
    await this.tasks.startUnitAttempt(unitId, attemptNumber);
    let model;
    try {
      model = getEnabledImageModel(this.environment, loaded.task.modelId);
    } catch (error) {
      if (!(error instanceof ImageModelNotAvailableError)) throw error;
      throw new WorkerTaskDataError("IMAGE_MODEL_NOT_AVAILABLE", error.message);
    }
    const sources = await this.loadUnitSources(loaded.unit);
    const cancellation = monitorCancellation(() => this.tasks.isUnitCancelled(taskId, unitId));
    let generated;
    const providerPromise = this.generator.generate({
      requestId,
      model,
      requirement: loaded.unit.requirement,
      renderSettings: loaded.task.renderSettings,
      instruction: loaded.unit.instruction,
      sources,
      signal: cancellation.signal,
      ...(resume ? { resume } : {}),
      onProviderRequestId: (actualProviderRequestId) =>
        this.tasks.updateUnitAttemptProviderRequestId(
          unitId,
          attemptNumber,
          actualProviderRequestId
        )
    });
    try {
      generated = await Promise.race([providerPromise, cancellation.cancelled]);
    } catch (error) {
      if (error instanceof ImageGenerationCancelledError) {
        void providerPromise.then(
          () => this.tasks.markLateResultDiscarded(unitId, attemptNumber),
          () => undefined
        );
      }
      throw error;
    } finally {
      cancellation.stop();
    }
    if (generated.length !== 1) {
      throw new ImageProviderError(
        "INVALID_GENERATION_UNIT_OUTPUT_COUNT",
        "生图服务未按原子单元返回一张图片"
      );
    }
    const [output] = await this.prepareOutputs(
      loaded.task,
      generated,
      loaded.unit.sourceAssets,
      loaded.unit
    );
    if (!output) {
      throw new ImageProviderError(
        "INVALID_GENERATION_UNIT_OUTPUT_COUNT",
        "生图单元没有可保存的结果"
      );
    }
    let checkIds: string[];
    try {
      const qualitySourceAssetIds = loaded.unit.qualitySourceAssetIds ?? [];
      checkIds = await this.tasks.markUnitSucceeded(
        taskId,
        unitId,
        output,
        qualitySourceAssetIds.length > 0
          ? {
              requirementRunId: loaded.task.requirementRunId,
              sourceProductAssetIds: qualitySourceAssetIds,
              inspectionModel: this.environment.SUBJECT_INSPECTION_AI_MODEL,
              requirementModel: this.environment.REQUIREMENT_AI_MODEL,
              workflowVersion: SUBJECT_CONSISTENCY_WORKFLOW_VERSION
            }
          : undefined
      );
    } catch (error) {
      await this.storage.delete(output.storageKey).catch(() => undefined);
      if (await this.tasks.isUnitCancelled(taskId, unitId).catch(() => false)) {
        await this.tasks.markLateResultDiscarded(unitId, attemptNumber).catch(() => undefined);
        throw new ImageGenerationCancelledError();
      }
      throw error;
    }
    await this.tasks.completeUnitAttempt(unitId, attemptNumber).catch(() => undefined);
    await this.enqueueSubjectChecks(checkIds, taskId);
  }

  public async recordUnitAttemptFailure(
    unitId: string,
    attemptNumber: number,
    failure: GenerationFailure
  ): Promise<void> {
    await this.tasks.failUnitAttempt(unitId, attemptNumber, {
      code: failure.code,
      message: userSafeGenerationMessage(failure.code),
      ...(failure.stage ? { stage: failure.stage } : {}),
      ...(failure.details ? { details: failure.details } : {})
    });
  }

  public async recordUnitFailure(unitId: string, failure: GenerationFailure): Promise<void> {
    await this.tasks.markUnitFailed(unitId, {
      code: failure.code,
      message: userSafeGenerationMessage(failure.code)
    });
  }

  private async loadUnitSources(unit: WorkerExecutableUnit): Promise<ImageGenerationSource[]> {
    return this.loadSourceAssets(unit.sourceAssets);
  }

  private async loadSourceAssets(
    sourceAssets: WorkerExecutableTask["sourceAssets"]
  ): Promise<ImageGenerationSource[]> {
    const sources: ImageGenerationSource[] = [];
    for (const asset of sourceAssets) {
      sources.push({
        assetId: asset.id,
        role: asset.role,
        mimeType: asset.mimeType,
        content: await streamToBuffer(await this.storage.read(asset.storageKey))
      });
    }
    return sources;
  }

  private async enqueueSubjectChecks(checkIds: string[], executionId: string): Promise<void> {
    if (!this.subjectConsistencyQueue) return;
    for (const checkId of checkIds) {
      try {
        await this.subjectConsistencyQueue.enqueue(checkId, executionId);
        await this.tasks.markSubjectCheckEnqueued(checkId);
      } catch {
        // The transactional outbox keeps the check pending for a later delivery.
      }
    }
  }

  private async prepareOutputs(
    task: WorkerExecutableTask,
    images: Awaited<ReturnType<ImageGenerationPort["generate"]>>,
    sourceAssets: WorkerExecutableTask["sourceAssets"],
    unit?: WorkerExecutableUnit
  ): Promise<WorkerOutputAsset[]> {
    const outputs: WorkerOutputAsset[] = [];
    const productSources = sourceAssets.filter((source) => source.role === "product");
    const qualitySourceAssetIds =
      unit?.qualitySourceAssetIds ?? productSources.map((source) => source.id);
    const deliverDirectly = qualitySourceAssetIds.length === 0;
    try {
      for (const image of images) {
        if (
          image.content.length === 0 ||
          image.content.length > this.environment.MAX_GENERATED_IMAGE_BYTES
        ) {
          throw new ImageProviderError(
            "INVALID_GENERATED_IMAGE_SIZE",
            "生图模型返回的图片大小无效"
          );
        }
        let outputContent = image.content;
        let outputMimeType = image.mimeType;
        if (
          deliverDirectly &&
          deliveryRequiresDerivedAsset(image.mimeType, task.deliverySettings)
        ) {
          const rendered = await renderDeliveryImage({
            source: { content: image.content, mimeType: image.mimeType },
            settings: task.deliverySettings
          });
          outputContent = rendered.content;
          outputMimeType = rendered.mimeType;
        }
        if (
          outputContent.length === 0 ||
          outputContent.length > this.environment.MAX_GENERATED_IMAGE_BYTES
        ) {
          throw new ImageDeliveryRenderError("交付图片大小超过系统限制");
        }
        let validated;
        try {
          validated = await validateImageContent({
            content: outputContent,
            declaredMimeType: outputMimeType
          });
        } catch (error) {
          if (error instanceof ImageContentValidationError) {
            throw new ImageProviderError("INVALID_GENERATED_IMAGE_CONTENT", error.message);
          }
          throw error;
        }
        const id = randomUUID();
        const extension = extensionByMimeType.get(validated.mimeType) ?? "png";
        const storageKey = `generated/${task.projectId}/${task.id}/${id}.${extension}`;
        const stored = await this.storage.put(storageKey, Readable.from([outputContent]));
        outputs.push({
          id,
          userId: task.userId,
          projectId: task.projectId,
          storageKey: stored.key,
          mimeType: validated.mimeType,
          byteSize: stored.byteSize,
          originalFileName: `${id}.${extension}`,
          createdAt: new Date(),
          ...(unit
            ? {
                unitId: unit.id,
                unitPosition: unit.position,
                sourceProductAssetIds: qualitySourceAssetIds
              }
            : {})
        });
      }
      return outputs;
    } catch (error) {
      await Promise.all(
        outputs.map((output) => this.storage.delete(output.storageKey).catch(() => undefined))
      );
      throw error;
    }
  }
}

function monitorCancellation(check: () => Promise<boolean>): {
  signal: AbortSignal;
  cancelled: Promise<never>;
  stop: () => void;
} {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let rejectCancelled!: (error: ImageGenerationCancelledError) => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject;
  });
  const poll = async () => {
    if (stopped) return;
    try {
      if (await check()) {
        stopped = true;
        rejectCancelled(new ImageGenerationCancelledError());
        controller.abort();
        return;
      }
    } catch {
      // A transient database read failure must not crash the worker process.
    } finally {
      if (!stopped) timer = setTimeout(() => void poll(), 500);
    }
  };
  timer = setTimeout(() => void poll(), 500);
  return {
    signal: controller.signal,
    cancelled,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}

export function classifyGenerationFailure(error: unknown): GenerationFailure {
  if (error instanceof WorkerTaskDataError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  if (error instanceof ImageProviderError) {
    const explicitlyRetryable = error.details.retryable;
    return {
      code: error.code,
      message: error.message,
      retryable:
        explicitlyRetryable ??
        ![
          "IMAGE_PROVIDER_NOT_CONFIGURED",
          "IMAGE_PROVIDER_NOT_SUPPORTED",
          "IMAGE_DOWNLOAD_URL_REJECTED",
          "IMAGE_DOWNLOAD_REDIRECT_LIMIT",
          "INVALID_IMAGE_RESUME_REQUEST"
        ].includes(error.code),
      ...(error.details.stage ? { stage: error.details.stage } : {}),
      details: providerErrorDetails(error)
    };
  }
  if (error instanceof ImageDeliveryRenderError) {
    return {
      code: "DELIVERY_IMAGE_PROCESSING_FAILED",
      message: userSafeGenerationMessage("DELIVERY_IMAGE_PROCESSING_FAILED"),
      retryable: true
    };
  }
  return { code: "IMAGE_GENERATION_FAILED", message: "图片生成失败", retryable: true };
}

function resumableProviderAttempt(
  attempt:
    | {
        providerRequestId?: string;
        failureStage?: "submission" | "polling" | "download" | "validation";
      }
    | undefined
): ImageGenerationInput["resume"] {
  if (
    !attempt?.providerRequestId ||
    (attempt.failureStage !== "polling" && attempt.failureStage !== "download")
  ) {
    return undefined;
  }
  return {
    providerRequestId: attempt.providerRequestId,
    failedStage: attempt.failureStage
  };
}

function reusableProviderAttempt(
  attempt:
    | {
        providerRequestId?: string;
        failureStage?: "submission" | "polling" | "download" | "validation";
      }
    | undefined
): boolean {
  return Boolean(
    attempt &&
    (attempt.failureStage === "submission" ||
      (attempt.providerRequestId &&
        (attempt.failureStage === "polling" || attempt.failureStage === "download")))
  );
}

function providerErrorDetails(error: ImageProviderError): Record<string, unknown> {
  const details: Record<string, unknown> = {
    retryable: error.details.retryable ?? null
  };
  if (error.details.stage) details.stage = error.details.stage;
  if (error.details.diagnostics) details.diagnostics = error.details.diagnostics;
  const cause = serializeError(error.details.cause ?? error.cause);
  if (cause) details.cause = cause;
  return details;
}

function serializeError(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof Error)) return undefined;
  const serialized: Record<string, unknown> = { name: error.name, message: error.message };
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  if (code) serialized.code = code;
  const cause = error.cause instanceof Error ? serializeError(error.cause) : undefined;
  if (cause) serialized.cause = cause;
  return serialized;
}

function userSafeGenerationMessage(code: string): string {
  switch (code) {
    case "IMAGE_PROVIDER_NOT_CONFIGURED":
      return "生图服务尚未配置，请联系管理员";
    case "IMAGE_PROVIDER_AUTH_FAILED":
    case "IMAGE_PROVIDER_ACCESS_DENIED":
      return "生图服务鉴权或访问权限异常，请联系管理员";
    case "IMAGE_PROVIDER_QUOTA_EXHAUSTED":
      return "生图服务额度不足，请联系管理员充值后重新生成";
    case "IMAGE_PROVIDER_NOT_SUPPORTED":
    case "IMAGE_MODEL_NOT_AVAILABLE":
      return "所选生图模型当前不可用，请更换模型或联系管理员";
    case "IMAGE_DOWNLOAD_FAILED":
      return "生图已完成，但结果下载失败，请稍后重试";
    case "IMAGE_DOWNLOAD_URL_REJECTED":
    case "IMAGE_DOWNLOAD_REDIRECT_LIMIT":
      return "生图结果地址无法通过安全校验，请重新生成";
    case "INVALID_IMAGE_RESUME_REQUEST":
      return "上一次生图任务无法安全恢复，请重新生成";
    case "INVALID_GENERATION_UNIT_OUTPUT_COUNT":
      return "生图服务返回的图片数量无效，请重新生成";
    case "INVALID_SOURCE_PRODUCT_IMAGE":
    case "IMAGE_DECODE_FAILED":
    case "IMAGE_MIME_TYPE_MISMATCH":
      return "商品图片无法读取，请更换图片后重试";
    case "IMAGE_BINARY_SIGNATURE_INVALID":
    case "IMAGE_DOWNLOAD_RETURNED_NON_IMAGE":
    case "INVALID_GENERATED_IMAGE_SIZE":
    case "INVALID_GENERATED_CANDIDATE":
      return "生图服务返回的图片无效，请重新生成";
    case "DELIVERY_IMAGE_PROCESSING_FAILED":
      return "图片已生成，但最终格式或交付处理失败，请重新尝试";
    default:
      return "图片生成失败，请稍后重试";
  }
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
