import type { ProjectRecord, ProjectRepository } from "./project.repository.js";

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly records = new Map<string, ProjectRecord>();

  public save(record: ProjectRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
    return Promise.resolve();
  }

  public ensureDefault(record: ProjectRecord): Promise<ProjectRecord> {
    const existingDefault = [...this.records.values()].find(
      (item) => item.ownerUserId === record.ownerUserId && item.isDefault
    );
    if (existingDefault) return Promise.resolve(structuredClone(existingDefault));
    const existing = [...this.records.values()]
      .filter((item) => item.ownerUserId === record.ownerUserId)
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)
      )[0];
    if (existing) {
      const promoted = { ...existing, isDefault: true };
      this.records.set(promoted.id, promoted);
      return Promise.resolve(structuredClone(promoted));
    }
    this.records.set(record.id, structuredClone(record));
    return Promise.resolve(structuredClone(record));
  }

  public findById(id: string): Promise<ProjectRecord | undefined> {
    const record = this.records.get(id);
    return Promise.resolve(record ? structuredClone(record) : undefined);
  }

  public listByOwner(ownerUserId: string): Promise<ProjectRecord[]> {
    return Promise.resolve(
      [...this.records.values()]
        .filter((record) => record.ownerUserId === ownerUserId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => structuredClone(record))
    );
  }
}
