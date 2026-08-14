import { afterEach, describe, expect, it, vi } from "vitest";
import { Response as UndiciResponse } from "undici";

import { environmentSchema, type FinalRequirement } from "@chaoren/contracts";

import { ByteDanceImageAdapter } from "../src/bytedance-image.adapter.js";
import { buildImageGenerationInstruction } from "../src/image-generation-instruction.js";
import type { ImageProviderError } from "../src/image-generation.port.js";
import { OpenAiImageAdapter } from "../src/openai-image.adapter.js";
import { SafeRemoteImageFetcher } from "../src/safe-remote-image-fetcher.js";

const requirement: FinalRequirement = {
  imageCount: 1,
  aspectRatio: "1:1",
  intent: "生成白底电商主图",
  scene: null,
  background: "纯白背景",
  composition: null,
  lighting: null,
  style: null,
  mustKeep: ["保持商品外观"],
  mustAvoid: [],
  subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
};

const baseEnvironment = {
  NODE_ENV: "test" as const,
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
  REDIS_URL: "redis://127.0.0.1:6379"
};
const instruction = buildImageGenerationInstruction(requirement, { product: 1, reference: 1 });
const renderSettings = { resolutionPreset: "2k", providerQuality: "high" } as const;
const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

afterEach(() => vi.unstubAllGlobals());

