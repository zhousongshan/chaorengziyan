import { Readable } from "node:stream";

import type { Job } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import {
  environmentSchema,
  IMAGE_GENERATION_JOB_NAME,
  IMAGE_GENERATION_UNIT_JOB_NAME,
  type ImageGenerationJobData,
  type ImageGenerationUnitJobData
} from "@chaoren/contracts";
import { ImageProviderError, type ImageGenerationPort } from "@chaoren/image-generation";
import type { StoragePort } from "@chaoren/storage";

import { ImageGenerationJobHandler } from "../src/image-generation-job.handler.js";
import {
  ImageGenerationCancelledError,
  ImageGenerationProcessor
} from "../src/image-generation.processor.js";
import type {
  ImageGenerationTaskStore,
  WorkerExecutableTask,
  WorkerFailedUnit,
  WorkerOutputAsset
} from "../src/image-generation-task.store.js";
import { WorkerTaskDataError } from "../src/image-generation-task.store.js";

const environment = environmentSchema.parse({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
  REDIS_URL: "redis://127.0.0.1:6379",
  OPENAI_IMAGE_API_KEY: "test-key",
  ENABLED_IMAGE_MODELS: "openai-image"
});
const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const task: WorkerExecutableTask = {
  id: "00000000-0000-4000-8000-000000000020",
  userId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000010",
  modelId: "openai-image",
  requirementRunId: "00000000-0000-4000-8000-000000000030",
  status: "queued",
  requirement: {
    imageCount: 1,
    aspectRatio: "1:1",
    intent: "生成白底商品图",
    scene: null,
    background: "纯白",
    composition: null,
    lighting: null,
    style: null,
    mustKeep: [],
    mustAvoid: [],
    subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
  },
  renderSettings: { resolutionPreset: "2k", providerQuality: "high" },
  deliverySettings: {
    outputFormat: "png",
    watermark: { enabled: false, assetId: null, position: "bottom_right" }
  },
  watermarkAsset: null,
  instruction: "请生成白底商品图并保持商品主体不变",
  sourceAssets: [
    {
      id: "00000000-0000-4000-8000-000000000011",
      storageKey: "source/product-front.png",
      mimeType: "image/png",
      role: "product"
    },
    {
      id: "00000000-0000-4000-8000-000000000012",
      storageKey: "source/product-detail.png",
      mimeType: "image/png",
      role: "product"
    },
    {
      id: "00000000-0000-4000-8000-000000000013",
      storageKey: "source/reference.png",
      mimeType: "image/png",
      role: "reference"
    }
  ]
};

class FakeTaskStore implements ImageGenerationTaskStore {
  public readonly succeeded: WorkerOutputAsset[][] = [];
  public readonly failed: Array<{ code: string; message: string }> = [];
  public consistency: { sourceProductAssetIds: string[] } | undefined;
  public unitFailures: WorkerFailedUnit[] = [];
  public failOnSuccess = false;
  public cancelRequested = false;
  public lateResults = 0;
  public previousFailedAttempt:
    Awaited<ReturnType<ImageGenerationTaskStore["loadPreviousFailedUnitAttempt"]>> | undefined =
    undefined;

  public constructor(private readonly taskRecord: WorkerExecutableTask = task) {}

  public load(): Promise<WorkerExecutableTask> {
    return Promise.resolve(structuredClone(this.taskRecord));
  }

