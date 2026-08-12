import { Worker } from "bullmq";
import { config } from "dotenv";
import { Redis } from "ioredis";
import { ProxyAgent, setGlobalDispatcher } from "undici";

import {
  assertSupportedNodeRuntime,
  environmentSchema,
  IMAGE_WORKER_HEARTBEAT_TTL_MS,
  imageWorkerHeartbeatKey,
  type ImageGenerationJobData,
  type ImageGenerationUnitJobData,
  type SubjectConsistencyJobData
} from "@chaoren/contracts";
import { assertDatabaseMigrationCurrent, createDatabase } from "@chaoren/database";
import {
  ByteDanceImageAdapter,
  ImageGenerationRouter,
  OpenAiImageAdapter
} from "@chaoren/image-generation";
import { LocalStorageAdapter, resolveWorkspacePath } from "@chaoren/storage";
import {
  OpenAiCompatibleSubjectConsistencyAdapter,
  OpenAiCompatibleSubjectRequirementReconciler
} from "@chaoren/subject-consistency";

import { ImageGenerationJobHandler } from "./image-generation-job.handler.js";
import { ImageGenerationProcessor } from "./image-generation.processor.js";
import { BullMqImageGenerationQueuePublisher } from "./image-generation.queue.js";
import { DrizzleImageGenerationTaskStore } from "./image-generation-task.store.js";
import { CreationRunCoordinator } from "./creation-run.coordinator.js";
import { SubjectConsistencyJobHandler } from "./subject-consistency-job.handler.js";
import { SubjectConsistencyProcessor } from "./subject-consistency.processor.js";
import { DrizzleSubjectConsistencyTaskStore } from "./subject-consistency-task.store.js";
import { BullMqSubjectConsistencyQueuePublisher } from "./subject-consistency.queue.js";
import { WorkflowOutboxDispatcher } from "./workflow-outbox.dispatcher.js";
import { createWorkerLogger } from "./worker-logger.js";

assertSupportedNodeRuntime();
config({ path: await resolveWorkspacePath(".env"), quiet: true });
const environment = environmentSchema.parse(process.env);
const logger = createWorkerLogger(environment.LOG_LEVEL);
if (environment.OUTBOUND_HTTP_PROXY_URL) {
  setGlobalDispatcher(new ProxyAgent(environment.OUTBOUND_HTTP_PROXY_URL));
}
const database = createDatabase(environment.DATABASE_URL);
try {
  await assertDatabaseMigrationCurrent(database.db);
} catch (error) {
  await database.close();
  throw error;
}
const runCoordinator = new CreationRunCoordinator(database);
const storage = new LocalStorageAdapter(await resolveWorkspacePath(environment.LOCAL_STORAGE_ROOT));
const taskStore = new DrizzleImageGenerationTaskStore(database);
const subjectTaskStore = new DrizzleSubjectConsistencyTaskStore(database);
const imageQueue = new BullMqImageGenerationQueuePublisher(environment);
const subjectQueue = new BullMqSubjectConsistencyQueuePublisher(environment);
const outbox = new WorkflowOutboxDispatcher(database, imageQueue, subjectQueue);
const generator = new ImageGenerationRouter([
  new ByteDanceImageAdapter(environment),
  new OpenAiImageAdapter(environment)
]);
const processor = new ImageGenerationProcessor(
  environment,
  taskStore,
  storage,
  generator,
  subjectQueue
);
const handler = new ImageGenerationJobHandler(processor);
const subjectProcessor = new SubjectConsistencyProcessor(
  environment,
  subjectTaskStore,
  storage,
  new OpenAiCompatibleSubjectConsistencyAdapter(environment),
  new OpenAiCompatibleSubjectRequirementReconciler(environment),
  imageQueue
);
const subjectHandler = new SubjectConsistencyJobHandler(subjectProcessor);
const imageConnection = new Redis(environment.REDIS_URL, {
  enableReadyCheck: false,
  maxRetriesPerRequest: null
});
const subjectConnection = new Redis(environment.REDIS_URL, {
  enableReadyCheck: false,
  maxRetriesPerRequest: null
});

const imageWorker = new Worker<ImageGenerationJobData | ImageGenerationUnitJobData>(
  environment.TASK_QUEUE_NAME,
  (job) => handler.handle(job),
  { connection: imageConnection, concurrency: environment.IMAGE_WORKER_CONCURRENCY }
);
const subjectWorker = new Worker<SubjectConsistencyJobData>(
  environment.SUBJECT_INSPECTION_QUEUE_NAME,
  (job) => subjectHandler.handle(job),
  {
    connection: subjectConnection,
    concurrency: environment.SUBJECT_INSPECTION_WORKER_CONCURRENCY
  }
);

