import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { HealthController } from "../src/health/health.controller.js";
import type { HealthService } from "../src/health/health.service.js";

const baseReadiness = {
  service: "chaoren-api",
  timestamp: "2026-08-08T08:00:00.000Z",
  nodeVersion: "24.19.0",
  checks: { database: true, databaseSchema: true, redis: true, imageWorker: true }
} as const;

describe("HealthController", () => {
  it("keeps the compatibility liveness endpoint", () => {
    const controller = new HealthController({} as HealthService);
    expect(controller.getHealth()).toMatchObject({ status: "ok", service: "chaoren-api" });
    expect(controller.getLiveness()).toMatchObject({ status: "ok", service: "chaoren-api" });
  });

  it("returns readiness only when every dependency is available", async () => {
    const readiness = vi.fn(() => Promise.resolve({ ...baseReadiness, status: "ready" as const }));
    const controller = new HealthController({ readiness } as unknown as HealthService);

    await expect(controller.getReadiness()).resolves.toMatchObject({ status: "ready" });
  });

  it("returns a service-unavailable response when the worker heartbeat is absent", async () => {
    const readiness = vi.fn(() =>
      Promise.resolve({
        ...baseReadiness,
        status: "not_ready" as const,
        checks: { ...baseReadiness.checks, imageWorker: false }
      })
    );
    const controller = new HealthController({ readiness } as unknown as HealthService);

    await expect(controller.getReadiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
