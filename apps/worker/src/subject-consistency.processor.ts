import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import type { StoragePort } from "@chaoren/storage";
import {
  subjectInspectionResultSchema,
  subjectRequirementReconciliationSchema,
  type Environment,
  type FinalRequirement,
  type SubjectInspectionResult,
  type SubjectRequirementReconciliation
} from "@chaoren/contracts";
import {
  SUBJECT_INSPECTION_PROMPT_VERSION,
  SubjectConsistencyConfigurationError,
  SubjectConsistencyProviderError,
  type SubjectConsistencyPort,
  type SubjectRequirementReconcilerPort
} from "@chaoren/subject-consistency";

import {
  SubjectConsistencyTaskDataError,
  type SubjectConsistencyTaskStore,
  type WorkerSubjectConsistencyTask
} from "./subject-consistency-task.store.js";
import type { ImageGenerationQueuePublisher } from "./image-generation.queue.js";
import { ImageContentValidationError, validateImageContent } from "./image-content.validator.js";
import {
  deliveryRequiresDerivedAsset,
  ImageDeliveryRenderError,
  renderDeliveryImage
} from "./image-delivery.renderer.js";

const terminalStatuses = new Set(["completed", "source_unusable", "execution_failed", "cancelled"]);

interface LoadedInspectionImage {
  content: Buffer;
  mimeType: string;
}

export interface SubjectConsistencyFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export class SubjectConsistencyProcessor {
  public constructor(
    private readonly environment: Environment,
    private readonly tasks: SubjectConsistencyTaskStore,
    private readonly storage: StoragePort,
    private readonly inspector: SubjectConsistencyPort,
    private readonly requirementReconciler: SubjectRequirementReconcilerPort,
    private readonly imageGenerationQueue?: ImageGenerationQueuePublisher
  ) {}

  public async execute(checkId: string): Promise<void> {
    const task = await this.tasks.load(checkId);
    if (!task) {
      throw new SubjectConsistencyTaskDataError(
        "SUBJECT_CONSISTENCY_CHECK_NOT_FOUND",
        "主体质检任务不存在"
      );
    }
    if (terminalStatuses.has(task.status)) return;
    if (!(await this.tasks.claim(checkId))) {
      throw new SubjectConsistencyTaskDataError(
        "INVALID_SUBJECT_CHECK_TRANSITION",
        "主体质检任务无法进入运行状态"
      );
    }

    const cancellation = monitorSubjectCancellation(() => this.tasks.isCancelled(checkId));
    try {
      const images = await this.loadImages(task);
      let first = task.attempts.find((attempt) => attempt.round === 1)?.result;
      if (!first) {
        first = await this.inspect(
          task,
          task.originalRequirement,
          1,
          images.sourceProducts,
          images.originalCandidate,
          cancellation.signal
        );
        cancellation.signal.throwIfAborted();
        await this.tasks.saveAttempt(
          checkId,
          1,
          task.originalRequirement,
          first,
          this.environment.SUBJECT_INSPECTION_AI_MODEL,
          SUBJECT_INSPECTION_PROMPT_VERSION
        );
      }

      if (first.verdict === "passed") {
        await this.completePassed(
          task,
          task.generatedCandidate,
          images.originalCandidate,
          first.summary
        );
        return;
      }
      if (first.verdict === "source_unusable") {
        await this.tasks.markSourceUnusable(checkId, first.summary);
        return;
      }

      let reconciliation = task.reconciliation;
      if (!reconciliation) {
        reconciliation = await this.reconcile(task, first, cancellation.signal);
        cancellation.signal.throwIfAborted();
        await this.tasks.saveReconciliation(checkId, reconciliation);
      }

      const revisedRequirement = applyReconciliation(task, reconciliation);
      let finalCandidate = images.originalCandidate;
      let finalCandidateAsset = task.generatedCandidate;
      if (reconciliation.repairType === "reinforce_preservation") {
        if (!this.imageGenerationQueue) {
          throw new SubjectConsistencyTaskDataError(
            "SUBJECT_REPAIR_QUEUE_NOT_CONFIGURED",
            "主体修复生图队列未配置"
          );
        }
        if (!task.repair) {
          cancellation.signal.throwIfAborted();
          const repair = await this.tasks.createOrFindRepair(checkId, revisedRequirement);
          await this.enqueueRepair(repair.generationTaskId, repair.generationUnitId);
          return;
        }
        if (task.repair.status === "queued") {
          cancellation.signal.throwIfAborted();
          const repair = await this.tasks.createOrFindRepair(checkId, revisedRequirement);
          await this.enqueueRepair(repair.generationTaskId, repair.generationUnitId);
          return;
        }
        if (task.repair.status === "running") return;
        if (task.repair.status !== "succeeded" || !task.repair.generatedCandidate) {
          throw new SubjectConsistencyTaskDataError(
            "SUBJECT_REPAIR_GENERATION_FAILED",
            task.repair.error?.message ?? "主体修复图片生成失败"
          );
        }
        finalCandidate = {
          content: await streamToBuffer(
            await this.storage.read(task.repair.generatedCandidate.storageKey)
          ),
          mimeType: task.repair.generatedCandidate.mimeType
        };
        finalCandidateAsset = task.repair.generatedCandidate;
      }
      let final = task.attempts.find((attempt) => attempt.round === 2)?.result;
      if (!final) {
        final = await this.inspect(
          task,
          revisedRequirement,
          2,
          images.sourceProducts,
          finalCandidate,
          cancellation.signal
        );
        cancellation.signal.throwIfAborted();
        await this.tasks.saveAttempt(
          checkId,
          2,
          revisedRequirement,
          final,
          this.environment.SUBJECT_INSPECTION_AI_MODEL,
          SUBJECT_INSPECTION_PROMPT_VERSION
        );
      }

      if (final.verdict === "passed") {
        await this.completePassed(task, finalCandidateAsset, finalCandidate, final.summary);
        return;
      }
      if (final.verdict === "source_unusable") {
        await this.tasks.markSourceUnusable(checkId, final.summary);
        return;
      }
      await this.tasks.complete(
        checkId,
        "rejected",
        `${final.summary}。主体一致性检查两次未通过，请改变需求或者更换商品图片后重试。`
      );
    } finally {
      cancellation.stop();
    }
  }

