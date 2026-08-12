import { randomUUID } from "node:crypto";

import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import {
  createProjectRequestSchema,
  type Environment,
  type Project,
  type ProjectListResponse
} from "@chaoren/contracts";

import { ENVIRONMENT } from "../environment.js";
import {
  PROJECT_REPOSITORY,
  type ProjectRecord,
  type ProjectRepository
} from "./project.repository.js";

@Injectable()
export class ProjectService {
  public constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository
  ) {}

  public async create(rawRequest: unknown): Promise<Project> {
    const parsed = createProjectRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_PROJECT_REQUEST",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "$",
          message: issue.message
        }))
      });
    }

    const now = new Date().toISOString();
    const record: ProjectRecord = {
      id: randomUUID(),
      ownerUserId: this.environment.LOCAL_USER_ID,
      name: parsed.data.name,
      description: parsed.data.description,
      isDefault: false,
      createdAt: now,
      updatedAt: now
    };
    await this.projects.save(record);
    return this.toResponse(record);
  }

  public async ensureDefault(): Promise<Project> {
    const now = new Date().toISOString();
    return this.toResponse(
      await this.projects.ensureDefault({
        id: randomUUID(),
        ownerUserId: this.environment.LOCAL_USER_ID,
        name: "默认电商创作项目",
        description: "由电商创作平台首次使用时自动创建",
        isDefault: true,
        createdAt: now,
        updatedAt: now
      })
    );
  }

  public async findById(id: string): Promise<Project> {
    return this.toResponse(await this.assertOwned(id));
  }

  public async list(): Promise<ProjectListResponse> {
    const records = await this.projects.listByOwner(this.environment.LOCAL_USER_ID);
    return { projects: records.map((record) => this.toResponse(record)) };
  }

  public async assertOwned(id: string): Promise<ProjectRecord> {
    const record = await this.projects.findById(id);
    if (!record || record.ownerUserId !== this.environment.LOCAL_USER_ID) {
      throw new NotFoundException({ code: "PROJECT_NOT_FOUND" });
    }
    return record;
  }

  private toResponse(record: ProjectRecord): Project {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }
}
