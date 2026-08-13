import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const ports = [3000, 3001];
const conflicts = new Set();
const lockPath = path.join(workspace, ".local-run", "development-service.json");
let managedService;

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

try {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const pid = Number(lock.pid);
  if (
    Number.isInteger(pid) &&
    pid > 1 &&
    processCwd(pid) === workspace &&
    processCommand(pid).includes("scripts/dev-service.mjs start")
  ) {
    process.kill(pid, 0);
    managedService = { pid, startedAt: String(lock.startedAt ?? "未知") };
  } else {
    rmSync(lockPath, { force: true });
  }
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    // No managed development service is running.
  } else {
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // The normal process and port checks below still fail closed when relevant.
    }
  }
}

if (managedService) {
  throw new Error(
    `开发服务已运行（PID: ${managedService.pid}，启动时间: ${managedService.startedAt}）。可运行 ./scripts/dev status 查看状态。`
  );
}

for (const port of ports) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    for (const pid of output.trim().split(/\s+/).filter(Boolean)) conflicts.add(pid);
  } catch {
    // lsof exits non-zero when no process is listening.
  }
}

for (const pid of workspaceDevelopmentPids()) {
  if (pid !== process.pid && pid !== process.ppid) conflicts.add(pid);
}

if (conflicts.size > 0) {
  throw new Error(
    `检测到已有开发服务或端口占用（PID: ${[...conflicts].sort().join(", ")}）。请先停止旧服务，避免多版本同时运行。`
  );
}

process.stdout.write("开发进程检查通过\n");