describe("image provider adapters", () => {
  it("classifies relay access denial and preserves bounded diagnostics", async () => {
    const environment = environmentSchema.parse({
      ...baseEnvironment,
      OPENAI_IMAGE_BASE_URL: "https://jennyapi.site/v1",
      OPENAI_IMAGE_API_KEY: "test-relay-key",
      OPENAI_IMAGE_MODEL: "gpt-image-2",
      OPENAI_IMAGE_API_MODE: "async-relay"
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new UndiciResponse(JSON.stringify({ message: "model permission denied" }), {
          status: 403,
          headers: { "content-type": "application/json" }
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenAiImageAdapter(environment);
    await expect(
      adapter.generate({
        requestId: "access-denied-task",
        model: {
          id: "openai-image",
          name: "GPT 生图",
          provider: "openai",
          enabled: true,
          maxImageCount: 4,
          supportedAspectRatios: ["1:1"]
        },
        requirement,
        renderSettings,
        instruction,
        sources: []
      })
    ).rejects.toMatchObject({
      code: "IMAGE_PROVIDER_ACCESS_DENIED",
      details: {
        stage: "submission",
        retryable: false,
        diagnostics: {
          httpStatus: 403,
          responseBody: expect.stringContaining("permission denied")
        }
      }
    } satisfies Partial<ImageProviderError>);
  });

  it("sends ordered source images to the OpenAI image edits endpoint", async () => {
    const environment = environmentSchema.parse({
      ...baseEnvironment,
      OPENAI_IMAGE_API_KEY: "test-openai-key",
      OPENAI_IMAGE_MODEL: "gpt-image-2"
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new UndiciResponse(JSON.stringify({ data: [{ b64_json: validPng.toString("base64") }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAiImageAdapter(
      environment,
      new SafeRemoteImageFetcher(environment, {
        fetch: fetchMock,
        resolve: () => Promise.resolve([{ address: "8.8.8.8", family: 4 }])
      })
    ).generate({
      requestId: "task-openai",
      model: {
        id: "openai-image",
        name: "GPT 生图",
        provider: "openai",
        enabled: true,
        maxImageCount: 4,
        supportedAspectRatios: ["1:1"]
      },
      requirement,
      renderSettings,
      instruction,
      sources: [
        { assetId: "product", role: "product", mimeType: "image/png", content: Buffer.from("p") },
        {
          assetId: "reference",
          role: "reference",
          mimeType: "image/png",
          content: Buffer.from("r")
        }
      ]
    });

    expect(result[0]?.content).toEqual(validPng);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.getAll("image[]")).toHaveLength(2);
    const prompt = form.get("prompt");
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("输入图片1-1为同一商品的多角度或细节图");
    expect(prompt).toContain("输入图片2-2为设计语言参考图，不作为商品事实");
    expect(prompt).toContain("用户没有授权修改任何商品主体特征");
  });

  it("submits and polls the asynchronous relay with stable idempotency", async () => {
    const environment = environmentSchema.parse({
      ...baseEnvironment,
      OPENAI_IMAGE_BASE_URL: "https://jennyapi.site/v1",
      OPENAI_IMAGE_API_KEY: "test-relay-key",
      OPENAI_IMAGE_MODEL: "gpt-image-2",
      OPENAI_IMAGE_API_MODE: "async-relay"
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new UndiciResponse(
          JSON.stringify({ code: 0, data: { taskId: "relay-task", status: "queued" } }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new UndiciResponse(
          JSON.stringify({
            code: 0,
            data: {
              taskId: "relay-task",
              status: "succeeded",
              images: [
                {
                  contentUrl: "https://jennyapi.site/v1/files/file/content",
                  contentType: "image/png"
                }
              ]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new UndiciResponse(validPng, {
          status: 200,
          headers: { "content-type": "image/png" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAiImageAdapter(
      environment,
      new SafeRemoteImageFetcher(environment, {
        fetch: fetchMock,
        resolve: () => Promise.resolve([{ address: "8.8.8.8", family: 4 }])
      })
    ).generate({
      requestId: "generation-task",
      model: {
        id: "openai-image",
        name: "GPT 生图",
        provider: "openai",
        enabled: true,
        maxImageCount: 4,
        supportedAspectRatios: ["1:1"]
      },
      requirement,
      renderSettings,
      instruction,
      sources: [
        { assetId: "product", role: "product", mimeType: "image/png", content: Buffer.from("p") }
      ]
    });

    expect(result[0]?.content).toEqual(validPng);
    expect(result[0]?.providerRequestId).toBe("relay-task");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://jennyapi.site/v1/images/generations/async");
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(typeof firstCall[1].body).toBe("string");
    const submission = JSON.parse(
      typeof firstCall[1].body === "string" ? firstCall[1].body : "{}"
    ) as Record<string, unknown>;
    expect(submission.n).toBe(1);
    expect(submission.quality).toBe("high");
    expect(submission.size).toBe("2048x2048");
    expect(submission.clientTaskId).toBe("generation-task-image-1");
    expect(submission.idempotencyKey).toBe("generation-task-image-1");
    expect(submission.images).toEqual([
      { image_url: `data:image/png;base64,${Buffer.from("p").toString("base64")}` }
    ]);
  });

  it("does not make another paid submission when one relay result downloads as HTML", async () => {
    const environment = environmentSchema.parse({
      ...baseEnvironment,
      OPENAI_IMAGE_BASE_URL: "https://jennyapi.site/v1",
      OPENAI_IMAGE_API_KEY: "test-relay-key",
      OPENAI_IMAGE_MODEL: "gpt-image-2",
      OPENAI_IMAGE_API_MODE: "async-relay"
    });
    const successfulResult = (taskId: string) =>
      new UndiciResponse(
        JSON.stringify({
          code: 0,
          data: {
            taskId,
            status: "succeeded",
            images: [
              {
                contentUrl: `https://jennyapi.site/v1/files/${taskId}/content`,
                contentType: "image/png"
              }
            ]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const submission = (taskId: string) =>
      new UndiciResponse(JSON.stringify({ code: 0, data: { taskId, status: "queued" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const html = () =>
      new UndiciResponse("<!doctype html><title>New API</title>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(submission("relay-task-1"))
      .mockResolvedValueOnce(successfulResult("relay-task-1"))
      .mockResolvedValueOnce(html());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new OpenAiImageAdapter(
        environment,
        new SafeRemoteImageFetcher(environment, {
          fetch: fetchMock,
          resolve: () => Promise.resolve([{ address: "8.8.8.8", family: 4 }])
        })
      ).generate({
        requestId: "generation-task:unit-1:attempt:1",
        model: {
          id: "openai-image",
          name: "GPT 生图",
          provider: "openai",
          enabled: true,
          maxImageCount: 4,
          supportedAspectRatios: ["1:1"]
        },
        requirement,
        renderSettings,
        instruction,
        sources: []
      })
    ).rejects.toMatchObject({ code: "IMAGE_DOWNLOAD_RETURNED_NON_IMAGE" });

    const submissionCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/images/generations/async")
    );
    expect(submissionCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const body = (submissionCalls[0]?.[1] as RequestInit | undefined)?.body;
    if (typeof body !== "string") throw new Error("expected JSON request body");
    const parsedBody = JSON.parse(body) as { idempotencyKey?: unknown };
    expect(parsedBody.idempotencyKey).toBe("generation-task:unit-1:attempt:1-image-1");
  });

  it("resumes an existing relay task without making another paid submission", async () => {
    const environment = environmentSchema.parse({
      ...baseEnvironment,
      OPENAI_IMAGE_BASE_URL: "https://jennyapi.site/v1",
      OPENAI_IMAGE_API_KEY: "test-relay-key",
      OPENAI_IMAGE_MODEL: "gpt-image-2",
      OPENAI_IMAGE_API_MODE: "async-relay"
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new UndiciResponse(
          JSON.stringify({
            code: 0,
            data: {
              taskId: "existing-relay-task",
              status: "succeeded",
              images: [
                {
                  contentUrl: "https://jennyapi.site/v1/files/existing-relay-task/content",
                  contentType: "image/png"
                }
              ]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new UndiciResponse(validPng, { status: 200, headers: { "content-type": "image/png" } })
      );
    vi.stubGlobal("fetch", fetchMock);
    const onProviderRequestId = vi.fn(() => Promise.resolve());

    const result = await new OpenAiImageAdapter(
      environment,
      new SafeRemoteImageFetcher(environment, {
        fetch: fetchMock,
        resolve: () => Promise.resolve([{ address: "8.8.8.8", family: 4 }])
      })
    ).generate({
      requestId: "generation-task:unit-1:attempt:2",
      model: {
        id: "openai-image",
        name: "GPT 生图",
        provider: "openai",
        enabled: true,
        maxImageCount: 4,
        supportedAspectRatios: ["1:1"]
      },
      requirement,
      renderSettings,
      instruction,
      sources: [],
      resume: { providerRequestId: "existing-relay-task", failedStage: "download" },
      onProviderRequestId
    });

    expect(result[0]?.providerRequestId).toBe("existing-relay-task");
    expect(onProviderRequestId).toHaveBeenCalledWith("existing-relay-task");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/generations/async"))).toBe(
      false
    );
  });

  it("maps the selected ByteDance model without changing the requirement", async () => {
    const environment = environmentSchema.parse({
      ...baseEnvironment,
      BYTEDANCE_IMAGE_API_KEY: "test-byte-key",
      BYTEDANCE_IMAGE_MODEL: "ep-test-model"
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new UndiciResponse(JSON.stringify({ data: [{ b64_json: validPng.toString("base64") }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ByteDanceImageAdapter(environment).generate({
      requestId: "task-byte",
      model: {
        id: "bytedance-image",
        name: "字节生图",
        provider: "bytedance",
        enabled: true,
        maxImageCount: 4,
        supportedAspectRatios: ["1:1"]
      },
      requirement,
      renderSettings,
      instruction: buildImageGenerationInstruction(requirement, { product: 1, reference: 0 }),
      sources: [
        { assetId: "product", role: "product", mimeType: "image/png", content: Buffer.from("p") }
      ]
    });

    expect(result[0]?.content).toEqual(validPng);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    if (typeof init.body !== "string") throw new Error("expected JSON request body");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.model).toBe("ep-test-model");
    expect(body.prompt).toContain(requirement.intent);
    expect(body.image).toBe(`data:image/png;base64,${Buffer.from("p").toString("base64")}`);
  });
});
