import { UnrecoverableError, type Job } from "bullmq";

import {
  IMAGE_GENERATION_JOB_NAME,
  IMAGE_GENERATION_UNIT_MAX_ATTEMPTS,
  IMAGE_GENERATION_UNIT_JOB_NAME,
  imageGenerationJobDataSchema,
  imageGenerationUnitJobDataSchema,
  type ImageGenerationJobData,
  type ImageGenerationUnitJobData
} from "@chaoren/contracts";

import {
  classifyGenerationFailure,
  ImageGenerationCancelledError,
  type ImageGenerationProcessor
} from "./image-generation.processor.js";

export class ImageGenerationJobHandler {
  public constructor(private readonly processor: ImageGenerationProcessor) {}

  public async handle(
    job: Job<ImageGenerationJobData | ImageGenerationUnitJobData>
  ): Promise<{ taskId: string; unitId?: string }> {
    if (job.name === IMAGE_GENERATION_UNIT_JOB_NAME) return this.handleUnit(job);
    if (job.name !== IMAGE_GENERATION_JOB_NAME)
      throw new UnrecoverableError(`不支持的任务类型: ${job.name}`);
    const parsed = imageGenerationJobDataSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("生图队列消息格式无效");

    try {
      await this.processor.execute(parsed.data.taskId);
      return { taskId: parsed.data.taskId };
    } catch (error) {
      const classifiedFailure = classifyGenerationFailure(error);
      const attempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
      const attemptNumber = job.attemptsMade + 1;
      const invalidContentRetryExhausted =
        isRawImageContentFailure(classifiedFailure.code) &&
        attemptNumber >= IMAGE_GENERATION_UNIT_MAX_ATTEMPTS;
      const failure = invalidContentRetryExhausted
        ? { ...classifiedFailure, retryable: false }
        : classifiedFailure;
      const finalAttempt = attemptNumber >= attempts;
      if (!failure.retryable || finalAttempt) {
        await this.processor.recordFailure(parsed.data.taskId, failure);
      }
      if (!failure.retryable) throw new UnrecoverableError(failure.message);
      throw error;
    }
  }

  private async handleUnit(
    job: Job<ImageGenerationJobData | ImageGenerationUnitJobData>
  ): Promise<{ taskId: string; unitId: string }> {
    const parsed = imageGenerationUnitJobDataSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("生图单元队列消息格式无效");
    const attemptNumber = job.attemptsMade + 1;
    try {
      await this.processor.executeUnit(parsed.data.taskId, parsed.data.unitId, attemptNumber);
      return { taskId: parsed.data.taskId, unitId: parsed.data.unitId };
    } catch (error) {
      if (error instanceof ImageGenerationCancelledError) {
        return { taskId: parsed.data.taskId, unitId: parsed.data.unitId };
      }
      const classifiedFailure = classifyGenerationFailure(error);
      const invalidContentRetryExhausted =
        isRawImageContentFailure(classifiedFailure.code) &&
        attemptNumber >= IMAGE_GENERATION_UNIT_MAX_ATTEMPTS;
      const failure = invalidContentRetryExhausted
        ? { ...classifiedFailure, retryable: false }
        : classifiedFailure;
      await this.processor.recordUnitAttemptFailure(parsed.data.unitId, attemptNumber, failure);
      const configuredAttempts =
        typeof job.opts.attempts === "number"
          ? job.opts.attempts
          : IMAGE_GENERATION_UNIT_MAX_ATTEMPTS;
      const finalAttempt =
        attemptNumber >= Math.min(IMAGE_GENERATION_UNIT_MAX_ATTEMPTS, configuredAttempts);
      if (!failure.retryable || finalAttempt) {
        await this.processor.recordUnitFailure(parsed.data.unitId, failure);
      }
      if (!failure.retryable) throw new UnrecoverableError(failure.message);
      throw error;
    }
  }
}

function isRawImageContentFailure(code: string): boolean {
  return [
    "IMAGE_DOWNLOAD_RETURNED_NON_IMAGE",
    "IMAGE_BINARY_SIGNATURE_INVALID",
    "IMAGE_MIME_TYPE_MISMATCH",
    "IMAGE_DECODE_FAILED",
    "INVALID_GENERATED_IMAGE_SIZE"
  ].includes(code);
}
