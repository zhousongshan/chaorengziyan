import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";

import {
  agentListQuerySchema,
  createAgentRequestSchema,
  renameAgentRequestSchema,
  type Agent,
  type AgentListResponse,
  type Environment
} from "@chaoren/contracts";

import { ENVIRONMENT } from "../environment.js";
import { AGENT_REPOSITORY, type AgentRecord, type AgentRepository } from "./agent.repository.js";

@Injectable()
export class AgentService {
  public constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(AGENT_REPOSITORY) private readonly agents: AgentRepository
  ) {}

  public async create(rawRequest: unknown): Promise<Agent> {
    const request = this.parseCreateRequest(rawRequest);
    const now = new Date().toISOString();
    const record: AgentRecord = {
      id: randomUUID(),
      ownerUserId: this.environment.LOCAL_USER_ID,
      name: request.name,
      description: request.description,
      agentInstruction: request.agentInstruction,
      type: request.type,
      mode: "intelligent",
      createdAt: now,
      updatedAt: now
    };
    if ((await this.agents.createVisibleUnique(record)) === "name_conflict") {
      throw this.nameConflict();
    }
    return this.toResponse(record);
  }

  public async list(rawQuery: unknown): Promise<AgentListResponse> {
    const parsed = agentListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw this.invalidRequest("INVALID_AGENT_LIST_QUERY", parsed.error.issues);
    }
    const result = await this.agents.listVisible(this.environment.LOCAL_USER_ID, {
      ...parsed.data,
      ...(parsed.data.timeRange === "all"
        ? {}
        : { createdAfter: timeRangeStart(parsed.data.timeRange).toISOString() })
    });
    return {
      items: result.items.map((record) => this.toResponse(record)),
      pagination: {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        total: result.total,
        totalPages: result.total === 0 ? 0 : Math.ceil(result.total / parsed.data.pageSize)
      }
    };
  }

  public async findById(id: string): Promise<Agent> {
    return this.toResponse(await this.assertVisible(id));
  }

  public async copy(id: string): Promise<Agent> {
    const source = await this.assertVisible(id);
    const now = new Date().toISOString();
    const baseName = source.name.replace(/ - 副本(?: \d+)?$/, "");
    for (let copyNumber = 1; copyNumber <= 1_000; copyNumber += 1) {
      const suffix = copyNumber === 1 ? " - 副本" : ` - 副本 ${copyNumber}`;
      const record: AgentRecord = {
        ...source,
        id: randomUUID(),
        ownerUserId: this.environment.LOCAL_USER_ID,
        name: `${baseName.slice(0, 40 - suffix.length).trimEnd()}${suffix}`,
        createdAt: now,
        updatedAt: now
      };
      if ((await this.agents.createVisibleUnique(record)) === "created") {
        return this.toResponse(record);
      }
    }
    throw new BadRequestException({
      code: "AGENT_COPY_NAME_EXHAUSTED",
      message: "同名 Agent 副本数量过多，请先重命名"
    });
  }

  public async rename(id: string, rawRequest: unknown): Promise<Agent> {
    const parsed = renameAgentRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw this.invalidRequest("INVALID_AGENT_RENAME_REQUEST", parsed.error.issues);
    }
    const current = await this.assertMutable(id);
    const updatedAt = new Date().toISOString();
    const renamed = await this.agents.renameOwnedUnique(
      id,
      this.environment.LOCAL_USER_ID,
      parsed.data.name,
      updatedAt
    );
    if (renamed === "name_conflict") throw this.nameConflict();
    if (renamed === "not_found") throw new NotFoundException({ code: "AGENT_NOT_FOUND" });
    return this.toResponse({ ...current, name: parsed.data.name, updatedAt });
  }

  public async delete(id: string): Promise<void> {
    await this.assertMutable(id);
    if (await this.agents.hasOwnedSessions(id, this.environment.LOCAL_USER_ID)) {
      const archived = await this.agents.archiveOwned(
        id,
        this.environment.LOCAL_USER_ID,
        new Date().toISOString()
      );
      if (!archived) throw new NotFoundException({ code: "AGENT_NOT_FOUND" });
      return;
    }
    const deleted = await this.agents.deleteOwned(id, this.environment.LOCAL_USER_ID);
    if (!deleted) throw new NotFoundException({ code: "AGENT_NOT_FOUND" });
  }

  private parseCreateRequest(rawRequest: unknown) {
    const parsed = createAgentRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw this.invalidRequest("INVALID_AGENT_CREATE_REQUEST", parsed.error.issues);
    }
    return parsed.data;
  }

  private async assertVisible(id: string): Promise<AgentRecord> {
    const record = await this.agents.findVisibleById(id, this.environment.LOCAL_USER_ID);
    if (!record) throw new NotFoundException({ code: "AGENT_NOT_FOUND" });
    return record;
  }

  private async assertMutable(id: string): Promise<AgentRecord> {
    const record = await this.assertVisible(id);
    if (!record.ownerUserId) {
      throw new BadRequestException({
        code: "SYSTEM_AGENT_READ_ONLY",
        message: "系统内置 Agent 不支持重命名或删除"
      });
    }
    return record;
  }

  private invalidRequest(code: string, issues: { path: PropertyKey[]; message: string }[]) {
    return new BadRequestException({
      code,
      issues: issues.map((issue) => ({
        field: issue.path.join(".") || "$",
        message: issue.message
      }))
    });
  }

  private nameConflict() {
    return new ConflictException({
      code: "AGENT_NAME_EXISTS",
      message: "Agent 名称已存在，请使用其他名称"
    });
  }

  private toResponse(record: AgentRecord): Agent {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      agentInstruction: record.agentInstruction,
      type: record.type,
      mode: record.mode,
      origin: record.ownerUserId ? "custom" : "system",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }
}

function timeRangeStart(timeRange: "today" | "7d" | "30d", now = new Date()): Date {
  if (timeRange === "today") {
    const chinaStandardTimeOffsetMs = 8 * 60 * 60 * 1_000;
    const local = new Date(now.getTime() + chinaStandardTimeOffsetMs);
    return new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
        chinaStandardTimeOffsetMs
    );
  }
  return new Date(now.getTime() - (timeRange === "7d" ? 7 : 30) * 24 * 60 * 60 * 1_000);
}
