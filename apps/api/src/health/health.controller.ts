import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import type { HealthResponse, ReadinessResponse } from "@chaoren/contracts";

import { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  public constructor(private readonly health: HealthService) {}

  @Get()
  public getHealth(): HealthResponse {
    return {
      status: "ok",
      service: "chaoren-api",
      timestamp: new Date().toISOString()
    };
  }

  @Get("live")
  public getLiveness(): HealthResponse {
    return this.getHealth();
  }

  @Get("ready")
  public async getReadiness(): Promise<ReadinessResponse> {
    const readiness = await this.health.readiness();
    if (readiness.status !== "ready") throw new ServiceUnavailableException(readiness);
    return readiness;
  }
}
