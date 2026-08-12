import { beforeEach, describe, expect, it, vi } from "vitest";

import { environmentSchema } from "@chaoren/contracts";

import { InMemoryAgentRepository } from "../src/agents/in-memory-agent.repository.js";
import { AgentService } from "../src/agents/agent.service.js";

const environment = environmentSchema.parse({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
  REDIS_URL: "redis://127.0.0.1:6379"
});

const systemAgentId = "00000000-0000-4000-8000-000000000100";
const anotherUserAgentId = "00000000-0000-4000-8000-000000000102";

describe("AgentService", () => {
  let repository: InMemoryAgentRepository;
  let service: AgentService;

  beforeEach(async () => {
    vi.useRealTimers();
    repository = new InMemoryAgentRepository();
    service = new AgentService(environment, repository);
    await repository.save({
      id: systemAgentId,
      ownerUserId: null,
      name: "家居推广图 Agent",
      description: "为家居商品生成生活场景推广图。",
      agentInstruction: "保持商品主体不变。",
      type: "image",
      mode: "normal",
      createdAt: "2026-07-13T06:30:00.000Z",
      updatedAt: "2026-07-13T06:30:00.000Z"
    });
    await repository.save({
      id: anotherUserAgentId,
      ownerUserId: "00000000-0000-4000-8000-000000000999",
      name: "其他用户 Agent",
      description: "不可见",
      agentInstruction: "",
      type: "image",
      mode: "intelligent",
      createdAt: "2026-08-10T02:00:00.000Z",
      updatedAt: "2026-08-10T02:00:00.000Z"
    });
  });

  it("lists only system and current-user agents and applies server-side filters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T04:00:00.000Z"));
    const created = await service.create({
      name: " 夏季活动 Agent ",
      description: " 今日创建 ",
      agentInstruction: " 清新风格 ",
      type: "image"
    });

    await expect(
      service.list({ keyword: "夏季", timeRange: "today", page: "1", pageSize: "10" })
    ).resolves.toMatchObject({
      items: [{ id: created.id, name: "夏季活动 Agent", origin: "custom" }],
      pagination: { total: 1, totalPages: 1 }
    });

    const all = await service.list({});
    expect(all.items.map((agent) => agent.name)).toEqual(["夏季活动 Agent", "家居推广图 Agent"]);
  });

  it("rejects duplicate active names after whitespace and case normalization", async () => {
    await expect(
      service.create({
        name: "  家居推广图   Agent  ",
        description: "重复系统名称",
        agentInstruction: "",
        type: "image"
      })
    ).rejects.toMatchObject({ response: { code: "AGENT_NAME_EXISTS" } });

    const created = await service.create({
      name: "Campaign Agent",
      description: "",
      agentInstruction: "",
      type: "image"
    });
    await expect(
      service.create({
        name: "campaign   agent",
        description: "",
        agentInstruction: "",
        type: "image"
      })
    ).rejects.toMatchObject({ response: { code: "AGENT_NAME_EXISTS" } });
    await expect(service.rename(created.id, { name: "家居推广图 Agent" })).rejects.toMatchObject({
      response: { code: "AGENT_NAME_EXISTS" }
    });
  });

  it("copies a system agent without inheriting history and protects the source from mutation", async () => {
    const copied = await service.copy(systemAgentId);
    expect(copied).toMatchObject({
      name: "家居推广图 Agent - 副本",
      origin: "custom",
      agentInstruction: "保持商品主体不变。"
    });
    expect(copied.id).not.toBe(systemAgentId);

    await expect(service.rename(systemAgentId, { name: "非法改名" })).rejects.toMatchObject({
      response: { code: "SYSTEM_AGENT_READ_ONLY" }
    });
    await expect(service.delete(systemAgentId)).rejects.toMatchObject({
      response: { code: "SYSTEM_AGENT_READ_ONLY" }
    });

    await expect(service.rename(copied.id, { name: "我的家居 Agent" })).resolves.toMatchObject({
      name: "我的家居 Agent"
    });
    await service.delete(copied.id);
    await expect(service.findById(copied.id)).rejects.toMatchObject({
      response: { code: "AGENT_NOT_FOUND" }
    });
  });

  it("archives an agent that owns conversations without deleting its history", async () => {
    const copied = await service.copy(systemAgentId);
    vi.spyOn(repository, "hasOwnedSessions").mockResolvedValue(true);
    const archiveSpy = vi.spyOn(repository, "archiveOwned");
    const deleteSpy = vi.spyOn(repository, "deleteOwned");

    await expect(service.delete(copied.id)).resolves.toBeUndefined();
    expect(archiveSpy).toHaveBeenCalledWith(
      copied.id,
      environment.LOCAL_USER_ID,
      expect.any(String)
    );
    expect(deleteSpy).not.toHaveBeenCalled();
    await expect(service.findById(copied.id)).rejects.toMatchObject({
      response: { code: "AGENT_NOT_FOUND" }
    });
    await expect(
      service.create({
        name: copied.name,
        description: "复用归档名称",
        agentInstruction: "",
        type: "image"
      })
    ).resolves.toMatchObject({ name: copied.name });
  });

  it("allocates distinct copy names under concurrent requests", async () => {
    const copies = await Promise.all([service.copy(systemAgentId), service.copy(systemAgentId)]);
    expect(copies.map((agent) => agent.name).sort()).toEqual(
      ["家居推广图 Agent - 副本", "家居推广图 Agent - 副本 2"].sort()
    );
  });
});
