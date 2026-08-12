import { UnrecoverableError, type Job } from "bullmq";

import {
  SUBJECT_CONSISTENCY_JOB_NAME,
  subjectConsistencyJobDataSchema,
  type SubjectConsistencyJobData
} from "@chaoren/contracts";

import {
  classifySubjectConsistencyFailure,
  type SubjectConsistencyProcessor
} from "./subject-consistency.processor.js";

export class SubjectConsistencyJobHandler {
  public constructor(private readonly processor: SubjectConsistencyProcessor) {}

  public async handle(job: Job<SubjectConsistencyJobData>): Promise<{ checkId: string }> {
    if (job.name !== SUBJECT_CONSISTENCY_JOB_NAME) {
      throw new UnrecoverableError(`不支持的任务类型: ${job.name}`);
    }
    const parsed = subjectConsistencyJobDataSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("主体质检队列消息格式无效");

    try {
      await this.processor.execute(parsed.data.checkId);
      return { checkId: parsed.data.checkId };
    } catch (error) {
      const failure = classifySubjectConsistencyFailure(error);
      const attempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
      const finalAttempt = job.attemptsMade + 1 >= attempts;
      if (!failure.retryable || finalAttempt) {
        await this.processor.recordFailure(parsed.data.checkId, failure);
      }
      if (!failure.retryable) throw new UnrecoverableError(failure.message);
      throw error;
    }
  }
}
