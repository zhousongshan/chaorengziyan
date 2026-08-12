import { describe, expect, it } from "vitest";

import { environmentSchema } from "@chaoren/contracts";

import { assertSafeDeploymentConfiguration, isLoopbackHost } from "../src/deployment-security.js";

const base = {
  NODE_ENV: "test" as const,
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
  REDIS_URL: "redis://127.0.0.1:6379"
};

describe("deployment security", () => {
  it("recognizes IPv4 and IPv6 loopback addresses", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.42.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });

  it("refuses to expose the development authorization adapter", () => {
    const environment = environmentSchema.parse({ ...base, API_HOST: "0.0.0.0" });
    expect(() => assertSafeDeploymentConfiguration(environment)).toThrow(/回环地址/);
  });

  it("refuses the development authorization adapter in production", () => {
    const environment = environmentSchema.parse({ ...base, NODE_ENV: "production" });
    expect(() => assertSafeDeploymentConfiguration(environment)).toThrow(/生产环境/);
  });
});
