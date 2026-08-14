import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

import {
  CONVERSATION_TURN_JOB_NAME,
  type ConversationTurnJobData,
  type Environment
} from "@chaoren/contracts";

import { ENVIRONMENT } from "../environment.js";
import { CONVERSATION_REPOSITORY, type ConversationRepository } from "./conversation.repository.js";
import { ConversationService } from "./conversation.service.js";
import type { ConversationTurnQueue } from "./conversation-turn.queue.js";

@Injectable()
export class BullMqConversationTurnQueue
  implements ConversationTurnQueue, OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(BullMqConversationTurnQueue.name);
  private readonly queueConnection: Redis;
  private readonly workerConnection: Redis;
  private readonly queue: Queue<ConversationTurnJobData>;
  private worker?: Worker<ConversationTurnJobData>;
  private dispatchTimer?: NodeJS.Timeout;
  private dispatching = false;

  public constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversations: ConversationRepository,
    private readonly moduleRef: ModuleRef
  ) {
    this.queueConnection = createRedisConnection(environment.REDIS_URL, 1);
    this.workerConnection = createRedisConnection(environment.REDIS_URL, null);
    this.queue = new Queue<ConversationTurnJobData>(environment.CONVERSATION_QUEUE_NAME, {
      connection: this.queueConnection
    });
  }

  public async onModuleInit(): Promise<void> {
    this.worker = new Worker<ConversationTurnJobData>(
      this.environment.CONVERSATION_QUEUE_NAME,
      async (job) => {
        const conversations = this.moduleRef.get(ConversationService, { strict: false });
        await conversations.processTurn(job.data.messageId);
      },
      { connection: this.workerConnection, concurrency: 1 }
    );
    this.worker.on("error", (error) => this.logger.error(error.message, error.stack));
    await this.dispatchPendingTurns();
    this.dispatchTimer = setInterval(
      () => void this.dispatchPendingTurns(),
      this.environment.CONVERSATION_DISPATCH_INTERVAL_MS
    );
    this.dispatchTimer.unref();
  }

  public onModuleDestroy(): void {
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
  }

  public async enqueue(messageId: string): Promise<void> {
    try {
      const existing = await this.queue.getJob(messageId);
      const state = await existing?.getState();
      if (existing && (state === "completed" || state === "failed")) await existing.remove();
      if (!existing || state === "completed" || state === "failed") {
        await this.queue.add(
          CONVERSATION_TURN_JOB_NAME,
          { schemaVersion: "1.0", messageId },
          {
            jobId: messageId,
            attempts: 1,
            removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
            removeOnFail: { age: 7 * 24 * 60 * 60, count: 50_000 }
          }
        );
      }
      await this.conversations.recordTurnEnqueueAttempt(messageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "会话队列不可用";
      await this.conversations.recordTurnEnqueueAttempt(messageId, message).catch(() => undefined);
      throw error;
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.workerConnection.disconnect();
    this.queueConnection.disconnect();
  }

  private async dispatchPendingTurns(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const messageIds = await this.conversations.findDispatchableTurnMessageIds({
        now: new Date().toISOString(),
        maxAttempts: this.environment.CONVERSATION_TURN_MAX_ATTEMPTS,
        maxEnqueueAttempts: this.environment.CONVERSATION_TURN_MAX_ENQUEUE_ATTEMPTS,
        limit: 100
      });
      await Promise.allSettled(messageIds.map((messageId) => this.enqueue(messageId)));
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : "会话待投递任务扫描失败");
    } finally {
      this.dispatching = false;
    }
  }
}

function createRedisConnection(url: string, maxRetriesPerRequest: number | null): Redis {
  return new Redis(url, { enableReadyCheck: false, maxRetriesPerRequest });
}
