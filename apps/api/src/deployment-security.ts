import { isIP } from "node:net";

import type { Environment } from "@chaoren/contracts";

export function assertSafeDeploymentConfiguration(environment: Environment): void {
  if (environment.NODE_ENV === "production" && environment.AUTHORIZATION_DRIVER === "development") {
    throw new Error("生产环境不能使用 development 授权驱动");
  }
  if (environment.AUTHORIZATION_DRIVER !== "development") return;
  if (!isLoopbackHost(environment.API_HOST)) {
    throw new Error("development 授权驱动只能监听回环地址");
  }
  if (!isLoopbackHost(new URL(environment.CORS_ORIGIN).hostname)) {
    throw new Error("development 授权驱动只允许回环地址来源");
  }
}

export function isLoopbackHost(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (host.startsWith("::ffff:")) return isLoopbackHost(host.slice("::ffff:".length));
  if (isIP(host) === 4) return host.split(".")[0] === "127";
  return false;
}