  private async enqueueRepair(generationTaskId: string, generationUnitId?: string): Promise<void> {
    if (!this.imageGenerationQueue) return;
    try {
      if (!generationUnitId) throw new Error("主体修复任务缺少冻结执行单元");
      await this.imageGenerationQueue.enqueueUnit(generationTaskId, generationUnitId);
      await this.tasks.markRepairEnqueued(generationTaskId, generationUnitId);
    } catch {
      // The transactional outbox keeps the repair generation pending.
    }
  }

  public async recordFailure(checkId: string, failure: SubjectConsistencyFailure): Promise<void> {
    await this.tasks.markExecutionFailed(checkId, {
      code: failure.code,
      message: failure.message
    });
  }

  private async completePassed(
    task: WorkerSubjectConsistencyTask,
    candidateAsset: WorkerSubjectConsistencyTask["generatedCandidate"],
    candidate: LoadedInspectionImage,
    message: string
  ): Promise<void> {
    if (!deliveryRequiresDerivedAsset(candidate.mimeType, task.deliverySettings)) {
      await this.tasks.complete(task.id, "passed", message, {
        sourceAssetId: candidateAsset.id,
        assetId: candidateAsset.id
      });
      return;
    }

    const rendered = await renderDeliveryImage({
      source: candidate,
      settings: task.deliverySettings
    });
    if (
      rendered.content.length === 0 ||
      rendered.content.length > this.environment.MAX_GENERATED_IMAGE_BYTES
    ) {
      throw new ImageDeliveryRenderError("交付图片大小超过系统限制");
    }
    await validateImageContent({
      content: rendered.content,
      declaredMimeType: rendered.mimeType
    });

    const id = randomUUID();
    const storageKey = `delivered/${task.projectId}/${task.generationTaskId}/${id}.${rendered.extension}`;
    const stored = await this.storage.put(storageKey, Readable.from([rendered.content]));
    try {
      await this.tasks.complete(task.id, "passed", message, {
        sourceAssetId: candidateAsset.id,
        assetId: id,
        newAsset: {
          id,
          userId: task.userId,
          projectId: task.projectId,
          storageKey: stored.key,
          mimeType: rendered.mimeType,
          byteSize: stored.byteSize,
          originalFileName: `${id}.${rendered.extension}`,
          createdAt: new Date()
        }
      });
    } catch (error) {
      await this.storage.delete(stored.key).catch(() => undefined);
      throw error;
    }
  }

