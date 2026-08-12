export const SUPPORTED_NODE_MAJOR = 24;

export function assertSupportedNodeRuntime(version = process.versions.node): void {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (major !== SUPPORTED_NODE_MAJOR) {
    throw new Error(
      `不支持 Node.js ${version}；当前项目必须使用 Node.js ${SUPPORTED_NODE_MAJOR}.x`
    );
  }
}

export const IMAGE_WORKER_HEARTBEAT_TTL_MS = 15_000;

export function imageWorkerHeartbeatKey(queueName: string): string {
  return `chaoren:worker:image:${queueName}:heartbeat`;
}
