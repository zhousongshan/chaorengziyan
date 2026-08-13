import { execFileSync, spawn } from "node:child_process";
import { link, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const workspace = process.cwd();
const runDirectory = path.join(workspace, ".local-run");
const lockPath = path.join(runDirectory, "development-service.json");
const command = process.argv[2] ?? "start";
const ports = [3000, 3001];
const nextEnvironmentPath = path.join(workspace, "apps/web/next-env.d.ts");

const cleanTargets = [
  ".turbo",
  "apps/web/.next",
  "apps/web/playwright-report",
  "apps/web/test-results",
  "apps/web/tsconfig.tsbuildinfo",
  "apps/api/dist",
  "apps/api/.turbo",
  "apps/worker/dist",
  "apps/worker/.turbo",
  "packages/contracts/dist",
  "packages/contracts/.turbo",
  "packages/database/dist",
  "packages/database/.turbo",
  "packages/image-generation/dist",
  "packages/image-generation/.turbo",
  "packages/storage/dist",
  "packages/storage/.turbo",
  "packages/subject-consistency/dist",
  "packages/subject-consistency/.turbo"
];

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processCwd(pid) {
  try {
    const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output
      .split("\n")
      .find((line) => line.startsWith("n"))
      ?.slice(1);
  } catch {
    return undefined;
  }
}

function processCommand(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

async function readLock() {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8"));
    return {
      pid: Number(value.pid),
      workspace: String(value.workspace ?? ""),
      startedAt: String(value.startedAt ?? "")
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    await rm(lockPath, { force: true });
    return undefined;
  }
}

async function activeLock() {
  const lock = await readLock();
  if (!lock) return undefined;

  if (
    lock.workspace === workspace &&
    processExists(lock.pid) &&
    processCwd(lock.pid) === workspace &&
    processCommand(lock.pid).includes("scripts/dev-service.mjs start")
  ) {
    return lock;
  }

  await rm(lockPath, { force: true });
  return undefined;
}

async function acquireLock() {
  await mkdir(runDirectory, { recursive: true });
  const existing = await activeLock();
  if (existing) {
    throw new Error(`开发服务已运行（PID: ${existing.pid}，启动时间: ${existing.startedAt}）`);
  }

  const temporaryLockPath = path.join(runDirectory, `development-service.${process.pid}.tmp`);
  const handle = await open(temporaryLockPath, "wx");
  try {
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, workspace, startedAt: new Date().toISOString() }, null, 2)}\n`
    );
  } finally {
    await handle.close();
  }

  try {
    await link(temporaryLockPath, lockPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      const winner = await activeLock();
      throw new Error(
        winner
          ? `开发服务已运行（PID: ${winner.pid}，启动时间: ${winner.startedAt}）`
          : "另一个开发服务正在启动，请运行 ./scripts/dev status 查看状态"
      );
    }
    throw error;
  } finally {
    await rm(temporaryLockPath, { force: true });
  }
}

function listeningPids() {
  const result = new Map();
  for (const port of ports) {
    try {
      const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      result.set(port, output.trim().split(/\s+/).filter(Boolean).map(Number));
    } catch {
      result.set(port, []);
    }
  }
  return result;
}

function workspaceDevelopmentPids() {
  let output;
  try {
    output = execFileSync("ps", ["-axo", "pid=,command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return [];
  }

  const markers = [
    "/next/dist/bin/next",
    "next-server",
    "/@nestjs/cli/",
    "/tsx/dist/cli",
    "/@turbo/",
    "/turbo/bin/turbo",
    "/nodemon/bin/nodemon",
    "/typescript/bin/tsc"
  ];

  return output
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(.+)$/))
    .filter(Boolean)
    .filter((match) => markers.some((marker) => match[2].includes(marker)))
    .map((match) => Number(match[1]))
    .filter((pid) => {
      const cwd = processCwd(pid);
      return cwd === workspace || cwd?.startsWith(`${workspace}${path.sep}`);
    });
}

async function fetchStatus(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return { ok: response.ok, status: response.status, body: await response.text() };
  } catch (error) {
    return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}

async function serviceStatus({ print = true } = {}) {
  const [lock, web, api] = await Promise.all([
    activeLock(),
    fetchStatus("http://127.0.0.1:3000/login"),
    fetchStatus("http://127.0.0.1:3001/api/v1/health/ready")
  ]);

  let readiness;
  try {
    readiness = JSON.parse(api.body);
  } catch {
    readiness = undefined;
  }

  const ready =
    Boolean(lock) &&
    web.status === 200 &&
    api.status === 200 &&
    readiness?.status === "ready" &&
    readiness?.checks?.database === true &&
    readiness?.checks?.databaseSchema === true &&
    readiness?.checks?.redis === true &&
    readiness?.checks?.imageWorker === true;

  const status = {
    ready,
    controllerPid: lock?.pid ?? null,
    web: { ready: web.status === 200, status: web.status },
    api: {
      ready: api.status === 200 && readiness?.status === "ready",
      status: api.status,
      checks: readiness?.checks ?? null
    },
    ports: Object.fromEntries(listeningPids()),
    developmentPids: workspaceDevelopmentPids()
  };

  if (print) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  return status;
}

async function waitForReady(child) {
  for (let attempt = 1; attempt <= 30 && child.exitCode === null; attempt += 1) {
    const status = await serviceStatus({ print: false });
    if (status.ready) {
      process.stdout.write(
        "开发服务已就绪：Web http://127.0.0.1:3000，API readiness http://127.0.0.1:3001/api/v1/health/ready\n"
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  if (child.exitCode === null) {
    process.stderr.write("开发服务启动超过 30 秒仍未通过 readiness，请检查上方日志。\n");
  }
}

async function start() {
  await acquireLock();
  const originalNextEnvironment = await readFile(nextEnvironmentPath, "utf8").catch(
    () => undefined
  );
  let child;
  let stopping = false;

  const cleanup = async () => {
    await rm(lockPath, { force: true });
  };

  const stopChild = (signal) => {
    if (stopping) return;
    stopping = true;
    if (child?.pid && child.exitCode === null) {
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    }
  };

  process.once("SIGINT", () => stopChild("SIGINT"));
  process.once("SIGTERM", () => stopChild("SIGTERM"));
  process.once("SIGHUP", () => stopChild("SIGHUP"));

  try {
    child = spawn("pnpm", ["dev:runtime"], {
      cwd: workspace,
      detached: true,
      env: { ...process.env, CHAOREN_DEV_CONTROLLER_PID: String(process.pid) },
      stdio: "inherit"
    });

    const readiness = waitForReady(child);
    const exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    await readiness;
    process.exitCode = exit.code ?? (stopping ? 0 : 1);
  } finally {
    if (originalNextEnvironment === undefined) {
      await rm(nextEnvironmentPath, { force: true });
    } else {
      await writeFile(nextEnvironmentPath, originalNextEnvironment);
    }
    await cleanup();
  }
}

async function stop() {
  const lock = await activeLock();
  if (!lock) {
    const occupied = [...listeningPids().values()].flat();
    const unmanaged = workspaceDevelopmentPids();
    if (occupied.length > 0) {
      throw new Error(`端口仍被非受管进程占用（PID: ${occupied.join(", ")}），未自动结束`);
    }
    if (unmanaged.length > 0) {
      throw new Error(`检测到非受管项目 watcher（PID: ${unmanaged.join(", ")}），未自动结束`);
    }
    process.stdout.write("开发服务未运行\n");
    return;
  }

  process.kill(lock.pid, "SIGTERM");
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (
      !processExists(lock.pid) &&
      [...listeningPids().values()].flat().length === 0 &&
      workspaceDevelopmentPids().length === 0
    ) {
      await rm(lockPath, { force: true });
      process.stdout.write("开发服务已停止\n");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`开发服务未在 15 秒内停止（PID: ${lock.pid}）`);
}

async function clean() {
  const lock = await activeLock();
  const occupied = [...listeningPids().values()].flat();
  const developmentPids = workspaceDevelopmentPids();
  if (lock || occupied.length > 0 || developmentPids.length > 0) {
    throw new Error("开发服务运行时禁止清理缓存，请先运行 ./scripts/dev stop");
  }

  for (const target of cleanTargets) {
    const resolved = path.resolve(workspace, target);
    if (!resolved.startsWith(`${workspace}${path.sep}`)) {
      throw new Error(`拒绝清理工作区外路径：${target}`);
    }
    await rm(resolved, { recursive: true, force: true });
  }
  process.stdout.write(
    `已清理 ${cleanTargets.length} 个构建缓存和测试产物；未触碰 .env、.local-data、backups 或 node_modules\n`
  );
}

switch (command) {
  case "start":
    await start();
    break;
  case "status": {
    const status = await serviceStatus();
    process.exitCode = status.ready ? 0 : 1;
    break;
  }
  case "stop":
    await stop();
    break;
  case "clean":
    await clean();
    break;
  default:
    throw new Error(`未知命令：${command}`);
}
