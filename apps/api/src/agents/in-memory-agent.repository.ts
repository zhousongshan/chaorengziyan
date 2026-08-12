import {
  normalizeAgentName,
  type AgentListFilter,
  type AgentRecord,
  type AgentRepository
} from "./agent.repository.js";

export class InMemoryAgentRepository implements AgentRepository {
  private readonly records = new Map<string, AgentRecord>();
  private readonly archivedIds = new Set<string>();

  public save(record: AgentRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
    return Promise.resolve();
  }

  public createVisibleUnique(record: AgentRecord) {
    if (this.nameConflict(record.ownerUserId, record.name)) {
      return Promise.resolve("name_conflict" as const);
    }
    this.records.set(record.id, structuredClone(record));
    return Promise.resolve("created" as const);
  }

  public findVisibleById(id: string, ownerUserId: string): Promise<AgentRecord | undefined> {
    const record = this.records.get(id);
    const visible =
      record &&
      !this.archivedIds.has(record.id) &&
      (!record.ownerUserId || record.ownerUserId === ownerUserId);
    return Promise.resolve(visible ? structuredClone(record) : undefined);
  }

  public listVisible(ownerUserId: string, filter: AgentListFilter) {
    const keyword = filter.keyword.toLocaleLowerCase();
    const records = [...this.records.values()]
      .filter((record) => !record.ownerUserId || record.ownerUserId === ownerUserId)
      .filter((record) => !this.archivedIds.has(record.id))
      .filter((record) => filter.type === "all" || record.type === filter.type)
      .filter((record) => !filter.createdAfter || record.createdAt >= filter.createdAfter)
      .filter((record) =>
        `${record.name}${record.description}`.toLocaleLowerCase().includes(keyword)
      )
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
      );
    const offset = (filter.page - 1) * filter.pageSize;
    return Promise.resolve({
      items: records
        .slice(offset, offset + filter.pageSize)
        .map((record) => structuredClone(record)),
      total: records.length
    });
  }

  public renameOwnedUnique(id: string, ownerUserId: string, name: string, updatedAt: string) {
    const record = this.records.get(id);
    if (!record || record.ownerUserId !== ownerUserId || this.archivedIds.has(id)) {
      return Promise.resolve("not_found" as const);
    }
    if (this.nameConflict(ownerUserId, name, id)) {
      return Promise.resolve("name_conflict" as const);
    }
    this.records.set(id, { ...record, name, updatedAt });
    return Promise.resolve("renamed" as const);
  }

  public deleteOwned(id: string, ownerUserId: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.ownerUserId !== ownerUserId) return Promise.resolve(false);
    return Promise.resolve(this.records.delete(id));
  }

  public archiveOwned(id: string, ownerUserId: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.ownerUserId !== ownerUserId || this.archivedIds.has(id)) {
      return Promise.resolve(false);
    }
    this.archivedIds.add(id);
    return Promise.resolve(true);
  }

  public hasOwnedSessions(): Promise<boolean> {
    return Promise.resolve(false);
  }

  private nameConflict(ownerUserId: string | null, name: string, excludedId?: string): boolean {
    const normalizedName = normalizeAgentName(name);
    return [...this.records.values()].some((record) => {
      if (record.id === excludedId || this.archivedIds.has(record.id)) return false;
      if (normalizeAgentName(record.name) !== normalizedName) return false;
      return ownerUserId === null
        ? true
        : record.ownerUserId === null || record.ownerUserId === ownerUserId;
    });
  }
}
