import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDatabase, projects } from "@chaoren/database";
import { DrizzleProjectRepository } from "../src/projects/drizzle-project.repository.js";
import { databaseTestUrl } from "./database-test-url.js";

const enabled = process.env.RUN_DATABASE_TESTS === "1";

describe.skipIf(!enabled)("Project PostgreSQL repository", () => {
  it("promotes one existing project and returns it for concurrent default requests", async () => {
    const connection = createDatabase(await databaseTestUrl());
    const repository = new DrizzleProjectRepository(connection);
    const ownerUserId = randomUUID();
    const projectIds = [randomUUID(), randomUUID()];
    const candidateIds = [randomUUID(), randomUUID()];

    try {
      await connection.db.insert(projects).values([
        {
          id: projectIds[0],
          ownerUserId,
          name: "较早项目",
          isDefault: false,
          createdAt: new Date("2026-08-10T00:00:00.000Z"),
          updatedAt: new Date("2026-08-10T00:00:00.000Z")
        },
        {
          id: projectIds[1],
          ownerUserId,
          name: "最近项目",
          isDefault: false,
          createdAt: new Date("2026-08-11T00:00:00.000Z"),
          updatedAt: new Date("2026-08-11T00:00:00.000Z")
        }
      ]);

      const results = await Promise.all(
        candidateIds.map((id) =>
          repository.ensureDefault({
            id,
            ownerUserId,
            name: "不应创建的新项目",
            description: null,
            isDefault: true,
            createdAt: "2026-08-11T01:00:00.000Z",
            updatedAt: "2026-08-11T01:00:00.000Z"
          })
        )
      );

      expect(results.map((project) => project.id)).toEqual([projectIds[1], projectIds[1]]);
      const stored = await connection.db
        .select({ id: projects.id, isDefault: projects.isDefault })
        .from(projects)
        .where(eq(projects.ownerUserId, ownerUserId));
      expect(stored).toHaveLength(2);
      expect(stored.filter((project) => project.isDefault)).toEqual([
        { id: projectIds[1], isDefault: true }
      ]);
    } finally {
      await connection.db.delete(projects).where(inArray(projects.id, projectIds));
      await connection.close();
    }
  });
});
