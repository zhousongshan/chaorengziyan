import { execFileSync } from "node:child_process";

const workspace = process.cwd();
const ports = [3000, 3001];
const conflicts = new Set();

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

try {
  const output = execFileSync("pgrep", ["-f", `${workspace}/.*(nest|next|worker|turbo|nodemon)`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  for (const pid of output.trim().split(/\s+/).filter(Boolean)) {
    if (Number(pid) !== process.pid && Number(pid) !== process.ppid) conflicts.add(pid);
  }
} catch {
  // pgrep exits non-zero when no matching process exists.
}

if (conflicts.size > 0) {
  throw new Error(
    `检测到已有开发服务或端口占用（PID: ${[...conflicts].sort().join(", ")}）。请先停止旧服务，避免多版本同时运行。`
  );
}

process.stdout.write("开发进程检查通过\n");