  public markRunning(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public markSucceeded(
    _taskId: string,
    outputs: WorkerOutputAsset[],
    consistency?: { sourceProductAssetIds: string[] },
    failedUnits: WorkerFailedUnit[] = []
  ): Promise<string[]> {
    if (this.failOnSuccess) return Promise.reject(new Error("database unavailable"));
    this.succeeded.push(structuredClone(outputs));
    this.consistency = consistency;
    this.unitFailures = structuredClone(failedUnits);
    return Promise.resolve([]);
  }

  public markFailed(_taskId: string, error: { code: string; message: string }): Promise<void> {
    this.failed.push(error);
    return Promise.resolve();
  }

  public findRecoverableIds(): Promise<string[]> {
    return Promise.resolve([]);
  }

  public async loadUnit(_taskId: string, unitId: string) {
    const loaded = await this.load();
    const unit = loaded.units?.find((candidate) => candidate.id === unitId);
    return unit ? { task: loaded, unit } : undefined;
  }

  public claimUnit(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public startUnitAttempt(): Promise<void> {
    return Promise.resolve();
  }

  public loadPreviousFailedUnitAttempt() {
    return Promise.resolve(this.previousFailedAttempt);
  }

  public updateUnitAttemptProviderRequestId(): Promise<void> {
    return Promise.resolve();
  }

  public isUnitCancelled(): Promise<boolean> {
    return Promise.resolve(this.cancelRequested);
  }

  public failUnitAttempt(): Promise<void> {
    return Promise.resolve();
  }

  public completeUnitAttempt(): Promise<void> {
    return Promise.resolve();
  }
  public markLateResultDiscarded(): Promise<void> {
    this.lateResults += 1;
    return Promise.resolve();
  }
  public markSubjectCheckEnqueued(): Promise<void> {
    return Promise.resolve();
  }

  public markUnitSucceeded(
    taskId: string,
    _unitId: string,
    output: WorkerOutputAsset,
    consistency?: { sourceProductAssetIds: string[] }
  ): Promise<string[]> {
    return this.markSucceeded(taskId, [output], consistency);
  }

  public markUnitFailed(_unitId: string, error: { code: string; message: string }): Promise<void> {
    this.failed.push(error);
    return Promise.resolve();
  }

  public findRecoverableUnits(): Promise<Array<{ taskId: string; unitId: string }>> {
    return Promise.resolve([]);
  }
}

class MemoryStorage implements StoragePort {
  public readonly data = new Map<string, Buffer>([
    ["source/product-front.png", Buffer.from("product-front")],
    ["source/product-detail.png", Buffer.from("product-detail")],
    ["source/reference.png", Buffer.from("reference")]
  ]);
  public readonly deleted: string[] = [];

  public async put(key: string, content: Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of content) chunks.push(Buffer.from(chunk as Uint8Array));
    const value = Buffer.concat(chunks);
    this.data.set(key, value);
    return { key, byteSize: value.length };
  }

  public read(key: string): Promise<Readable> {
    const value = this.data.get(key);
    if (!value) return Promise.reject(new Error("missing object"));
    return Promise.resolve(Readable.from([value]));
  }

  public exists(key: string): Promise<boolean> {
    return Promise.resolve(this.data.has(key));
  }

  public delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.data.delete(key);
    return Promise.resolve();
  }
}

