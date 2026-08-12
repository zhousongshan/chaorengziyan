import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import {
  SUBJECT_CONSISTENCY_JOB_NAME,
  type Environment,
  type SubjectConsistencyJobData
} from "@chaoren/contracts";

import { ENVIRONMENT } from "../environment.js";
import type { SubjectConsistencyQueue } from "./subject-consistency-queue.port.js";

@Injectable()
export class BullMqSubjectConsistencyQueue
  implements SubjectConsistencyQueue, OnApplicationShutdown
{
  private readonly connection: Redis;
  private readonly queue: Queue<SubjectConsistencyJobData>;

  public constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {
    this.connection = new Redis(environment.REDIS_URL, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1
    });
    this.queue = new Queue<SubjectConsistencyJobData>(environment.SUBJECT_INSPECTION_QUEUE_NAME, {
      connection: this.connection
    });
  }

  public async enqueue(checkId: string, executionId?: string): Promise<void> {
    const jobId = executionId ? `${checkId}-${executionId}` : checkId;
    const existing = await this.queue.getJob(jobId);
    const state = await existing?.getState();
    if (existing && (state === "completed" || state === "failed")) {
      await existing.remove();
    }
    await this.queue.add(
      SUBJECT_CONSISTENCY_JOB_NAME,
      { schemaVersion: "1.0", checkId },
      {
        jobId,
        attempts: this.environment.SUBJECT_INSPECTION_JOB_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: this.environment.SUBJECT_INSPECTION_JOB_BACKOFF_MS
        },
        removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 50_000 }
      }
    );
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
