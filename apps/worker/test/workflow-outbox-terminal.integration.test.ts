import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createDatabase,
  creationRuns,
  generationTasks,
  generationTaskUnits,
  projects,
  requirementRuns,
  workflowEvents
} from "@chaoren/database";
import { resolveWorkspacePath } from "@chaoren/storage";

import { DrizzleImageGenerationTaskStore } from "../src/image-generation-task.store.js";
import type { SubjectConsistencyTaskStore } from "../src/subject-consistency-task.store.js";
import { WorkflowOutboxDispatcher } from "../src/workflow-outbox.dispatcher.js";

const enabled = process.env.RUN_WORKER_INTEGRATION_TESTS === "1";

describe.skipIf(!enabled)("Workflow outbox terminal transition", () => {
  it("rolls back the unit failure when the event terminal write fails", async () => {
    config({ path: await resolveWorkspacePath(".env"), quiet: true });
    const database = createDatabase(testDatabaseUrl(process.env));
    const store = new DrizzleImageGenerationTaskStore(database);
    const ids = {
      user: randomUUID(),
      project: randomUUID(),
      requirement: randomUUID(),
      run: randomUUID(),
      task: randomUUID(),
      unit: randomUUID(),
      event: randomUUID()
    };
    const triggerName = "test_reject_workflow_terminal_update";
    const functionName = "test_reject_workflow_terminal_update_fn";
    const now = new Date();

    try {
      await database.db.insert(projects).values({
        id: ids.project,
        ownerUserId: ids.user,
        name: "Outbox terminal integration",
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
      await database.db.insert(creationRuns).values({
        id: ids.run,
        userId: ids.user,
        projectId: ids.project,
        requirementRunId: ids.requirement,
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      await database.db.insert(generationTasks).values({
        id: ids.task,
        creationRunId: ids.run,
        userId: ids.user,
        projectId: ids.project,
        requirementRunId: ids.requirement,
        idempotencyKey: randomUUID(),
        kind: "image",
        modelId: "openai-image",
        instruction: "integration test",
        instructionVersion: "integration-test",
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      await database.db.insert(generationTaskUnits).values({
        id: ids.unit,
        taskId: ids.task,
        position: 0,
        groupPosition: 0,
        variantPosition: 0,
        outputLayout: "separate_image",
        instruction: "integration test",
        requirementSnapshot: {
          imageCount: 1,
          aspectRatio: "1:1",
          intent: "integration test",
          scene: null,
          background: null,
          composition: null,
          lighting: null,
          style: null,
          mustKeep: [],
          mustAvoid: [],
          subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
        },
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      await database.db.insert(workflowEvents).values({
        id: ids.event,
        runId: ids.run,
        sequence: 1,
        eventType: "generation.unit.enqueue",
        entityType: "generation_task_unit",
        entityId: ids.unit,
        payload: { taskId: ids.task, unitId: ids.unit },
        publishAttempts: 12,
        lastError: "queue unavailable",
        createdAt: now
      });

      await database.db.execute(
        sql.raw(`
        CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger AS $$
        BEGIN
          IF NEW.id = '${ids.event}'::uuid AND NEW.terminal_at IS NOT NULL THEN
            RAISE EXCEPTION 'intentional terminal write failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER ${triggerName}
        BEFORE UPDATE ON workflow_events
        FOR EACH ROW EXECUTE FUNCTION ${functionName}();
      `)
      );

      await expect(store.markQueueDeliveryFailed(ids.event, ids.unit)).rejects.toThrow();
      await expect(readState(database, ids)).resolves.toMatchObject({
        unitStatus: "queued",
        taskStatus: "queued",
        runStatus: "queued",
        terminalAt: null
      });

      await database.db.execute(
        sql.raw(`DROP TRIGGER ${triggerName} ON workflow_events; DROP FUNCTION ${functionName}();`)
      );
      const dispatcher = new WorkflowOutboxDispatcher(
        database,
        {
          enqueueUnit: () => Promise.reject(new Error("queue remains unavailable")),
          close: () => Promise.resolve()
        },
        {
          enqueue: () => Promise.reject(new Error("subject queue remains unavailable")),
          close: () => Promise.resolve()
        },
        store,
        {} as SubjectConsistencyTaskStore
      );
      await dispatcher.dispatchPending();
      const state = await readState(database, ids);
      expect(state.unitStatus).toBe("failed");
      expect(state.taskStatus).toBe("failed");
      expect(state.runStatus).toBe("terminal");
      expect(state.terminalAt).toBeInstanceOf(Date);
    } finally {
      await database.db
        .execute(
          sql.raw(
            `DROP TRIGGER IF EXISTS ${triggerName} ON workflow_events; DROP FUNCTION IF EXISTS ${functionName}();`
          )
        )
        .catch(() => undefined);
      await database.db
        .delete(creationRuns)
        .where(eq(creationRuns.id, ids.run))
        .catch(() => undefined);
      await database.db
        .delete(requirementRuns)
        .where(eq(requirementRuns.id, ids.requirement))
        .catch(() => undefined);
      await database.db
        .delete(projects)
        .where(eq(projects.id, ids.project))
        .catch(() => undefined);
      await database.close();
    }
  });
});

async function readState(
  database: ReturnType<typeof createDatabase>,
  ids: { run: string; task: string; unit: string; event: string }
) {
  const [[unit], [task], [run], [event]] = await Promise.all([
    database.db
      .select({ status: generationTaskUnits.status })
      .from(generationTaskUnits)
      .where(eq(generationTaskUnits.id, ids.unit)),
    database.db
      .select({ status: generationTasks.status })
      .from(generationTasks)
      .where(eq(generationTasks.id, ids.task)),
    database.db
      .select({ status: creationRuns.status })
      .from(creationRuns)
      .where(eq(creationRuns.id, ids.run)),
    database.db
      .select({ terminalAt: workflowEvents.terminalAt })
      .from(workflowEvents)
      .where(eq(workflowEvents.id, ids.event))
  ]);
  return {
    unitStatus: unit?.status,
    taskStatus: task?.status,
    runStatus: run?.status,
    terminalAt: event?.terminalAt ?? null
  };
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