  private async inspect(
    task: WorkerSubjectConsistencyTask,
    requirement: FinalRequirement,
    round: 1 | 2,
    sourceProducts: LoadedInspectionImage[],
    generatedCandidate: LoadedInspectionImage,
    signal: AbortSignal
  ): Promise<SubjectInspectionResult> {
    const raw = await this.inspector.inspect({
      round,
      originalUserText: task.originalUserText,
      requirement,
      sourceProducts,
      subjectEntities: task.subjectEntities.map((entity) => ({
        entityKey: entity.entityKey,
        label: entity.label,
        sourceProductIndexes: entity.sourceProductIds.map((assetId) =>
          task.sourceProducts.findIndex((source) => source.id === assetId)
        )
      })),
      generatedCandidate,
      signal
    });
    let parsed = subjectInspectionResultSchema.safeParse(raw);
    if (!parsed.success && this.inspector.repairOutput) {
      const repaired = await this.inspector.repairOutput({
        rawOutput: raw,
        validationIssues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        })),
        signal
      });
      parsed = subjectInspectionResultSchema.safeParse(repaired);
    }
    if (!parsed.success) {
      throw new SubjectConsistencyProviderError(
        "INVALID_SUBJECT_INSPECTION_OUTPUT",
        parsed.error.message,
        true
      );
    }
    return parsed.data;
  }

  private async reconcile(
    task: WorkerSubjectConsistencyTask,
    result: Extract<SubjectInspectionResult, { verdict: "failed" }>,
    signal: AbortSignal
  ): Promise<SubjectRequirementReconciliation> {
    const raw = await this.requirementReconciler.reconcile({
      originalUserText: task.originalUserText,
      previousRequirement: task.originalRequirement,
      inspectionResult: result,
      signal
    });
    const parsed = subjectRequirementReconciliationSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SubjectConsistencyProviderError(
        "INVALID_SUBJECT_RECONCILIATION_OUTPUT",
        parsed.error.message,
        true
      );
    }
    return parsed.data;
  }

  private async loadImages(task: WorkerSubjectConsistencyTask): Promise<{
    sourceProducts: LoadedInspectionImage[];
    originalCandidate: LoadedInspectionImage;
  }> {
    const [sourceProducts, generatedCandidate] = await Promise.all([
      Promise.all(
        task.sourceProducts.map(async (sourceProduct) => ({
          content: await streamToBuffer(await this.storage.read(sourceProduct.storageKey)),
          mimeType: sourceProduct.mimeType
        }))
      ),
      streamToBuffer(await this.storage.read(task.generatedCandidate.storageKey))
    ]);
    for (const sourceProduct of sourceProducts) {
      await assertInspectionImage(
        sourceProduct.content,
        sourceProduct.mimeType,
        "INVALID_SOURCE_PRODUCT_IMAGE",
        "商品原图无法正常解码，请更换图片后重试"
      );
    }
    await assertInspectionImage(
      generatedCandidate,
      task.generatedCandidate.mimeType,
      "INVALID_GENERATED_CANDIDATE",
      "生图服务返回的结果不是有效图片"
    );
    return {
      sourceProducts,
      originalCandidate: {
        content: generatedCandidate,
        mimeType: task.generatedCandidate.mimeType
      }
    };
  }
}

async function assertInspectionImage(
  content: Buffer,
  mimeType: string,
  code: string,
  message: string
): Promise<void> {
  try {
    await validateImageContent({ content, declaredMimeType: mimeType });
  } catch (error) {
    if (error instanceof ImageContentValidationError) {
      throw new SubjectConsistencyTaskDataError(code, `${message}：${error.message}`);
    }
    throw error;
  }
}

