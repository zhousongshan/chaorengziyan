import type { SubjectConsistencyCheck } from "@chaoren/contracts";

export const SUBJECT_CONSISTENCY_REPOSITORY = Symbol("SUBJECT_CONSISTENCY_REPOSITORY");

export interface SubjectConsistencyCheckRecord extends SubjectConsistencyCheck {
  userId: string;
  projectId: string;
}

export interface SubjectConsistencyRepository {
  findById(id: string): Promise<SubjectConsistencyCheckRecord | undefined>;
  findByGenerationTaskId(taskId: string): Promise<SubjectConsistencyCheckRecord[]>;
  findRecoverableIds(): Promise<string[]>;
}
