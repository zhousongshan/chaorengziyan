import { Queue } from "bullmq";
import { Redis } from "ioredis";

import {
  SUBJECT_CONSISTENCY_JOB_NAME,
  type Environment,
  type SubjectConsistencyJobData
} from "@chaoren/contracts";

export interface SubjectConsistencyQueuePublisher {
  enqueue(checkId: string, executionId?: string): Promise<void>;
  close(): Promise<void>;
}

export class BullMqSubjectConsistencyQueuePublisher implements SubjectConsistencyQueuePublisher {
  private readonly connection: Redis;
  private readonly queue: Queue<SubjectConsistencyJobData>;

  public constructor(private readonly environment: Environment) {
    this.connection = new Redis(environment.REDIS_URL, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1
    });
    this.queue = new Queue(environment.SUBJECT_INSPECTION_QUEUE_NAME, {
      connection: this.connection
    });
  }

  public async enqueue(checkId: string): Promise<void> {
    // A check has one resumable state machine. Reusing its id prevents recovery and
    // outbox delivery from executing the same phase concurrently.
    const jobId = checkId;
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

  public async close(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