describe("ImageGenerationProcessor", () => {
  it("按原子单元使用各自原图，并在一个单元失败时保留其他结果", async () => {
    const unitTask: WorkerExecutableTask = {
      ...structuredClone(task),
      requirement: { ...task.requirement, imageCount: 2 },
      units: [
        {
          id: "00000000-0000-4000-8000-000000000041",
          position: 0,
          instruction: "只处理第一张原图",
          outputLayout: "separate_image",
          sourceAssets: [task.sourceAssets[0]!]
        },
        {
          id: "00000000-0000-4000-8000-000000000042",
          position: 1,
          instruction: "只处理第二张原图",
          outputLayout: "separate_image",
          sourceAssets: [task.sourceAssets[1]!]
        }
      ]
    };
    const store = new FakeTaskStore(unitTask);
    const generate = vi.fn((input: Parameters<ImageGenerationPort["generate"]>[0]) =>
      input.requestId.endsWith("42")
        ? Promise.reject(
            new ImageProviderError("IMAGE_PROVIDER_UNAVAILABLE", "第二张生图服务暂时不可用")
          )
        : Promise.resolve([{ content: validPng, mimeType: "image/png" as const }])
    );
    const processor = new ImageGenerationProcessor(environment, store, new MemoryStorage(), {
      generate
    });

    await processor.execute(unitTask.id);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(store.succeeded[0]).toHaveLength(1);
    expect(store.succeeded[0]?.[0]).toMatchObject({
      unitId: unitTask.units?.[0]?.id,
      unitPosition: 0,
      sourceProductAssetIds: [task.sourceAssets[0]!.id]
    });
    expect(store.unitFailures).toEqual([
      {
        unitId: unitTask.units?.[1]?.id,
        position: 1,
        error: {
          code: "IMAGE_PROVIDER_UNAVAILABLE",
          message: "第二张生图服务暂时不可用"
        }
      }
    ]);
  });

  it("does not reload or execute a task that already reached a terminal state", async () => {
    const store = {
      load: vi.fn(() =>
        Promise.resolve({
          id: task.id,
          userId: task.userId,
          projectId: task.projectId,
          modelId: task.modelId,
          requirementRunId: task.requirementRunId,
          status: "succeeded" as const,
          requirement: null,
          instruction: null,
          sourceAssets: [] as []
        })
      ),
      markRunning: vi.fn(),
      markSucceeded: vi.fn(),
      markFailed: vi.fn(),
      findRecoverableIds: vi.fn(() => Promise.resolve([])),
      loadUnit: vi.fn(),
      claimUnit: vi.fn(),
      startUnitAttempt: vi.fn(),
      loadPreviousFailedUnitAttempt: vi.fn(() => Promise.resolve(undefined)),
      updateUnitAttemptProviderRequestId: vi.fn(),
      isUnitCancelled: vi.fn(() => Promise.resolve(false)),
      failUnitAttempt: vi.fn(),
      completeUnitAttempt: vi.fn(),
      markLateResultDiscarded: vi.fn(),
      markSubjectCheckEnqueued: vi.fn(),
      markUnitSucceeded: vi.fn(),
      markUnitFailed: vi.fn(),
      findRecoverableUnits: vi.fn(() => Promise.resolve([]))
    } satisfies ImageGenerationTaskStore;
    const generate = vi.fn();
    const processor = new ImageGenerationProcessor(environment, store, new MemoryStorage(), {
      generate
    });

    await processor.execute(task.id);

    expect(store.markRunning).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("loads sources in role order and persists generated outputs for the task owner", async () => {
    const store = new FakeTaskStore();
    const storage = new MemoryStorage();
    const generate = vi.fn(() => Promise.resolve([{ content: validPng, mimeType: "image/png" }]));
    const processor = new ImageGenerationProcessor(environment, store, storage, { generate });

    await processor.execute(task.id);

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: task.instruction,
        sources: [
          expect.objectContaining({ role: "product", content: Buffer.from("product-front") }),
          expect.objectContaining({ role: "product", content: Buffer.from("product-detail") }),
          expect.objectContaining({ role: "reference", content: Buffer.from("reference") })
        ]
      })
    );
    expect(store.consistency?.sourceProductAssetIds).toEqual([
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012"
    ]);
    expect(store.succeeded[0]?.[0]).toMatchObject({
      userId: task.userId,
      projectId: task.projectId,
      mimeType: "image/png",
      byteSize: validPng.length
    });
  });

  it("delivers directly in the requested format when no product image requires quality checking", async () => {
    const directTask: WorkerExecutableTask = {
      ...structuredClone(task),
      sourceAssets: task.sourceAssets.filter((asset) => asset.role === "reference"),
      deliverySettings: {
        outputFormat: "jpeg",
        watermark: { enabled: false, assetId: null, position: "bottom_right" }
      }
    };
    const store = new FakeTaskStore(directTask);
    const qualityQueue = { enqueue: vi.fn(() => Promise.resolve()), close: vi.fn() };
    const processor = new ImageGenerationProcessor(
      environment,
      store,
      new MemoryStorage(),
      { generate: () => Promise.resolve([{ content: validPng, mimeType: "image/png" }]) },
      qualityQueue
    );

    await processor.execute(directTask.id);

    expect(store.succeeded[0]?.[0]?.mimeType).toBe("image/jpeg");
    expect(qualityQueue.enqueue).not.toHaveBeenCalled();
  });

  it("deletes files written by the attempt when the success transaction fails", async () => {
    const store = new FakeTaskStore();
    store.failOnSuccess = true;
    const storage = new MemoryStorage();
    const generator: ImageGenerationPort = {
      generate: () => Promise.resolve([{ content: validPng, mimeType: "image/png" }])
    };
    const processor = new ImageGenerationProcessor(environment, store, storage, generator);

    await expect(processor.execute(task.id)).rejects.toThrow("database unavailable");

    expect(storage.deleted).toHaveLength(1);
    expect(storage.deleted[0]).toContain(`generated/${task.projectId}/${task.id}/`);
  });

  it("rejects invalid generated bytes before storage and quality enqueue", async () => {
    const store = new FakeTaskStore();
    const storage = new MemoryStorage();
    const qualityQueue = { enqueue: vi.fn(() => Promise.resolve()), close: vi.fn() };
    const processor = new ImageGenerationProcessor(
      environment,
      store,
      storage,
      {
        generate: () =>
          Promise.resolve([
            { content: Buffer.from("<!doctype html><title>New API</title>"), mimeType: "image/png" }
          ])
      },
      qualityQueue
    );

    await expect(processor.execute(task.id)).rejects.toMatchObject({
      code: "INVALID_GENERATED_IMAGE_CONTENT"
    });
    expect(store.succeeded).toEqual([]);
    expect(qualityQueue.enqueue).not.toHaveBeenCalled();
    expect([...storage.data.keys()].some((key) => key.startsWith("generated/"))).toBe(false);
  });

  it("stops an active unit when cancellation is observed and never persists a late result", async () => {
    const unitId = "00000000-0000-4000-8000-000000000041";
    const unitTask: WorkerExecutableTask = {
      ...structuredClone(task),
      status: "running",
      units: [
        {
          id: unitId,
          position: 0,
          status: "running",
          instruction: task.instruction,
          outputLayout: "separate_image",
          sourceAssets: task.sourceAssets,
          qualitySourceAssetIds: []
        }
      ]
    };
    const store = new FakeTaskStore(unitTask);
    store.cancelRequested = true;
    let finishProvider!: () => void;
    let providerSignal: AbortSignal | undefined;
    const processor = new ImageGenerationProcessor(environment, store, new MemoryStorage(), {
      generate: (input) => {
        providerSignal = input.signal;
        return new Promise((resolve) => {
          finishProvider = () => resolve([{ content: validPng, mimeType: "image/png" }]);
        });
      }
    });

    const execution = processor.executeUnit(task.id, unitId, 1);
    await expect(execution).rejects.toBeInstanceOf(ImageGenerationCancelledError);
    expect(providerSignal?.aborted).toBe(true);
    finishProvider();
    await vi.waitFor(() => expect(store.lateResults).toBe(1));
    expect(store.succeeded).toEqual([]);
  });

  it("resumes the previous provider task after a download-stage failure", async () => {
    const unitId = "00000000-0000-4000-8000-000000000041";
    const unitTask: WorkerExecutableTask = {
      ...structuredClone(task),
      status: "running",
      units: [
        {
          id: unitId,
          position: 0,
          status: "running",
          instruction: task.instruction,
          outputLayout: "separate_image",
          sourceAssets: [task.sourceAssets[0]!],
          qualitySourceAssetIds: []
        }
      ]
    };
    const store = new FakeTaskStore(unitTask);
    store.previousFailedAttempt = {
      providerRequestId: "relay-task-from-attempt-1",
      failureStage: "download",
      errorCode: "IMAGE_DOWNLOAD_FAILED"
    };
    const generate = vi.fn<ImageGenerationPort["generate"]>(() =>
      Promise.resolve([{ content: validPng, mimeType: "image/png" as const }])
    );
    const processor = new ImageGenerationProcessor(environment, store, new MemoryStorage(), {
      generate
    });

    await processor.executeUnit(task.id, unitId, 2);

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: `${task.id}:${unitId}:attempt:1`,
        resume: {
          providerRequestId: "relay-task-from-attempt-1",
          failedStage: "download"
        }
      })
    );
  });

  it("replays the first provider idempotency key after an ambiguous submission failure", async () => {
    const unitId = "00000000-0000-4000-8000-000000000041";
    const unitTask: WorkerExecutableTask = {
      ...structuredClone(task),
      status: "running",
      units: [
        {
          id: unitId,
          position: 0,
          status: "running",
          instruction: task.instruction,
          outputLayout: "separate_image",
          sourceAssets: [task.sourceAssets[0]!],
          qualitySourceAssetIds: []
        }
      ]
    };
    const store = new FakeTaskStore(unitTask);
    store.previousFailedAttempt = {
      failureStage: "submission",
      errorCode: "ASYNC_IMAGE_SUBMISSION_FAILED"
    };
    const generate = vi.fn<ImageGenerationPort["generate"]>(() =>
      Promise.resolve([{ content: validPng, mimeType: "image/png" as const }])
    );
    const processor = new ImageGenerationProcessor(environment, store, new MemoryStorage(), {
      generate
    });

    await processor.executeUnit(task.id, unitId, 2);

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: `${task.id}:${unitId}:attempt:1` })
    );
    expect(generate.mock.calls[0]?.[0].resume).toBeUndefined();
  });
});

