import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createDatabase,
  creationRuns,
  generationTasks,
  generationTaskUnits,
  mediaAssets,
  projects,
  requirementRuns,
  subjectConsistencyChecks
} from "@chaoren/database";
import { resolveWorkspacePath } from "@chaoren/storage";

import { CreationRunCoordinator } from "../src/creation-run.coordinator.js";

const enabled = process.env.RUN_WORKER_INTEGRATION_TESTS === "1";

describe.skipIf(!enabled)("Creation Run reconciliation", () => {
  it("is idempotent and never finalizes runs with executable child work", async () => {
    config({ path: await resolveWorkspacePath(".env"), quiet: true });
    const database = createDatabase(testDatabaseUrl(process.env));
    const now = new Date("2026-08-12T01:00:00.000Z");
    const ids = {
      user: randomUUID(),
      project: randomUUID(),
      requirement: randomUUID(),
      asset: randomUUID(),
      orphanRun: randomUUID(),
      unitRun: randomUUID(),
      legacyRun: randomUUID(),
      checkRun: randomUUID(),
      terminalRun: randomUUID(),
      cancelledRun: randomUUID(),
      orphanTask: randomUUID(),
      unitTask: randomUUID(),
      legacyTask: randomUUID(),
      checkTask: randomUUID(),
      repairTask: randomUUID(),
      unit: randomUUID(),
      checkUnit: randomUUID(),
      check: randomUUID()
    };
    const runIds = [
      ids.orphanRun,
      ids.unitRun,
      ids.legacyRun,
      ids.checkRun,
      ids.terminalRun,
      ids.cancelledRun
    ];
    const taskIds = [ids.orphanTask, ids.unitTask, ids.legacyTask, ids.checkTask, ids.repairTask];
    const coordinator = new CreationRunCoordinator(database);

    try {
      await database.db.insert(projects).values({
        id: ids.project,
        ownerUserId: ids.user,
        name: "Creation Run reconciliation",
        createdAt: now,
        updatedAt: now
      });
      await database.db.insert(requirementRuns).values({
        id: ids.requirement,
        userId: ids.user,
        projectId: ids.project,
        request: {},
        result: {},
        aiModel: "integration-test",
        promptVersion: "integration-test",
        createdAt: now
      });
      await database.db.insert(mediaAssets).values({
        id: ids.asset,
        userId: ids.user,
        projectId: ids.project,
        kind: "image",
        origin: "generated",
        contentSha256: null,
        storageKey: `integration/${ids.asset}.png`,
        mimeType: "image/png",
        byteSize: 1,
        originalFileName: "generated.png",
        createdAt: now
      });
      await database.db
        .insert(creationRuns)
        .values([
          runRow(ids.orphanRun, "running", ids, now),
          runRow(ids.unitRun, "running", ids, now),
          runRow(ids.legacyRun, "running", ids, now),
          runRow(ids.checkRun, "running", ids, now),
          runRow(ids.terminalRun, "terminal", ids, now),
          runRow(ids.cancelledRun, "cancelled", ids, now)
        ]);
      await database.db
        .insert(generationTasks)
        .values([
          taskRow(ids.orphanTask, ids.orphanRun, "succeeded", ids, now),
          taskRow(ids.unitTask, ids.unitRun, "running", ids, now),
          taskRow(ids.legacyTask, ids.legacyRun, "running", ids, now),
          taskRow(ids.checkTask, ids.checkRun, "succeeded", ids, now),
          taskRow(ids.repairTask, ids.checkRun, "succeeded", ids, new Date(now.getTime() + 1_000))
        ]);
      await database.db
        .insert(generationTaskUnits)
        .values([
          unitRow(ids.unit, ids.unitTask, "running", 0, now),
          unitRow(ids.checkUnit, ids.checkTask, "succeeded", 0, now)
        ]);
      await database.db.insert(subjectConsistencyChecks).values({
        id: ids.check,
        userId: ids.user,
        projectId: ids.project,
        generationTaskId: ids.checkTask,
        generationUnitId: ids.checkUnit,
        requirementRunId: ids.requirement,
        generatedAssetId: ids.asset,
        status: "running",
        phase: "repair_generation",
        inspectionModel: "integration-test",
        requirementModel: "integration-test",
        workflowVersion: "integration-test",
        createdAt: now,
        updatedAt: now
      });

      await expect(coordinator.finalizeOrphanedRuns()).resolves.toBe(1);
      await expect(coordinator.finalizeOrphanedRuns()).resolves.toBe(0);
      await expect(
        coordinator.findStaleActiveRuns(15 * 60_000, new Date("2026-08-12T02:00:00.000Z"))
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ runId: ids.unitRun, status: "running" }),
          expect.objectContaining({ runId: ids.legacyRun, status: "running" }),
          expect.objectContaining({ runId: ids.checkRun, status: "running" })
        ])
      );
      await expect(runStatuses(database, runIds)).resolves.toMatchObject({
        [ids.orphanRun]: "terminal",
        [ids.unitRun]: "running",
        [ids.legacyRun]: "running",
        [ids.checkRun]: "running",
        [ids.terminalRun]: "terminal",
        [ids.cancelledRun]: "cancelled"
      });

      await database.db
        .update(generationTaskUnits)
        .set({ status: "succeeded", updatedAt: new Date() })
        .where(eq(generationTaskUnits.id, ids.unit));
      await database.db
        .update(generationTasks)
        .set({ status: "succeeded", updatedAt: new Date() })
        .where(eq(generationTasks.id, ids.unitTask));
      await Promise.all([
        coordinator.finalizeByTaskId(ids.unitTask),
        coordinator.finalizeOrphanedRuns()
      ]);
      await expect(runStatus(database, ids.unitRun)).resolves.toBe("terminal");

      await database.db
        .update(subjectConsistencyChecks)
        .set({ status: "completed", verdict: "passed", updatedAt: new Date() })
        .where(eq(subjectConsistencyChecks.id, ids.check));
      await Promise.all([
        coordinator.finalizeByCheckId(ids.check),
        coordinator.finalizeOrphanedRuns()
      ]);
      await expect(runStatus(database, ids.checkRun)).resolves.toBe("terminal");

      await database.db
        .update(generationTasks)
        .set({ status: "succeeded", updatedAt: new Date() })
        .where(eq(generationTasks.id, ids.legacyTask));
      await expect(coordinator.finalizeOrphanedRuns()).resolves.toBe(1);
      await expect(coordinator.finalizeOrphanedRuns()).resolves.toBe(0);
      await expect(runStatus(database, ids.legacyRun)).resolves.toBe("terminal");
    } finally {
      await database.db.delete(generationTasks).where(inArray(generationTasks.id, taskIds));
      await database.db.delete(creationRuns).where(inArray(creationRuns.id, runIds));
      await database.db.delete(mediaAssets).where(eq(mediaAssets.id, ids.asset));
      await database.db.delete(requirementRuns).where(eq(requirementRuns.id, ids.requirement));
      await database.db.delete(projects).where(eq(projects.id, ids.project));
      await database.close();
    }
  });
});

