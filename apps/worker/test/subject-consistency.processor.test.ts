import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  environmentSchema,
  type FinalRequirement,
  type SubjectInspectionResult,
  type SubjectRequirementReconciliation
} from "@chaoren/contracts";
import type { StoragePort } from "@chaoren/storage";
import { SubjectConsistencyProcessor } from "../src/subject-consistency.processor.js";
import type { ImageGenerationQueuePublisher } from "../src/image-generation.queue.js";
import type {
  SubjectConsistencyTaskStore,
  WorkerSubjectConsistencyTask
} from "../src/subject-consistency-task.store.js";

const environment = environmentSchema.parse({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
  REDIS_URL: "redis://127.0.0.1:6379",
  REQUIREMENT_AI_API_KEY: "requirement-key",
  SUBJECT_INSPECTION_AI_API_KEY: "inspection-key"
});
const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const requirement: FinalRequirement = {
  imageCount: 1,
  aspectRatio: "1:1",
  intent: "只更换为圣诞背景",
  scene: "圣诞场景",
  background: "红色圣诞背景",
  composition: null,
  lighting: null,
  style: null,
  mustKeep: [],
  mustAvoid: [],
  subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
};

const failedResult: Extract<SubjectInspectionResult, { verdict: "failed" }> = {
  schemaVersion: "2.0",
  verdict: "failed",
  summary: "商品颜色被改变",
  differences: [
    {
      feature: "color",
      featureGroup: "surface",
      featureLabel: "颜色",
      type: "COLOR_CHANGED",
      changeKind: "changed",
      severity: "major",
      sourceObservation: "原商品为白色",
      generatedObservation: "生成商品为红色",
      authorization: "default_preserve",
      reason: "用户只要求更换背景"
    }
  ]
};

const passedResult: Extract<SubjectInspectionResult, { verdict: "passed" }> = {
  schemaVersion: "2.0",
  verdict: "passed",
  summary: "主体保持一致",
  differences: []
};

const reconciliation: Extract<SubjectRequirementReconciliation, { action: "retry_inspection" }> = {
  schemaVersion: "2.0",
  action: "retry_inspection",
  repairType: "reinforce_preservation",
  patch: {
    addMustKeep: ["商品保持白色"],
    addMustAvoid: []
  },
  summary: "用户没有授权商品改色"
};

const constrainedReconciliation: Extract<
  SubjectRequirementReconciliation,
  { action: "retry_inspection"; schemaVersion: "2.0" }
> = {
  schemaVersion: "2.0",
  action: "retry_inspection",
  repairType: "reinforce_preservation",
  patch: {
    addMustKeep: ["商品保持白色"],
    addMustAvoid: ["不得将商品改为红色"]
  },
  summary: "仅强化未授权的颜色保持约束"
};

const regenerationReconciliation: Extract<
  SubjectRequirementReconciliation,
  { action: "retry_inspection"; schemaVersion: "2.0" }
> = {
  ...constrainedReconciliation,
  repairType: "reinforce_preservation"
};

function createTask(
  overrides: Partial<WorkerSubjectConsistencyTask> = {}
): WorkerSubjectConsistencyTask {
  return {
    id: "00000000-0000-4000-8000-000000000040",
    userId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000010",
    generationTaskId: "00000000-0000-4000-8000-000000000020",
    requirementRunId: "00000000-0000-4000-8000-000000000030",
    status: "queued",
    phase: "initial_inspection",
    originalUserText: "换成红色圣诞背景",
    originalRequirement: structuredClone(requirement),
    sourceProducts: [
      {
        id: "00000000-0000-4000-8000-000000000011",
        storageKey: "source.png",
        mimeType: "image/png"
      }
    ],
    subjectEntities: [
      {
        entityKey: "legacy_product",
        label: "历史商品主体",
        sourceProductIds: ["00000000-0000-4000-8000-000000000011"]
      }
    ],
    generatedCandidate: {
      id: "00000000-0000-4000-8000-000000000012",
      storageKey: "generated.png",
      mimeType: "image/png"
    },
    watermarkAsset: null,
    deliverySettings: {
      outputFormat: "png",
      watermark: { enabled: false, assetId: null, position: "bottom_right" }
    },
    repair: null,
    attempts: [],
    reconciliation: null,
    ...overrides
  };
}

