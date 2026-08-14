import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import {
  IMAGE_GENERATION_UNIT_MAX_ATTEMPTS,
  IMAGE_GENERATION_UNIT_JOB_NAME,
  imageGenerationUnitJobId,
  type Environment,
  type ImageGenerationUnitJobData
} from "@chaoren/contracts";

import { ENVIRONMENT } from "../environment.js";
import type { ImageGenerationQueue } from "./image-generation-queue.port.js";

@Injectable()
export class BullMqImageGenerationQueue implements ImageGenerationQueue, OnApplicationShutdown {
  private readonly connection: Redis;
  private readonly queue: Queue<ImageGenerationUnitJobData>;

  public constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {
    this.connection = new Redis(environment.REDIS_URL, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1
    });
    this.queue = new Queue<ImageGenerationUnitJobData>(environment.TASK_QUEUE_NAME, {
      connection: this.connection
    });
  }

  public async enqueueUnit(taskId: string, unitId: string): Promise<void> {
    const jobId = imageGenerationUnitJobId(taskId, unitId);
    const existing = await this.queue.getJob(jobId);
    const state = await existing?.getState();
    if (existing && (state === "completed" || state === "failed")) await existing.remove();
    await this.queue.add(
      IMAGE_GENERATION_UNIT_JOB_NAME,
      { schemaVersion: "2.0", taskId, unitId },
      {
        jobId,
        attempts: IMAGE_GENERATION_UNIT_MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: this.environment.IMAGE_JOB_BACKOFF_MS },
        removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 50_000 }
      }
    );
  }

  public async cancel(taskId: string, unitIds: string[]): Promise<void> {
    for (const jobId of [
      taskId,
      ...unitIds.map((unitId) => imageGenerationUnitJobId(taskId, unitId))
    ]) {
      const job = await this.queue.getJob(jobId);
      if (!job) continue;
      const state = await job.getState();
      if (["waiting", "delayed", "paused", "prioritized"].includes(state)) {
        await job.remove();
      }
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
