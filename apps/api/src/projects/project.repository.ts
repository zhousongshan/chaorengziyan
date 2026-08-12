export const PROJECT_REPOSITORY = Symbol("PROJECT_REPOSITORY");

export interface ProjectRecord {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRepository {
  save(record: ProjectRecord): Promise<void>;
  ensureDefault(record: ProjectRecord): Promise<ProjectRecord>;
  findById(id: string): Promise<ProjectRecord | undefined>;
  listByOwner(ownerUserId: string): Promise<ProjectRecord[]>;
}
