import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";

import { projects, type DatabaseConnection } from "@chaoren/database";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import type { ProjectRecord, ProjectRepository } from "./project.repository.js";

@Injectable()
export class DrizzleProjectRepository implements ProjectRepository {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async save(record: ProjectRecord): Promise<void> {
    await this.connection.db.insert(projects).values({
      id: record.id,
      ownerUserId: record.ownerUserId,
      name: record.name,
      description: record.description,
      isDefault: record.isDefault,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  public async ensureDefault(record: ProjectRecord): Promise<ProjectRecord> {
    return this.connection.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`default-project:${record.ownerUserId}`}))`
      );
      const [current] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.ownerUserId, record.ownerUserId), eq(projects.isDefault, true)))
        .limit(1);
      if (current) return this.toRecord(current);

      const [existing] = await tx
        .select()
        .from(projects)
        .where(eq(projects.ownerUserId, record.ownerUserId))
        .orderBy(desc(projects.updatedAt), desc(projects.createdAt), desc(projects.id))
        .limit(1);
      if (existing) {
        const [promoted] = await tx
          .update(projects)
          .set({ isDefault: true })
          .where(eq(projects.id, existing.id))
          .returning();
        if (!promoted) throw new Error("设置默认项目失败");
        return this.toRecord(promoted);
      }

      const [created] = await tx
        .insert(projects)
        .values({
          id: record.id,
          ownerUserId: record.ownerUserId,
          name: record.name,
          description: record.description,
          isDefault: true,
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt)
        })
        .returning();
      if (!created) throw new Error("创建默认项目失败");
      return this.toRecord(created);
    });
  }

  public async findById(id: string): Promise<ProjectRecord | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    return row ? this.toRecord(row) : undefined;
  }

  public async listByOwner(ownerUserId: string): Promise<ProjectRecord[]> {
    const rows = await this.connection.db
      .select()
      .from(projects)
      .where(eq(projects.ownerUserId, ownerUserId))
      .orderBy(desc(projects.updatedAt));
    return rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: typeof projects.$inferSelect): ProjectRecord {
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}