export function classifySubjectConsistencyFailure(error: unknown): SubjectConsistencyFailure {
  if (error instanceof SubjectConsistencyTaskDataError) {
    return {
      code: error.code,
      message: userSafeSubjectMessage(error.code),
      retryable: false
    };
  }
  if (error instanceof SubjectConsistencyConfigurationError) {
    return {
      code: "SUBJECT_INSPECTION_NOT_CONFIGURED",
      message: userSafeSubjectMessage("SUBJECT_INSPECTION_NOT_CONFIGURED"),
      retryable: false
    };
  }
  if (error instanceof SubjectConsistencyProviderError) {
    return {
      code: error.code,
      message: userSafeSubjectMessage(error.code),
      retryable: error.retryable
    };
  }
  if (error instanceof ImageDeliveryRenderError) {
    return {
      code: "DELIVERY_IMAGE_PROCESSING_FAILED",
      message: userSafeSubjectMessage("DELIVERY_IMAGE_PROCESSING_FAILED"),
      retryable: true
    };
  }
  return {
    code: "SUBJECT_CONSISTENCY_CHECK_FAILED",
    message: userSafeSubjectMessage("SUBJECT_CONSISTENCY_CHECK_FAILED"),
    retryable: true
  };
}

function userSafeSubjectMessage(code: string): string {
  switch (code) {
    case "SUBJECT_REPAIR_QUEUE_NOT_CONFIGURED":
      return "主体修复服务尚未配置，请联系管理员";
    case "SUBJECT_REPAIR_GENERATION_FAILED":
      return "商品主体自动修复生成失败，请重新尝试";
    case "SUBJECT_CHECK_REQUIREMENT_NOT_AVAILABLE":
    case "SUBJECT_CHECK_IMAGE_NOT_AVAILABLE":
    case "QUALITY_SOURCE_IMAGE_NOT_AVAILABLE":
      return "主体检查所需的商品原图或需求已不可用，请重新选择图片后生成";
    case "SUBJECT_INSPECTION_NOT_CONFIGURED":
      return "图片检查服务尚未完成配置，请联系管理员";
    case "SUBJECT_AI_TIMEOUT":
      return "图片检查等待时间过长，请重新生成";
    case "SUBJECT_AI_RATE_LIMITED":
      return "当前图片检查请求较多，请稍后重试";
    case "SUBJECT_AI_SERVICE_UNAVAILABLE":
    case "SUBJECT_AI_REQUEST_FAILED":
      return "图片检查服务暂时不可用，请稍后重试";
    case "INVALID_SUBJECT_AI_RESPONSE":
    case "INVALID_SUBJECT_AI_JSON":
    case "EMPTY_SUBJECT_AI_RESPONSE":
      return "图片检查服务返回了无效结果，请重新生成";
    case "SOURCE_IMAGE_NOT_AVAILABLE":
      return "商品原图已不可用，请重新选择图片后生成";
    case "SUBJECT_CONSISTENCY_EXECUTION_FAILED":
    case "SUBJECT_CONSISTENCY_CHECK_FAILED":
      return "图片检查未能完成，请稍后重新生成";
    case "DELIVERY_IMAGE_PROCESSING_FAILED":
      return "图片已通过检查，但最终格式或交付处理失败，请重新尝试";
    default:
      return "图片检查未能完成，请稍后重新生成";
  }
}

function monitorSubjectCancellation(check: () => Promise<boolean>): {
  signal: AbortSignal;
  stop: () => void;
} {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const poll = async () => {
    if (stopped) return;
    try {
      if (await check()) {
        stopped = true;
        controller.abort(
          new SubjectConsistencyTaskDataError(
            "SUBJECT_CONSISTENCY_CHECK_CANCELLED",
            "主体质检任务已停止"
          )
        );
        return;
      }
    } catch {
      // A transient database read failure must not turn into a false cancellation.
    } finally {
      if (!stopped) timer = setTimeout(() => void poll(), 500);
    }
  };
  timer = setTimeout(() => void poll(), 500);
  return {
    signal: controller.signal,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}

function applyReconciliation(
  task: WorkerSubjectConsistencyTask,
  reconciliation: SubjectRequirementReconciliation
): FinalRequirement {
  const original = task.originalRequirement;
  return {
    ...original,
    mustKeep: [...new Set([...original.mustKeep, ...reconciliation.patch.addMustKeep])],
    mustAvoid: [...new Set([...original.mustAvoid, ...reconciliation.patch.addMustAvoid])]
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