function runRow(
  id: string,
  status: "running" | "terminal" | "cancelled",
  ids: { user: string; project: string; requirement: string },
  now: Date
) {
  return {
    id,
    userId: ids.user,
    projectId: ids.project,
    requirementRunId: ids.requirement,
    status,
    createdAt: now,
    updatedAt: now
  };
}

function taskRow(
  id: string,
  creationRunId: string,
  status: "running" | "succeeded",
  ids: { user: string; project: string; requirement: string },
  now: Date
) {
  return {
    id,
    creationRunId,
    userId: ids.user,
    projectId: ids.project,
    requirementRunId: ids.requirement,
    idempotencyKey: randomUUID(),
    kind: "image" as const,
    modelId: "openai-image",
    instruction: "integration test",
    instructionVersion: "integration-test",
    status,
    createdAt: now,
    updatedAt: now
  };
}

function unitRow(
  id: string,
  taskId: string,
  status: "running" | "succeeded",
  position: number,
  now: Date
) {
  return {
    id,
    taskId,
    position,
    groupPosition: position,
    variantPosition: 0,
    outputLayout: "separate_image",
    instruction: "integration test",
    status,
    createdAt: now,
    updatedAt: now
  };
}

async function runStatus(database: ReturnType<typeof createDatabase>, runId: string) {
  const [row] = await database.db
    .select({ status: creationRuns.status })
    .from(creationRuns)
    .where(eq(creationRuns.id, runId));
  return row?.status;
}

async function runStatuses(database: ReturnType<typeof createDatabase>, runIds: string[]) {
  const rows = await database.db
    .select({ id: creationRuns.id, status: creationRuns.status })
    .from(creationRuns)
    .where(inArray(creationRuns.id, runIds));
  return Object.fromEntries(rows.map((row) => [row.id, row.status]));
}

function testDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  const testUrl = environment.TEST_DATABASE_URL?.trim();
  if (!testUrl) throw new Error("TEST_DATABASE_URL 未配置，Worker 集成测试已拒绝运行");
  const developmentUrl = environment.DATABASE_URL?.trim();
  if (developmentUrl && normalizeDatabaseUrl(testUrl) === normalizeDatabaseUrl(developmentUrl)) {
    throw new Error("TEST_DATABASE_URL 不能与 DATABASE_URL 相同");
  }
  const databaseName = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, ""));
  if (!/(^|[_-])test($|[_-])/.test(databaseName)) {
    throw new Error(`测试数据库名称必须包含独立的 test 标识，当前为 ${databaseName}`);
  }
  return testUrl;
}

function normalizeDatabaseUrl(value: string): string {
  const url = new URL(value);
  url.password = "";
  return url.toString().replace(/\/$/, "");
}
