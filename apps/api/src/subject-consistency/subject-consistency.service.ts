import { Inject, Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";

import {
  subjectConsistencyCheckSchema,
  type Environment,
  type SubjectConsistencyCheck,
  type SubjectConsistencyWorkflowEvent,
  type SubjectConsistencyWorkflowStatus
} from "@chaoren/contracts";

import { ENVIRONMENT } from "../environment.js";
import {
  IMAGE_GENERATION_TASK_REPOSITORY,
  type ImageGenerationTaskRepository
} from "../image-generations/image-generation-task.repository.js";
import {
  SUBJECT_CONSISTENCY_QUEUE,
  type SubjectConsistencyQueue
} from "./subject-consistency-queue.port.js";
import {
  SUBJECT_CONSISTENCY_REPOSITORY,
  type SubjectConsistencyCheckRecord,
  type SubjectConsistencyRepository
} from "./subject-consistency.repository.js";

@Injectable()
export class SubjectConsistencyService implements OnModuleInit {
  public constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(SUBJECT_CONSISTENCY_REPOSITORY)
    private readonly repository: SubjectConsistencyRepository,
    @Inject(SUBJECT_CONSISTENCY_QUEUE) private readonly queue: SubjectConsistencyQueue,
    @Inject(IMAGE_GENERATION_TASK_REPOSITORY)
    private readonly generationTasks: ImageGenerationTaskRepository
  ) {}

  public async onModuleInit(): Promise<void> {
    const ids = await this.repository.findRecoverableIds();
    for (const id of ids) await this.queue.enqueue(id);
  }

  public async findById(id: string): Promise<SubjectConsistencyCheck> {
    const record = await this.repository.findById(id);
    if (!record || record.userId !== this.environment.LOCAL_USER_ID) {
      throw new NotFoundException({ code: "SUBJECT_CONSISTENCY_CHECK_NOT_FOUND" });
    }
    return this.toResponse(record);
  }

  public async findByGenerationTaskId(taskId: string): Promise<SubjectConsistencyCheck[]> {
    await this.assertOwnedGenerationTask(taskId);
    const records = await this.repository.findByGenerationTaskId(taskId);
    return records
      .filter((record) => record.userId === this.environment.LOCAL_USER_ID)
      .map((record) => this.toResponse(record));
  }

  public async workflowEvent(taskId: string): Promise<SubjectConsistencyWorkflowEvent> {
    const task = await this.assertOwnedGenerationTask(taskId);
    const checks = (await this.repository.findByGenerationTaskId(taskId))
      .filter((record) => record.userId === this.environment.LOCAL_USER_ID)
      .map((record) => this.toResponse(record));
    const updatedAt = checks.reduce(
      (latest, check) => (check.updatedAt > latest ? check.updatedAt : latest),
      task.updatedAt
    );
    return {
      schemaVersion: "1.0",
      generationTaskId: taskId,
      status: aggregateWorkflowStatus(task.status, checks),
      updatedAt
    };
  }

  private async assertOwnedGenerationTask(taskId: string) {
    const task = await this.generationTasks.findById(taskId);
    if (!task || task.userId !== this.environment.LOCAL_USER_ID) {
      throw new NotFoundException({ code: "IMAGE_GENERATION_TASK_NOT_FOUND" });
    }
    return task;
  }

  private toResponse(record: SubjectConsistencyCheckRecord): SubjectConsistencyCheck {
    const response: Record<string, unknown> = { ...record };
    delete response.userId;
    delete response.projectId;
    return subjectConsistencyCheckSchema.parse(response);
  }
}

export function aggregateWorkflowStatus(
  generationStatus: "queued" | "running" | "succeeded" | "failed" | "cancelled",
  checks: SubjectConsistencyCheck[]
): SubjectConsistencyWorkflowStatus {
  if (generationStatus === "cancelled") return "cancelled";
  if (generationStatus === "failed") return "execution_failed";
  if (checks.length === 0) return generationStatus === "running" ? "running" : "queued";
  if (checks.some((check) => check.status === "source_unusable")) return "source_unusable";
  if (checks.some((check) => check.status === "running")) return "running";
  if (checks.some((check) => check.status === "queued")) return "queued";

  const passed = checks.filter(
    (check) => check.status === "completed" && check.verdict === "passed"
  ).length;
  if (passed === checks.length) return "passed";
  if (passed > 0) return "partially_passed";
  if (checks.some((check) => check.status === "execution_failed")) return "execution_failed";
  if (checks.every((check) => check.status === "cancelled")) return "cancelled";
  return "rejected";
}
