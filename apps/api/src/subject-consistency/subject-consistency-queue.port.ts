export const SUBJECT_CONSISTENCY_QUEUE = Symbol("SUBJECT_CONSISTENCY_QUEUE");

export interface SubjectConsistencyQueue {
  enqueue(checkId: string, executionId?: string): Promise<void>;
}
