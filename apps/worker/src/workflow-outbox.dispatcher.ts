import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import { workflowEvents, type DatabaseConnection } from "@chaoren/database";

import type { ImageGenerationQueuePublisher } from "./image-generation.queue.js";
import type { SubjectConsistencyQueuePublisher } from "./subject-consistency.queue.js";
import type { ImageGenerationTaskStore } from "./image-generation-task.store.js";
import type { SubjectConsistencyTaskStore } from "./subject-consistency-task.store.js";

const dispatchableEventTypes = ["generation.unit.enqueue", "subject.check.enqueue"] as const;
const MAX_PUBLISH_ATTEMPTS = 12;

interface PendingDispatch {
  eventId: string;
  eventType: string;
  taskId?: string;
  unitId?: string;
  checkId?: string;
}

export class WorkflowOutboxDispatcher {
  private dispatching = false;

  public constructor(
    private readonly connection: DatabaseConnection,
    private readonly imageQueue: ImageGenerationQueuePublisher,
    private readonly subjectQueue: SubjectConsistencyQueuePublisher,
    private readonly imageTasks: ImageGenerationTaskStore,
    private readonly subjectTasks: SubjectConsistencyTaskStore
  ) {}

  public async dispatchPending(limit = 100): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const events = await this.claim(limit);
      for (const event of events) {
        try {
          await this.publish(event);
          await this.markPublished(event.eventId);
        } catch (error) {
          await this.markFailed(
            event.eventId,
            error instanceof Error ? error.message : "队列投递失败"
          );
          if ((await this.publishAttempts(event.eventId)) >= MAX_PUBLISH_ATTEMPTS) {
            await this.markTerminal(event);
          }
        }
      }
    } finally {
      this.dispatching = false;
    }
  }

  public async markEntityPublished(eventType: string, entityId: string): Promise<void> {
    await this.connection.db
      .update(workflowEvents)
      .set({ publishedAt: new Date(), lastError: null })
      .where(
        and(
          eq(workflowEvents.eventType, eventType),
          eq(workflowEvents.entityId, entityId),
          isNull(workflowEvents.publishedAt)
        )
      );
  }

  private async claim(limit: number): Promise<PendingDispatch[]> {
    return this.connection.db.transaction(async (transaction) => {
      const rows = await transaction
        .select({
          eventId: workflowEvents.id,
          eventType: workflowEvents.eventType,
          payload: workflowEvents.payload
        })
        .from(workflowEvents)
        .where(
          and(
            isNull(workflowEvents.publishedAt),
            isNull(workflowEvents.terminalAt),
            lte(workflowEvents.availableAt, new Date()),
            sql`${workflowEvents.publishAttempts} < ${MAX_PUBLISH_ATTEMPTS}`,
            inArray(workflowEvents.eventType, [...dispatchableEventTypes])
          )
        )
        .orderBy(asc(workflowEvents.createdAt))
        .limit(limit)
        .for("update", { skipLocked: true });
      if (rows.length === 0) return [];
      await transaction
        .update(workflowEvents)
        .set({
          availableAt: new Date(Date.now() + 30_000),
          publishAttempts: sql`${workflowEvents.publishAttempts} + 1`
        })
        .where(
          inArray(
            workflowEvents.id,
            rows.map((row) => row.eventId)
          )
        );
      return rows.map((row) => {
        const payload = asRecord(row.payload);
        return {
          eventId: row.eventId,
          eventType: row.eventType,
          ...(typeof payload?.taskId === "string" ? { taskId: payload.taskId } : {}),
          ...(typeof payload?.unitId === "string" ? { unitId: payload.unitId } : {}),
          ...(typeof payload?.checkId === "string" ? { checkId: payload.checkId } : {})
        };
      });
    });
  }

  private async publish(event: PendingDispatch): Promise<void> {
    if (event.eventType === "generation.unit.enqueue" && event.taskId && event.unitId) {
      if (!this.imageQueue.enqueueUnit) throw new Error("生图单元队列未配置");
      await this.imageQueue.enqueueUnit(event.taskId, event.unitId);
      return;
    }
    if (event.eventType === "subject.check.enqueue" && event.checkId) {
      await this.subjectQueue.enqueue(event.checkId);
      return;
    }
    throw new Error(`工作流事件载荷无效: ${event.eventType}`);
  }

  private async markPublished(eventId: string): Promise<void> {
    await this.connection.db
      .update(workflowEvents)
      .set({ publishedAt: new Date(), lastError: null })
      .where(and(eq(workflowEvents.id, eventId), isNull(workflowEvents.publishedAt)));
  }

  private async markFailed(eventId: string, error: string): Promise<void> {
    await this.connection.db
      .update(workflowEvents)
      .set({ lastError: error.slice(0, 2_000), availableAt: new Date(Date.now() + 5_000) })
      .where(and(eq(workflowEvents.id, eventId), isNull(workflowEvents.publishedAt)));
  }

  private async publishAttempts(eventId: string): Promise<number> {
    const [row] = await this.connection.db
      .select({ attempts: workflowEvents.publishAttempts })
      .from(workflowEvents)
      .where(eq(workflowEvents.id, eventId))
      .limit(1);
    return row?.attempts ?? MAX_PUBLISH_ATTEMPTS;
  }

  private async markTerminal(event: PendingDispatch): Promise<void> {
    await this.connection.db
      .update(workflowEvents)
      .set({
        terminalAt: new Date(),
        publishedAt: new Date(),
        lastError: "队列投递失败，已达到自动恢复上限"
      })
      .where(and(eq(workflowEvents.id, event.eventId), isNull(workflowEvents.terminalAt)));
    if (event.eventType === "generation.unit.enqueue" && event.taskId && event.unitId) {
      await this.imageTasks.markQueueDeliveryFailed(event.unitId);
    } else if (event.eventType === "subject.check.enqueue" && event.checkId) {
      await this.subjectTasks.markExecutionFailed(event.checkId, {
        code: "SUBJECT_CONSISTENCY_QUEUE_UNAVAILABLE",
        message: "图片检查队列投递失败，已达到自动恢复上限"
      });
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