imageWorker.on("ready", () =>
  logger.info("image_queue_ready", {
    queue: environment.TASK_QUEUE_NAME,
    concurrency: environment.IMAGE_WORKER_CONCURRENCY
  })
);
imageWorker.on("completed", (job) =>
  logger.info("image_job_completed", { jobId: job.id ?? "unknown" })
);
imageWorker.on("failed", (job, error) =>
  logger.error("image_job_failed", error, { jobId: job?.id ?? "unknown" })
);
imageWorker.on("error", (error) => logger.error("image_runtime_error", error));
subjectWorker.on("ready", () =>
  logger.info("subject_queue_ready", {
    queue: environment.SUBJECT_INSPECTION_QUEUE_NAME,
    concurrency: environment.SUBJECT_INSPECTION_WORKER_CONCURRENCY
  })
);
subjectWorker.on("completed", (job) =>
  logger.info("subject_job_completed", { jobId: job.id ?? "unknown" })
);
subjectWorker.on("failed", (job, error) =>
  logger.error("subject_job_failed", error, { jobId: job?.id ?? "unknown" })
);
subjectWorker.on("error", (error) => logger.error("subject_runtime_error", error));

async function recoverSubjectChecks(): Promise<void> {
  const ids = await subjectTaskStore.findRecoverableIds();
  for (const id of ids) {
    await subjectQueue.enqueue(id);
    await outbox.markEntityPublished("subject.check.enqueue", id);
  }
}

async function recoverImageTasks(): Promise<void> {
  const [units, legacyTaskIds] = await Promise.all([
    taskStore.findRecoverableUnits(),
    taskStore.findRecoverableIds()
  ]);
  for (const unit of units) {
    await imageQueue.enqueueUnit(unit.taskId, unit.unitId);
    await outbox.markEntityPublished("generation.unit.enqueue", unit.unitId);
  }
  for (const taskId of legacyTaskIds) {
    await imageQueue.enqueue(taskId);
    await outbox.markEntityPublished("generation.task.enqueue", taskId);
  }
}

let staleRunWarningSignature = "";
let staleRunWarningAt = 0;

async function recoverWorkflowState(): Promise<void> {
  const finalizedRuns = await runCoordinator.finalizeOrphanedRunDetails();
  if (finalizedRuns.length > 0) {
    logger.warn("orphaned_creation_runs_finalized", {
      count: finalizedRuns.length,
      runIds: finalizedRuns.map((run) => run.runId),
      maximumAgeMs: Math.max(...finalizedRuns.map((run) => run.ageMs)),
      reason: finalizedRuns[0]?.reason
    });
  }
  const staleRuns = await runCoordinator.findStaleActiveRuns(15 * 60_000);
  const staleSignature = staleRuns
    .map((run) => `${run.runId}:${run.status}`)
    .sort()
    .join(",");
  const now = Date.now();
  if (
    staleRuns.length > 0 &&
    (staleSignature !== staleRunWarningSignature || now - staleRunWarningAt >= 15 * 60_000)
  ) {
    logger.warn("stale_active_creation_runs_detected", {
      count: staleRuns.length,
      runIds: staleRuns.map((run) => run.runId),
      statuses: staleRuns.map((run) => run.status),
      maximumAgeMs: Math.max(...staleRuns.map((run) => run.ageMs)),
      maximumUnchangedForMs: Math.max(...staleRuns.map((run) => run.unchangedForMs)),
      diagnosticOnly: true
    });
    staleRunWarningAt = now;
  }
  staleRunWarningSignature = staleSignature;
  await Promise.all([recoverImageTasks(), recoverSubjectChecks()]);
}

const heartbeatKey = imageWorkerHeartbeatKey(environment.TASK_QUEUE_NAME);
async function refreshHeartbeat(): Promise<void> {
  await imageConnection.set(
    heartbeatKey,
    new Date().toISOString(),
    "PX",
    IMAGE_WORKER_HEARTBEAT_TTL_MS
  );
}

await Promise.all([imageWorker.waitUntilReady(), subjectWorker.waitUntilReady()]);
await refreshHeartbeat();
await outbox.dispatchPending();
await recoverWorkflowState();
const heartbeatTimer = setInterval(
  () => void refreshHeartbeat().catch((error) => logger.error("heartbeat_failed", error)),
  Math.floor(IMAGE_WORKER_HEARTBEAT_TTL_MS / 3)
);
heartbeatTimer.unref();
const outboxTimer = setInterval(
  () =>
    void outbox.dispatchPending().catch((error) => logger.error("outbox_dispatch_failed", error)),
  2_000
);
outboxTimer.unref();
const recoveryTimer = setInterval(
  () => void recoverWorkflowState().catch((error) => logger.error("recovery_failed", error)),
  30_000
);
recoveryTimer.unref();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown_started", { signal });
  clearInterval(heartbeatTimer);
  clearInterval(outboxTimer);
  clearInterval(recoveryTimer);
  await Promise.all([
    imageWorker.close(),
    subjectWorker.close(),
    imageQueue.close(),
    subjectQueue.close()
  ]);
  await imageConnection.del(heartbeatKey).catch(() => undefined);
  imageConnection.disconnect();
  subjectConnection.disconnect();
  await database.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
