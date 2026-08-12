import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, gte, ilike, isNull, ne, or, sql, type SQL } from "drizzle-orm";

import { agentModeSchema, agentTypeSchema } from "@chaoren/contracts";
import { agents, conversationSessions, type DatabaseConnection } from "@chaoren/database";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import {
  normalizeAgentName,
  type AgentListFilter,
  type AgentRecord,
  type AgentRepository
} from "./agent.repository.js";

@Injectable()
export class DrizzleAgentRepository implements AgentRepository {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async save(record: AgentRecord): Promise<void> {
    await this.connection.db.insert(agents).values({
      ...record,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  public async createVisibleUnique(record: AgentRecord) {
    try {
      return await this.connection.db.transaction(async (tx) => {
        await this.lockName(tx, record.name);
        const [conflict] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(this.activeNameConflict(record.ownerUserId, record.name))
          .limit(1);
        if (conflict) return "name_conflict" as const;
        await tx.insert(agents).values({
          ...record,
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt)
        });
        return "created" as const;
      });
    } catch (error) {
      if (isAgentNameUniqueViolation(error)) return "name_conflict" as const;
      throw error;
    }
  }

  public async findVisibleById(id: string, ownerUserId: string): Promise<AgentRecord | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), this.visibleTo(ownerUserId)))
      .limit(1);
    return row ? this.toRecord(row) : undefined;
  }

  public async listVisible(ownerUserId: string, filter: AgentListFilter) {
    const where = and(...this.listConditions(ownerUserId, filter));
    const offset = (filter.page - 1) * filter.pageSize;
    const [rows, [totalRow]] = await Promise.all([
      this.connection.db
        .select()
        .from(agents)
        .where(where)
        .orderBy(desc(agents.createdAt), desc(agents.id))
        .limit(filter.pageSize)
        .offset(offset),
      this.connection.db.select({ value: count() }).from(agents).where(where)
    ]);
    return {
      items: rows.map((row) => this.toRecord(row)),
      total: totalRow?.value ?? 0
    };
  }

  public async renameOwnedUnique(id: string, ownerUserId: string, name: string, updatedAt: string) {
    try {
      return await this.connection.db.transaction(async (tx) => {
        await this.lockName(tx, name);
        const [conflict] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(this.activeNameConflict(ownerUserId, name, id))
          .limit(1);
        if (conflict) return "name_conflict" as const;
        const rows = await tx
          .update(agents)
          .set({ name, updatedAt: new Date(updatedAt) })
          .where(
            and(eq(agents.id, id), eq(agents.ownerUserId, ownerUserId), isNull(agents.archivedAt))
          )
          .returning({ id: agents.id });
        return rows.length > 0 ? ("renamed" as const) : ("not_found" as const);
      });
    } catch (error) {
      if (isAgentNameUniqueViolation(error)) return "name_conflict" as const;
      throw error;
    }
  }

  public async deleteOwned(id: string, ownerUserId: string): Promise<boolean> {
    const rows = await this.connection.db
      .delete(agents)
      .where(and(eq(agents.id, id), eq(agents.ownerUserId, ownerUserId)))
      .returning({ id: agents.id });
    return rows.length > 0;
  }

  public async archiveOwned(id: string, ownerUserId: string, archivedAt: string): Promise<boolean> {
    const rows = await this.connection.db
      .update(agents)
      .set({ archivedAt: new Date(archivedAt), updatedAt: new Date(archivedAt) })
      .where(and(eq(agents.id, id), eq(agents.ownerUserId, ownerUserId), isNull(agents.archivedAt)))
      .returning({ id: agents.id });
    return rows.length > 0;
  }

  public async hasOwnedSessions(id: string, ownerUserId: string): Promise<boolean> {
    const [row] = await this.connection.db
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(
        and(eq(conversationSessions.agentId, id), eq(conversationSessions.userId, ownerUserId))
      )
      .limit(1);
    return Boolean(row);
  }

  private visibleTo(ownerUserId: string): SQL {
    return and(
      isNull(agents.archivedAt),
      or(isNull(agents.ownerUserId), eq(agents.ownerUserId, ownerUserId))
    )!;
  }

  private activeNameConflict(ownerUserId: string | null, name: string, excludedId?: string): SQL {
    const conditions: SQL[] = [
      isNull(agents.archivedAt),
      sql`lower(regexp_replace(btrim(${agents.name}), '[[:space:]]+', ' ', 'g')) = ${normalizeAgentName(name)}`
    ];
    if (ownerUserId !== null) {
      conditions.push(or(isNull(agents.ownerUserId), eq(agents.ownerUserId, ownerUserId)) as SQL);
    }
    if (excludedId) conditions.push(ne(agents.id, excludedId));
    return and(...conditions)!;
  }

  private async lockName(
    tx: Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0],
    name: string
  ): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`agent-name:${normalizeAgentName(name)}`}))`
    );
  }

  private listConditions(ownerUserId: string, filter: AgentListFilter): SQL[] {
    const conditions: SQL[] = [this.visibleTo(ownerUserId)];
    if (filter.type !== "all") conditions.push(eq(agents.type, filter.type));
    if (filter.createdAfter) conditions.push(gte(agents.createdAt, new Date(filter.createdAfter)));
    if (filter.keyword) {
      const escaped = filter.keyword
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_");
      const pattern = `%${escaped}%`;
      conditions.push(or(ilike(agents.name, pattern), ilike(agents.description, pattern)) as SQL);
    }
    return conditions;
  }

  private toRecord(row: typeof agents.$inferSelect): AgentRecord {
    return {
      ...row,
      type: agentTypeSchema.parse(row.type),
      mode: agentModeSchema.parse(row.mode),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}

function isAgentNameUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const databaseError = current as {
      code?: string;
      constraint_name?: string;
      constraint?: string;
      cause?: unknown;
    };
    const constraint = databaseError.constraint_name ?? databaseError.constraint;
    if (
      databaseError.code === "23505" &&
      ["agents_owner_active_name_uidx", "agents_system_active_name_uidx"].includes(constraint ?? "")
    ) {
      return true;
    }
    current = databaseError.cause;
  }
  return false;
}
