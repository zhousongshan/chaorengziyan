import { describe, expect, it } from "vitest";

import { environmentSchema } from "@chaoren/contracts";

import { InMemoryProjectRepository } from "../src/projects/in-memory-project.repository.js";
import { ProjectService } from "../src/projects/project.service.js";

const environment = environmentSchema.parse({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
  REDIS_URL: "redis://127.0.0.1:6379"
});

describe("ProjectService", () => {
  it("lists only the current user's projects in latest-updated order", async () => {
    const repository = new InMemoryProjectRepository();
    await repository.save({
      id: "00000000-0000-4000-8000-000000000021",
      ownerUserId: environment.LOCAL_USER_ID,
      name: "旧项目",
      description: null,
      isDefault: false,
      createdAt: "2026-08-05T08:00:00.000Z",
      updatedAt: "2026-08-05T08:00:00.000Z"
    });
    await repository.save({
      id: "00000000-0000-4000-8000-000000000022",
      ownerUserId: environment.LOCAL_USER_ID,
      name: "最近项目",
      description: null,
      isDefault: false,
      createdAt: "2026-08-06T08:00:00.000Z",
      updatedAt: "2026-08-06T08:00:00.000Z"
    });
    await repository.save({
      id: "00000000-0000-4000-8000-000000000023",
      ownerUserId: "another-user",
      name: "其他用户项目",
      description: null,
      isDefault: false,
      createdAt: "2026-08-06T09:00:00.000Z",
      updatedAt: "2026-08-06T09:00:00.000Z"
    });

    const service = new ProjectService(environment, repository);

    await expect(service.list()).resolves.toMatchObject({
      projects: [{ name: "最近项目" }, { name: "旧项目" }]
    });
    const first = await service.ensureDefault();
    const repeated = await service.ensureDefault();
    expect(first).toMatchObject({ id: "00000000-0000-4000-8000-000000000022" });
    expect(repeated.id).toBe(first.id);
  });
});
