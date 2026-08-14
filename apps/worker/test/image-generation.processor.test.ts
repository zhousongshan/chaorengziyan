import { Readable } from "node:stream";

import type { Job } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import {
  environmentSchema,
  IMAGE_GENERATION_UNIT_JOB_NAME,
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
  WorkerOutputAsset
} from "../src/image-generation-task.store.js";

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
  public readonly succeeded: WorkerOutputAsset[] = [];
  public readonly failed: Array<{ code: string; message: string }> = [];
  public consistency: { sourceProductAssetIds: string[] } | undefined;
  public cancelRequested = false;
  public lateResults = 0;
  public previousFailedAttempt:
    Awaited<ReturnType<ImageGenerationTaskStore["loadPreviousFailedUnitAttempt"]>> | undefined =
    undefined;

  public constructor(private readonly taskRecord: WorkerExecutableTask = task) {}

  public load(): Promise<WorkerExecutableTask> {
    return Promise.resolve(structuredClone(this.taskRecord));
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
    _taskId: string,
    _unitId: string,
    output: WorkerOutputAsset,
    consistency?: { sourceProductAssetIds: string[] }
  ): Promise<string[]> {
    this.succeeded.push(structuredClone(output));
    this.consistency = consistency;
    return Promise.resolve([]);
  }

  public markUnitFailed(_unitId: string, error: { code: string; message: string }): Promise<void> {
    this.failed.push(error);
    return Promise.resolve();
  }

  public markQueueDeliveryFailed(_unitId: string): Promise<void> {
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

function createUnitJob(unitId: string, attemptsMade: number): Job<ImageGenerationUnitJobData> {
  return {
    name: IMAGE_GENERATION_UNIT_JOB_NAME,
    data: { schemaVersion: "2.0", taskId: task.id, unitId },
    attemptsMade,
    opts: { attempts: 2 }
  } as Job<ImageGenerationUnitJobData>;
}
