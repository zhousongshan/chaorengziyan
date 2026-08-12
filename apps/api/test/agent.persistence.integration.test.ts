import { randomUUID } from "node:crypto";

import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { agents, createDatabase } from "@chaoren/database";
import { DrizzleAgentRepository } from "../src/agents/drizzle-agent.repository.js";
import { databaseTestUrl } from "./database-test-url.js";

const enabled = process.env.RUN_DATABASE_TESTS === "1";

describe.skipIf(!enabled)("Agent PostgreSQL repository", () => {
  it("keeps custom agents scoped to their owner while exposing read-only system agents", async () => {
    const connection = createDatabase(await databaseTestUrl());
    const ids = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID()
    ];
    const userA = "00000000-0000-4000-8000-000000000201";
    const userB = "00000000-0000-4000-8000-000000000202";
    const repository = new DrizzleAgentRepository(connection);
    const now = new Date().toISOString();

    try {
      await repository.save({
        id: ids[0]!,
        ownerUserId: null,
        name: "集成测试系统 Agent",
        description: "全局可见",
        agentInstruction: "",
        type: "image",
        mode: "normal",
        createdAt: now,
        updatedAt: now
      });
      await repository.save({
        id: ids[1]!,
        ownerUserId: userA,
        name: "用户 A Agent",
        description: "仅 A 可见",
        agentInstruction: "",
        type: "image",
        mode: "intelligent",
        createdAt: now,
        updatedAt: now
      });
      await repository.save({
        id: ids[2]!,
        ownerUserId: userB,
        name: "用户 B Agent",
        description: "仅 B 可见",
        agentInstruction: "",
        type: "image",
        mode: "intelligent",
        createdAt: now,
        updatedAt: now
      });

      const visible = await repository.listVisible(userA, {
        keyword: "集成测试系统",
        type: "all",
        timeRange: "all",
        page: 1,
        pageSize: 10
      });
      expect(visible.items.map((agent) => agent.id)).toEqual([ids[0]]);
      await expect(repository.findVisibleById(ids[2]!, userA)).resolves.toBeUndefined();
      await expect(repository.renameOwnedUnique(ids[0]!, userA, "非法改名", now)).resolves.toBe(
        "not_found"
      );
      await expect(
        repository.createVisibleUnique({
          id: ids[3]!,
          ownerUserId: userA,
          name: "  集成测试系统   agent ",
          description: "不允许与系统 Agent 重名",
          agentInstruction: "",
          type: "image",
          mode: "intelligent",
          createdAt: now,
          updatedAt: now
        })
      ).resolves.toBe("name_conflict");
      const concurrentRecords = [ids[3]!, ids[4]!].map((id) => ({
        id,
        ownerUserId: userA,
        name: "并发 Agent",
        description: "",
        agentInstruction: "",
        type: "image" as const,
        mode: "intelligent" as const,
        createdAt: now,
        updatedAt: now
      }));
      await expect(
        Promise.all(concurrentRecords.map((record) => repository.createVisibleUnique(record)))
      ).resolves.toEqual(expect.arrayContaining(["created", "name_conflict"]));
      await expect(repository.archiveOwned(ids[1]!, userA, now)).resolves.toBe(true);
      await expect(repository.findVisibleById(ids[1]!, userA)).resolves.toBeUndefined();
      await expect(
        repository.createVisibleUnique({
          id: ids[5]!,
          ownerUserId: userA,
          name: "用户 A Agent",
          description: "归档后名称可复用",
          agentInstruction: "",
          type: "image",
          mode: "intelligent",
          createdAt: now,
          updatedAt: now
        })
      ).resolves.toBe("created");
    } finally {
      await connection.db.delete(agents).where(inArray(agents.id, ids));
      await connection.close();
    }
  });
});
