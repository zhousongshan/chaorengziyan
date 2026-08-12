import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";

import {
  imageWorkerHeartbeatKey,
  type Environment,
  type ReadinessResponse
} from "@chaoren/contracts";
import type { DatabaseConnection } from "@chaoren/database";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import { ENVIRONMENT } from "../environment.js";

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis: Redis;

  public constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(DATABASE_CONNECTION) private readonly database: DatabaseConnection
  ) {
    this.redis = new Redis(environment.REDIS_URL, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1
    });
    this.redis.on("error", () => undefined);
  }

  public async readiness(): Promise<ReadinessResponse> {
    const [databaseResult, redisResult] = await Promise.allSettled([
      this.database.db.execute(sql`select 1`),
      this.redis.ping()
    ]);
    const database = databaseResult.status === "fulfilled";
    const redis = redisResult.status === "fulfilled" && redisResult.value === "PONG";
    let imageWorker = false;
    if (redis) {
      imageWorker = Boolean(
        await this.redis
          .get(imageWorkerHeartbeatKey(this.environment.TASK_QUEUE_NAME))
          .catch(() => null)
      );
    }
    return {
      status: database && redis && imageWorker ? "ready" : "not_ready",
      service: "chaoren-api",
      timestamp: new Date().toISOString(),
      nodeVersion: process.versions.node,
      checks: { database, redis, imageWorker }
    };
  }

  public onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