describe("ImageGenerationJobHandler", () => {
  it("keeps a retryable task running before the final attempt", async () => {
    const recordFailure = vi.fn(() => Promise.resolve());
    const processor = {
      execute: vi.fn(() =>
        Promise.reject(new ImageProviderError("IMAGE_PROVIDER_REQUEST_FAILED", "temporary failure"))
      ),
      recordFailure
    } as unknown as ImageGenerationProcessor;
    const handler = new ImageGenerationJobHandler(processor);

    await expect(handler.handle(createJob(0, 3))).rejects.toThrow("temporary failure");
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("records a retryable error on the final attempt", async () => {
    const recordFailure = vi.fn(() => Promise.resolve());
    const processor = {
      execute: vi.fn(() =>
        Promise.reject(new ImageProviderError("IMAGE_PROVIDER_REQUEST_FAILED", "provider failed"))
      ),
      recordFailure
    } as unknown as ImageGenerationProcessor;
    const handler = new ImageGenerationJobHandler(processor);

    await expect(handler.handle(createJob(2, 3))).rejects.toThrow("provider failed");
    expect(recordFailure).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ code: "IMAGE_PROVIDER_REQUEST_FAILED", retryable: true })
    );
  });

  it("fails invalid task data without consuming all retries", async () => {
    const recordFailure = vi.fn(() => Promise.resolve());
    const processor = {
      execute: vi.fn(() =>
        Promise.reject(new WorkerTaskDataError("SOURCE_IMAGE_NOT_AVAILABLE", "source missing"))
      ),
      recordFailure
    } as unknown as ImageGenerationProcessor;
    const handler = new ImageGenerationJobHandler(processor);

    await expect(handler.handle(createJob(0, 3))).rejects.toThrow("source missing");
    expect(recordFailure).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ code: "SOURCE_IMAGE_NOT_AVAILABLE", retryable: false })
    );
  });

  it("fails an unconfigured provider immediately without consuming paid retries", async () => {
    const recordFailure = vi.fn(() => Promise.resolve());
    const processor = {
      execute: vi.fn(() =>
        Promise.reject(
          new ImageProviderError("IMAGE_PROVIDER_NOT_CONFIGURED", "provider is not configured")
        )
      ),
      recordFailure
    } as unknown as ImageGenerationProcessor;
    const handler = new ImageGenerationJobHandler(processor);

    await expect(handler.handle(createJob(0, 3))).rejects.toThrow("provider is not configured");
    expect(recordFailure).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ code: "IMAGE_PROVIDER_NOT_CONFIGURED", retryable: false })
    );
  });

  it("retries a provider result that failed image-content validation", async () => {
    const recordFailure = vi.fn(() => Promise.resolve());
    const processor = {
      execute: vi.fn(() =>
        Promise.reject(
          new ImageProviderError("INVALID_GENERATED_IMAGE_CONTENT", "provider returned text/html")
        )
      ),
      recordFailure
    } as unknown as ImageGenerationProcessor;
    const handler = new ImageGenerationJobHandler(processor);

    await expect(handler.handle(createJob(0, 3))).rejects.toThrow("provider returned text/html");
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("allows only one BullMQ regeneration for raw invalid content from other providers", async () => {
    const recordFailure = vi.fn(() => Promise.resolve());
    const processor = {
      execute: vi.fn(() =>
        Promise.reject(
          new ImageProviderError("IMAGE_BINARY_SIGNATURE_INVALID", "invalid provider bytes")
        )
      ),
      recordFailure
    } as unknown as ImageGenerationProcessor;
    const handler = new ImageGenerationJobHandler(processor);

    await expect(handler.handle(createJob(0, 3))).rejects.toThrow("invalid provider bytes");
    expect(recordFailure).not.toHaveBeenCalled();

    await expect(handler.handle(createJob(1, 3))).rejects.toThrow("invalid provider bytes");
    expect(recordFailure).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ code: "IMAGE_BINARY_SIGNATURE_INVALID", retryable: false })
    );
  });

  it("records only the failed unit after its second attempt", async () => {
    const unitId = "00000000-0000-4000-8000-000000000041";
    const recordUnitAttemptFailure = vi.fn(() => Promise.resolve());
    const recordUnitFailure = vi.fn(() => Promise.resolve());
    const processor = {
      executeUnit: vi.fn(() =>
        Promise.reject(new ImageProviderError("IMAGE_PROVIDER_REQUEST_FAILED", "unit failed"))
      ),
      recordUnitAttemptFailure,
      recordUnitFailure
    } as unknown as ImageGenerationProcessor;
    const handler = new ImageGenerationJobHandler(processor);

    await expect(handler.handle(createUnitJob(unitId, 0))).rejects.toThrow("unit failed");
    expect(recordUnitFailure).not.toHaveBeenCalled();

    await expect(handler.handle(createUnitJob(unitId, 1))).rejects.toThrow("unit failed");
    expect(recordUnitFailure).toHaveBeenCalledWith(
      unitId,
      expect.objectContaining({ code: "IMAGE_PROVIDER_REQUEST_FAILED" })
    );
    expect(recordUnitAttemptFailure).toHaveBeenCalledTimes(2);
  });

  it("does not retry a deterministic download runtime error", async () => {
    const unitId = "00000000-0000-4000-8000-000000000041";
    const recordUnitAttemptFailure = vi.fn(() => Promise.resolve());
    const recordUnitFailure = vi.fn(() => Promise.resolve());
    const processor = {
      executeUnit: vi.fn(() =>
        Promise.reject(
          new ImageProviderError("IMAGE_DOWNLOAD_FAILED", "invalid dispatcher contract", {
            stage: "download",
            retryable: false,
            cause: Object.assign(new Error("invalid onRequestStart method"), {
              code: "UND_ERR_INVALID_ARG"
            })
          })
        )
      ),
      recordUnitAttemptFailure,
      recordUnitFailure
    } as unknown as ImageGenerationProcessor;
    const handler = new ImageGenerationJobHandler(processor);

    await expect(handler.handle(createUnitJob(unitId, 0))).rejects.toThrow(
      "invalid dispatcher contract"
    );
    expect(recordUnitAttemptFailure).toHaveBeenCalledOnce();
    expect(recordUnitFailure).toHaveBeenCalledOnce();
  });
});

function createJob(attemptsMade: number, attempts: number): Job<ImageGenerationJobData> {
  return {
    name: IMAGE_GENERATION_JOB_NAME,
    data: { schemaVersion: "1.0", taskId: task.id },
    attemptsMade,
    opts: { attempts }
  } as Job<ImageGenerationJobData>;
}

function createUnitJob(
  unitId: string,
  attemptsMade: number
): Job<ImageGenerationJobData | ImageGenerationUnitJobData> {
  return {
    name: IMAGE_GENERATION_UNIT_JOB_NAME,
    data: { schemaVersion: "2.0", taskId: task.id, unitId },
    attemptsMade,
    opts: { attempts: 2 }
  } as Job<ImageGenerationJobData | ImageGenerationUnitJobData>;
}
