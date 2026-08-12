import { and, asc, eq, inArray, lt, notExists } from "drizzle-orm";

import {
  creationRuns,
  generationTasks,
  generationTaskUnits,
  subjectConsistencyChecks,
  type DatabaseConnection
} from "@chaoren/database";

export class CreationRunCoordinator {
  public constructor(private readonly connection: DatabaseConnection) {}

  public async markRunningByTaskId(taskId: string): Promise<void> {
    const runId = await this.findRunIdByTaskId(taskId);
    if (!runId) return;
    await this.connection.db
      .update(creationRuns)
      .set({ status: "running", updatedAt: new Date() })
      .where(and(eq(creationRuns.id, runId), eq(creationRuns.status, "queued")));
  }

  public async finalizeByTaskId(taskId: string): Promise<void> {
    const runId = await this.findRunIdByTaskId(taskId);
    if (runId) await this.finalize(runId);
  }

  public async finalizeByCheckId(checkId: string): Promise<void> {
    const [row] = await this.connection.db
      .select({ runId: generationTasks.creationRunId })
      .from(subjectConsistencyChecks)
      .innerJoin(generationTasks, eq(subjectConsistencyChecks.generationTaskId, generationTasks.id))
      .where(eq(subjectConsistencyChecks.id, checkId))
      .limit(1);
    if (row) await this.finalize(row.runId);
  }

  public async finalizeOrphanedRuns(): Promise<number> {
    return (await this.finalizeOrphanedRunDetails()).length;
  }

  public async finalizeOrphanedRunDetails(now = new Date()): Promise<FinalizedCreationRun[]> {
    const finalized = await this.connection.db
      .update(creationRuns)
      .set({ status: "terminal", updatedAt: now })
      .where(this.finalizableRunWhere())
      .returning({ id: creationRuns.id, createdAt: creationRuns.createdAt });
    return finalized.map((run) => ({
      runId: run.id,
      ageMs: Math.max(0, now.getTime() - run.createdAt.getTime()),
      reason: "no_active_units_checks_or_legacy_tasks" as const
    }));
  }

  public async findStaleActiveRuns(
    olderThanMs: number,
    now = new Date(),
    limit = 100
  ): Promise<StaleActiveCreationRun[]> {
    const rows = await this.connection.db
      .select({
        id: creationRuns.id,
        status: creationRuns.status,
        createdAt: creationRuns.createdAt,
        updatedAt: creationRuns.updatedAt
      })
      .from(creationRuns)
      .where(
        and(
          inArray(creationRuns.status, ["queued", "running", "cancelling"]),
          lt(creationRuns.createdAt, new Date(now.getTime() - olderThanMs))
        )
      )
      .orderBy(asc(creationRuns.createdAt))
      .limit(limit);
    return rows.flatMap((run) => {
      if (!isActiveCreationRunStatus(run.status)) return [];
      return [
        {
          runId: run.id,
          status: run.status,
          ageMs: Math.max(0, now.getTime() - run.createdAt.getTime()),
          unchangedForMs: Math.max(0, now.getTime() - run.updatedAt.getTime())
        }
      ];
    });
  }

  private async findRunIdByTaskId(taskId: string): Promise<string | undefined> {
    const [row] = await this.connection.db
      .select({ runId: generationTasks.creationRunId })
      .from(generationTasks)
      .where(eq(generationTasks.id, taskId))
      .limit(1);
    return row?.runId;
  }

  private async finalize(runId: string): Promise<void> {
    await this.connection.db
      .update(creationRuns)
      .set({ status: "terminal", updatedAt: new Date() })
      .where(this.finalizableRunWhere(runId));
  }

  private finalizableRunWhere(runId?: string) {
    const activeStatuses = ["queued", "running"] as const;
    return and(
      runId ? eq(creationRuns.id, runId) : undefined,
      inArray(creationRuns.status, activeStatuses),
      notExists(
        this.connection.db
          .select({ id: generationTaskUnits.id })
          .from(generationTaskUnits)
          .innerJoin(generationTasks, eq(generationTaskUnits.taskId, generationTasks.id))
          .where(
            and(
              eq(generationTasks.creationRunId, creationRuns.id),
              inArray(generationTaskUnits.status, activeStatuses)
            )
          )
      ),
      notExists(
        this.connection.db
          .select({ id: subjectConsistencyChecks.id })
          .from(subjectConsistencyChecks)
          .innerJoin(
            generationTasks,
            eq(subjectConsistencyChecks.generationTaskId, generationTasks.id)
          )
          .where(
            and(
              eq(generationTasks.creationRunId, creationRuns.id),
              inArray(subjectConsistencyChecks.status, activeStatuses)
            )
          )
      ),
      // Legacy tasks have no units, so their own task status remains the executable state.
      notExists(
        this.connection.db
          .select({ id: generationTasks.id })
          .from(generationTasks)
          .where(
            and(
              eq(generationTasks.creationRunId, creationRuns.id),
              inArray(generationTasks.status, activeStatuses),
              notExists(
                this.connection.db
                  .select({ id: generationTaskUnits.id })
                  .from(generationTaskUnits)
                  .where(eq(generationTaskUnits.taskId, generationTasks.id))
              )
            )
          )
      )
    );
  }
}

export interface FinalizedCreationRun {
  runId: string;
  ageMs: number;
  reason: "no_active_units_checks_or_legacy_tasks";
}

export interface StaleActiveCreationRun {
  runId: string;
  status: "queued" | "running" | "cancelling";
  ageMs: number;
  unchangedForMs: number;
}

function isActiveCreationRunStatus(
  status: "queued" | "running" | "cancelling" | "terminal" | "cancelled"
): status is StaleActiveCreationRun["status"] {
  return status === "queued" || status === "running" || status === "cancelling";
}
