import type { Environment } from "@chaoren/contracts";

type LogLevel = Environment["LOG_LEVEL"];
type LogFields = Record<string, unknown>;

const priority: Record<Exclude<LogLevel, "silent">, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5
};

export interface WorkerLogger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, error?: unknown, fields?: LogFields): void;
  debug(event: string, fields?: LogFields): void;
}

export function createWorkerLogger(configuredLevel: LogLevel): WorkerLogger {
  const enabled = (level: Exclude<LogLevel, "silent">) =>
    configuredLevel !== "silent" && priority[level] <= priority[configuredLevel];
  const write = (level: Exclude<LogLevel, "silent">, event: string, fields: LogFields = {}) => {
    if (!enabled(level)) return;
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "worker",
      event,
      ...fields
    });
    if (level === "error" || level === "fatal") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  };
  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, error, fields) =>
      write("error", event, { ...fields, ...(error ? { error: serializeError(error) } : {}) }),
    debug: (event, fields) => write("debug", event, fields)
  };
}

function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const result: Record<string, unknown> = { name: error.name, message: error.message };
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  if (code) result.code = code;
  if (error.cause) result.cause = serializeError(error.cause);
  return result;
}