class FakeStore implements SubjectConsistencyTaskStore {
  public completed: Array<{ verdict: "passed" | "rejected"; message: string }> = [];
  public sourceUnusable: string[] = [];
  public attempts = new Map<number, SubjectInspectionResult>();
  public savedReconciliation: SubjectRequirementReconciliation | null = null;
  public repairRequirement: FinalRequirement | null = null;
  public cancelRequested = false;

  public constructor(public task = createTask()) {}

  public load(): Promise<WorkerSubjectConsistencyTask> {
    return Promise.resolve(structuredClone(this.task));
  }
  public claim(): Promise<boolean> {
    return Promise.resolve(true);
  }
  public isCancelled(): Promise<boolean> {
    return Promise.resolve(this.cancelRequested);
  }
  public saveAttempt(
    _checkId: string,
    round: 1 | 2,
    _requirement: FinalRequirement,
    result: SubjectInspectionResult
  ): Promise<void> {
    this.attempts.set(round, result);
    return Promise.resolve();
  }
  public saveReconciliation(
    _checkId: string,
    value: SubjectRequirementReconciliation
  ): Promise<void> {
    this.savedReconciliation = value;
    return Promise.resolve();
  }
  public createOrFindRepair(
    _checkId: string,
    value: FinalRequirement
  ): Promise<{ generationTaskId: string; created: boolean }> {
    this.repairRequirement = value;
    return Promise.resolve({
      generationTaskId: "00000000-0000-4000-8000-000000000060",
      created: true
    });
  }
  public markRepairEnqueued(): Promise<void> {
    return Promise.resolve();
  }
  public markSourceUnusable(_checkId: string, message: string): Promise<void> {
    this.sourceUnusable.push(message);
    return Promise.resolve();
  }
  public complete(
    _checkId: string,
    verdict: "passed" | "rejected",
    message: string
  ): Promise<void> {
    this.completed.push({ verdict, message });
    return Promise.resolve();
  }
  public markExecutionFailed(): Promise<void> {
    return Promise.resolve();
  }
  public findRecoverableIds(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

class MemoryStorage implements StoragePort {
  public constructor(private readonly contentByKey: Record<string, Buffer> = {}) {}

  public put(): Promise<{ key: string; byteSize: number }> {
    throw new Error("not implemented");
  }
  public read(key: string): Promise<Readable> {
    return Promise.resolve(Readable.from([this.contentByKey[key] ?? validPng]));
  }
  public exists(): Promise<boolean> {
    return Promise.resolve(true);
  }
  public delete(): Promise<void> {
    return Promise.resolve();
  }
}

function createProcessor(
  store: FakeStore,
  inspectionResults: SubjectInspectionResult[],
  reconciliationResult: SubjectRequirementReconciliation = reconciliation,
  imageQueue?: ImageGenerationQueuePublisher
) {
  const inspect = vi.fn((input: unknown) => {
    void input;
    return Promise.resolve(inspectionResults.shift());
  });
  const reconcile = vi.fn((input: unknown) => {
    void input;
    return Promise.resolve(reconciliationResult);
  });
  const processor = new SubjectConsistencyProcessor(
    environment,
    store,
    new MemoryStorage(),
    { inspect },
    { reconcile },
    imageQueue
  );
  return { processor, inspect, reconcile };
}

describe("SubjectConsistencyProcessor", () => {
  it("aborts an active inspection and persists no phase result after cancellation", async () => {
    const store = new FakeStore();
    store.cancelRequested = true;
    let receivedSignal: AbortSignal | undefined;
    const inspect = vi.fn((input: { signal?: AbortSignal }) => {
      receivedSignal = input.signal;
      return new Promise((_resolve, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => {
            const reason: unknown = input.signal?.reason;
            reject(reason instanceof Error ? reason : new Error("inspection cancelled"));
          },
          { once: true }
        );
      });
    });
    const processor = new SubjectConsistencyProcessor(
      environment,
      store,
      new MemoryStorage(),
      { inspect },
      { reconcile: vi.fn() }
    );

    await expect(processor.execute(store.task.id)).rejects.toMatchObject({
      code: "SUBJECT_CONSISTENCY_CHECK_CANCELLED"
    });
    expect(receivedSignal?.aborted).toBe(true);
    expect(store.attempts.size).toBe(0);
    expect(store.completed).toEqual([]);
  });

  it("rejects an invalid generated candidate before calling the quality model", async () => {
    const store = new FakeStore();
    const inspect = vi.fn();
    const processor = new SubjectConsistencyProcessor(
      environment,
      store,
      new MemoryStorage({ generated: Buffer.from("<!doctype html><title>New API</title>") }),
      { inspect },
      { reconcile: vi.fn() }
    );
    store.task.generatedCandidate.storageKey = "generated";

    await expect(processor.execute(store.task.id)).rejects.toMatchObject({
      code: "INVALID_GENERATED_CANDIDATE"
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it("repairs an invalid AI envelope without consuming a business inspection round", async () => {
    const store = new FakeStore();
    const inspect = vi.fn(() =>
      Promise.resolve({ schemaVersion: "2.0", verdict: "passed", summary: 123 })
    );
    const repairOutput = vi.fn(() => Promise.resolve(passedResult));
    const processor = new SubjectConsistencyProcessor(
      environment,
      store,
      new MemoryStorage(),
      { inspect, repairOutput },
      { reconcile: vi.fn() }
    );

    await processor.execute(store.task.id);

    expect(repairOutput).toHaveBeenCalledTimes(1);
    expect(store.attempts.size).toBe(1);
    expect(store.attempts.get(1)?.verdict).toBe("passed");
  });

  it("completes after the first inspection passes", async () => {
    const store = new FakeStore();
    const { processor, inspect, reconcile } = createProcessor(store, [passedResult]);

    await processor.execute(store.task.id);

    expect(inspect).toHaveBeenCalledTimes(1);
    expect(reconcile).not.toHaveBeenCalled();
    expect(store.completed[0]).toEqual({ verdict: "passed", message: "主体保持一致" });
  });

  it("applies only the constrained patch and keeps the original creative requirement immutable", async () => {
    const store = new FakeStore();
    const imageQueue: ImageGenerationQueuePublisher = {
      enqueue: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve())
    };
    const { processor, inspect } = createProcessor(
      store,
      [failedResult],
      constrainedReconciliation,
      imageQueue
    );

    await processor.execute(store.task.id);

    expect(inspect).toHaveBeenCalledTimes(1);
    expect(store.repairRequirement).toMatchObject({
      imageCount: requirement.imageCount,
      aspectRatio: requirement.aspectRatio,
      intent: requirement.intent,
      scene: requirement.scene,
      background: requirement.background,
      composition: requirement.composition,
      lighting: requirement.lighting,
      style: requirement.style,
      subjectPolicy: requirement.subjectPolicy
    });
    expect(store.repairRequirement?.mustKeep).toContain("商品保持白色");
    expect(store.repairRequirement?.mustAvoid).toContain("不得将商品改为红色");
  });

  it("creates one repair generation from the original requirement instead of rechecking image A", async () => {
    const store = new FakeStore();
    const enqueue = vi.fn(() => Promise.resolve());
    const imageQueue: ImageGenerationQueuePublisher = {
      enqueue,
      close: vi.fn(() => Promise.resolve())
    };
    const { processor, inspect } = createProcessor(
      store,
      [failedResult],
      regenerationReconciliation,
      imageQueue
    );

    await processor.execute(store.task.id);

    expect(inspect).toHaveBeenCalledTimes(1);
    expect(store.completed).toHaveLength(0);
    expect(store.repairRequirement?.imageCount).toBe(1);
    expect(store.repairRequirement?.mustKeep).toContain("商品保持白色");
    expect(enqueue).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000060");
  });

  it("uses the repaired image B for the second inspection", async () => {
    const store = new FakeStore(
      createTask({
        status: "queued",
        phase: "final_inspection",
        attempts: [{ round: 1, requirement: structuredClone(requirement), result: failedResult }],
        reconciliation: regenerationReconciliation,
        repair: {
          generationTaskId: "00000000-0000-4000-8000-000000000060",
          status: "succeeded",
          generatedCandidate: {
            id: "00000000-0000-4000-8000-000000000061",
            storageKey: "repair.png",
            mimeType: "image/png"
          },
          error: null
        }
      })
    );
    const imageQueue: ImageGenerationQueuePublisher = {
      enqueue: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve())
    };
    const { processor, inspect } = createProcessor(
      store,
      [passedResult],
      regenerationReconciliation,
      imageQueue
    );

    await processor.execute(store.task.id);

    expect(inspect).toHaveBeenCalledTimes(1);
    const secondInput = inspect.mock.calls[0]?.[0] as {
      round: number;
      generatedCandidate: { content: Buffer };
    };
    expect(secondInput.round).toBe(2);
    expect(secondInput.generatedCandidate.content).toEqual(validPng);
    expect(store.completed[0]?.verdict).toBe("passed");
  });

  it("rejects the image when the final inspection still fails", async () => {
    const store = new FakeStore(
      createTask({
        phase: "final_inspection",
        attempts: [{ round: 1, requirement: structuredClone(requirement), result: failedResult }],
        reconciliation,
        repair: {
          generationTaskId: "00000000-0000-4000-8000-000000000060",
          status: "succeeded",
          generatedCandidate: {
            id: "00000000-0000-4000-8000-000000000061",
            storageKey: "repair.png",
            mimeType: "image/png"
          },
          error: null
        }
      })
    );
    const imageQueue: ImageGenerationQueuePublisher = {
      enqueue: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve())
    };
    const { processor } = createProcessor(store, [failedResult], reconciliation, imageQueue);

    await processor.execute(store.task.id);

    expect(store.completed[0]?.verdict).toBe("rejected");
    expect(store.completed[0]?.message).toContain("请改变需求或者更换商品图片");
  });

  it("stops with a source replacement message when comparable evidence is insufficient", async () => {
    const store = new FakeStore();
    const sourceUnusable: SubjectInspectionResult = {
      schemaVersion: "2.0",
      verdict: "source_unusable",
      summary: "原图无法支持判断",
      reason: "insufficient_source_evidence"
    };
    const { processor, reconcile } = createProcessor(store, [sourceUnusable]);

    await processor.execute(store.task.id);

    expect(reconcile).not.toHaveBeenCalled();
    expect(store.sourceUnusable[0]).toBe("原图无法支持判断");
  });

  it("resumes from the persisted reconciliation without repeating completed calls", async () => {
    const store = new FakeStore(
      createTask({
        status: "running",
        phase: "final_inspection",
        attempts: [{ round: 1, requirement: structuredClone(requirement), result: failedResult }],
        reconciliation,
        repair: {
          generationTaskId: "00000000-0000-4000-8000-000000000060",
          status: "succeeded",
          generatedCandidate: {
            id: "00000000-0000-4000-8000-000000000061",
            storageKey: "repair.png",
            mimeType: "image/png"
          },
          error: null
        }
      })
    );
    const imageQueue: ImageGenerationQueuePublisher = {
      enqueue: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve())
    };
    const {
      processor,
      inspect,
      reconcile: reconcileCall
    } = createProcessor(store, [passedResult], reconciliation, imageQueue);

    await processor.execute(store.task.id);

    expect(inspect).toHaveBeenCalledTimes(1);
    expect(reconcileCall).not.toHaveBeenCalled();
    expect(store.completed[0]?.verdict).toBe("passed");
  });
});
