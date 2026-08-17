import { expect, test, type Page, type Route } from "@playwright/test";

import { emptyConversationState } from "@chaoren/contracts";

const agentId = "00000000-0000-4000-8000-000000000100";
const projectId = "00000000-0000-4000-8000-000000000098";
const sessionId = "00000000-0000-4000-8000-000000000201";
const userMessageId = "00000000-0000-4000-8000-000000000301";
const assistantMessageId = "00000000-0000-4000-8000-000000000302";
const historicalRequirementRunId = "00000000-0000-4000-8000-000000000501";
const legacyRequirementRunId = "00000000-0000-4000-8000-000000000502";
const failedRequirementRunId = "00000000-0000-4000-8000-000000000503";
const historicalTaskId = "00000000-0000-4000-8000-000000000601";
const legacyTaskId = "00000000-0000-4000-8000-000000000602";
const failedTaskId = "00000000-0000-4000-8000-000000000603";
const historicalUnitId = "00000000-0000-4000-8000-000000000701";
const failedUnitId = "00000000-0000-4000-8000-000000000702";
const historicalAssetId = "00000000-0000-4000-8000-000000000801";
const legacyAssetId = "00000000-0000-4000-8000-000000000802";

test("an Agent resumes its one persistent conversation and keeps history inside the chat", async ({
  page
}) => {
  await mockConversationApi(page);
  await login(page);

  await page.goto(`/create/image?agentId=${agentId}`);

  await expect(page).toHaveURL(new RegExp(`sessionId=${sessionId}`));
  await expect(page.getByText("这是需要保留的历史消息")).toBeVisible();
  await expect(page.getByText("历史消息已经恢复")).toBeVisible();
  await expect(page.getByRole("button", { name: "新建会话" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /会话记录/ })).toHaveCount(0);
});

test("loads twenty recent turns first and preserves the viewport when older turns are prepended", async ({
  page
}) => {
  const paging = await mockPaginatedConversationApi(page);
  await login(page);

  await page.goto(`/create/image?agentId=${agentId}&sessionId=${sessionId}`);

  await expect(page.getByText("第 6 轮用户消息")).toHaveCount(1);
  await expect(page.getByText("第 25 轮用户消息")).toHaveCount(1);
  await expect(page.getByText("第 1 轮用户消息")).toHaveCount(0);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => paging.olderPageRequests).toBe(1);

  const anchor = page.getByText("第 6 轮用户消息");
  const beforeTop = await anchor.evaluate((element) => element.getBoundingClientRect().top);
  await expect(page.getByText("第 1 轮用户消息")).toHaveCount(1);
  const afterTop = await anchor.evaluate((element) => element.getBoundingClientRect().top);

  expect(Math.abs(afterTop - beforeTop)).toBeLessThanOrEqual(4);
  await expect(page.getByText("已加载全部记录")).toHaveCount(1);
});

test("restores actions for mapped historical results and keeps legacy results read-only", async ({
  page
}) => {
  await mockHistoricalResultApi(page);
  await login(page);

  await page.goto(`/create/image?agentId=${agentId}&sessionId=${sessionId}`);

  await expect(page.getByRole("button", { name: "重新编辑" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "再次生成" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "收藏历史现代结果" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "重命名历史现代结果" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "放大查看历史生成结果" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "查看原图" })).toHaveCount(0);
  await expect(page.locator("time.conversation-message-time")).toHaveCount(7);
  await expect(page.locator("time.conversation-message-time").first()).toHaveAttribute(
    "datetime",
    "2026-08-10T08:00:00.000Z"
  );
  await expect(page.locator(".conversation-output-favorite-button")).toHaveCount(1);
  await expect(
    page.locator(".conversation-output-slot .conversation-output-actions button")
  ).toHaveText(["重命名", "重新编辑", "再次生成", "下载"]);

  const assistantCopy = page.getByText("现代结果", { exact: true });
  const resultMedia = page.locator(".conversation-output-media").first();
  await expect(assistantCopy).toBeVisible();
  await expect(resultMedia).toBeVisible();
  await expect(page.locator(".conversation-output-media")).toHaveCount(1);
  await expect(page.getByText("这次没有生成出可用图片")).toBeVisible();
  await expect(page.getByText(/结果 1-1：本次生成等待时间过长/)).toBeVisible();
  const latestAssistantCopy = page.getByText("我来处理这次生成", { exact: true });
  const latestAssistantTime = page
    .locator(".conversation-round")
    .nth(2)
    .locator(".conversation-ai-row")
    .locator("time.conversation-message-time")
    .first();
  expect(
    await latestAssistantTime.evaluate((element) => element.getBoundingClientRect().top)
  ).toBeGreaterThan(
    await latestAssistantCopy.evaluate((element) => element.getBoundingClientRect().bottom)
  );
  expect(
    await assistantCopy.evaluate(
      (element, media) =>
        Boolean(element.compareDocumentPosition(media) & Node.DOCUMENT_POSITION_FOLLOWING),
      await resultMedia.elementHandle()
    )
  ).toBe(true);

  await page.getByRole("button", { name: "放大查看历史现代结果" }).click();
  const previewDialog = page.getByRole("dialog", { name: "历史现代结果" });
  await expect(previewDialog).toBeVisible();
  await expect(page.getByRole("link", { name: "查看原图" })).toHaveCount(0);
  const previewViewport = previewDialog.locator(".image-preview-viewport");
  await previewViewport.hover();
  await page.mouse.wheel(0, -600);
  await expect(previewDialog.locator(".image-preview-scale")).toBeVisible();
  await expect
    .poll(() => previewDialog.locator(".image-preview-scale").textContent())
    .not.toBe("100%");
  const transformBeforeDrag = await previewDialog
    .locator(".image-preview-canvas")
    .evaluate((element) => getComputedStyle(element).transform);
  const previewBounds = await previewViewport.boundingBox();
  if (!previewBounds) throw new Error("图片预览区域不可见");
  await page.mouse.move(
    previewBounds.x + previewBounds.width / 2,
    previewBounds.y + previewBounds.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    previewBounds.x + previewBounds.width / 2 + 30,
    previewBounds.y + previewBounds.height / 2 + 20
  );
  await page.mouse.up();
  await expect
    .poll(() =>
      previewDialog
        .locator(".image-preview-canvas")
        .evaluate((element) => getComputedStyle(element).transform)
    )
    .not.toBe(transformBeforeDrag);
  await previewViewport.dblclick();
  await expect(previewDialog.locator(".image-preview-scale")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("历史现代结果.png");

  await page.getByRole("button", { name: "重命名历史现代结果" }).click();
  await expect(page.getByRole("dialog", { name: "重命名生成结果" })).toBeVisible();
});

test("async-state unlocks after REST reports idle despite stale running history and lost SSE", async ({
  page
}) => {
  const state = await mockStaleRunningGenerationApi(page);
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  await login(page);

  await page.goto(
    `/create/image?agentId=${agentId}&sessionId=${sessionId}&taskId=${historicalTaskId}`
  );

  const prompt = page.getByPlaceholder("不会写指令，像找设计师一样描述需求即可…");
  await expect(page.locator(".conversation-output-media")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成中" })).toBeVisible();
  await expect(prompt).toBeDisabled();

  await expect(page.getByRole("button", { name: "发送" })).toBeVisible({ timeout: 10_000 });
  await expect(prompt).toBeEnabled();
  await expect.poll(() => state.activeRequests).toBeGreaterThanOrEqual(2);
  await expect.poll(() => state.eventRequests).toBeGreaterThanOrEqual(1);
  await expect.poll(() => state.historyRequests).toBeGreaterThanOrEqual(2);

  await prompt.fill("继续生成下一张图片");
  await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  await page.reload();
  await expect(page.locator(".conversation-output-media")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  await expect(prompt).toBeEnabled();
  await expect(page.getByRole("button", { name: "生成中" })).toHaveCount(0);
  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号/账号").fill("MINISO");
  await page.getByPlaceholder("请输入密码").fill("development-password");
  await page.getByRole("button", { name: "立即登录" }).click();
  await expect(page).toHaveURL(/\/create$/);
}

async function mockConversationApi(page: Page) {
  const session = {
    id: sessionId,
    projectId,
    agentId,
    title: "保留的家居会话",
    mode: "image",
    status: "active",
    version: 1,
    processingMessageId: null,
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: "2026-08-10T09:00:00.000Z"
  };

  await page.route("**/api/v1/conversations**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/conversations/current")) {
      await fulfillJson(route, { session });
      return;
    }
    if (url.pathname.endsWith(`/conversations/${sessionId}`)) {
      await fulfillJson(route, {
        session,
        messages: [
          {
            id: userMessageId,
            sessionId,
            turnNumber: 1,
            role: "user",
            content: "这是需要保留的历史消息",
            status: "completed",
            assets: [],
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-08-10T08:01:00.000Z"
          },
          {
            id: assistantMessageId,
            sessionId,
            turnNumber: 1,
            role: "assistant",
            content: "历史消息已经恢复",
            status: "completed",
            assets: [],
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-08-10T08:02:00.000Z"
          }
        ],
        latestSnapshot: {
          id: "00000000-0000-4000-8000-000000000401",
          sessionId,
          throughTurn: 1,
          version: 1,
          state: emptyConversationState,
          createdAt: "2026-08-10T08:02:00.000Z"
        },
        requirementRuns: [],
        latestRequirementRun: null,
        messagePage: {
          limit: 20,
          oldestTurn: 1,
          newestTurn: 1,
          hasMore: false,
          nextBeforeTurn: null
        }
      });
      return;
    }
    await route.continue();
  });
}

async function mockPaginatedConversationApi(page: Page) {
  const state = { olderPageRequests: 0 };
  const session = {
    id: sessionId,
    projectId,
    agentId,
    title: "分页会话",
    mode: "image",
    status: "active",
    version: 25,
    processingMessageId: null,
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: "2026-08-10T09:00:00.000Z"
  };

  await page.route("**/api/v1/conversations**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/conversations/${sessionId}/messages`)) {
      state.olderPageRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
      await fulfillJson(route, {
        messages: conversationMessages(1, 5),
        requirementRuns: [],
        messagePage: {
          limit: 20,
          oldestTurn: 1,
          newestTurn: 5,
          hasMore: false,
          nextBeforeTurn: null
        }
      });
      return;
    }
    if (url.pathname.endsWith(`/conversations/${sessionId}`)) {
      await fulfillJson(route, {
        session,
        messages: conversationMessages(6, 25),
        latestSnapshot: {
          id: "00000000-0000-4000-8000-000000000401",
          sessionId,
          throughTurn: 25,
          version: 25,
          state: emptyConversationState,
          createdAt: "2026-08-10T09:00:00.000Z"
        },
        requirementRuns: [],
        latestRequirementRun: null,
        messagePage: {
          limit: 20,
          oldestTurn: 6,
          newestTurn: 25,
          hasMore: true,
          nextBeforeTurn: 6
        }
      });
      return;
    }
    await route.continue();
  });
  return state;
}

async function mockHistoricalResultApi(page: Page) {
  const session = {
    id: sessionId,
    projectId,
    agentId,
    title: "历史生成结果",
    mode: "image",
    status: "active",
    version: 3,
    processingMessageId: null,
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: "2026-08-10T09:00:00.000Z"
  };
  const requirementResult = {
    schemaVersion: "1.0",
    status: "ready",
    conflictDecisions: [],
    finalRequirement: {
      imageCount: 1,
      aspectRatio: "1:1",
      intent: "生成历史测试图",
      scene: null,
      background: null,
      composition: null,
      lighting: null,
      style: null,
      mustKeep: [],
      mustAvoid: [],
      subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
    }
  };
  const requirementRuns = [
    {
      sourceMessageId: userMessageId,
      requirementRunId: historicalRequirementRunId,
      result: requirementResult
    },
    {
      sourceMessageId: "00000000-0000-4000-8000-000000000303",
      requirementRunId: legacyRequirementRunId,
      result: requirementResult
    },
    {
      sourceMessageId: "00000000-0000-4000-8000-000000000305",
      requirementRunId: failedRequirementRunId,
      result: requirementResult
    }
  ];
  const mediaAsset = (id: string) => ({
    id,
    projectId,
    kind: "image",
    mimeType: "image/png",
    byteSize: 68,
    createdAt: "2026-08-10T08:02:00.000Z"
  });
  const task = (input: {
    taskId: string;
    requirementRunId: string;
    assetId?: string;
    status?: "succeeded" | "failed";
    outputs?: unknown[];
  }) => {
    const status = input.status ?? "succeeded";
    return {
      taskId: input.taskId,
      requirementRunId: input.requirementRunId,
      projectId,
      modelId: "test-model",
      executionConcurrency: 1,
      stageStartedAt: "2026-08-10T08:01:00.000Z",
      subjectConsistencyRequired: false,
      status,
      workflowStatus: status,
      resultAssets: input.assetId ? [mediaAsset(input.assetId)] : [],
      ...(input.outputs ? { outputs: input.outputs } : {}),
      requestedOutputCount: 1,
      succeededOutputCount: status === "succeeded" ? 1 : 0,
      unitFailures: [],
      regeneratedFrom: null,
      error: status === "failed" ? { code: "IMAGE_PROVIDER_TIMEOUT", message: "timeout" } : null,
      createdAt: "2026-08-10T08:01:00.000Z",
      updatedAt: "2026-08-10T08:06:00.000Z"
    };
  };

  await page.route("**/api/v1/conversations**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/conversations/current")) {
      await fulfillJson(route, { session });
      return;
    }
    if (url.pathname.endsWith(`/conversations/${sessionId}`)) {
      await fulfillJson(route, {
        session,
        messages: [
          {
            id: userMessageId,
            sessionId,
            turnNumber: 1,
            role: "user",
            content: "生成现代历史结果",
            status: "completed",
            assets: [],
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-08-10T08:00:00.000Z"
          },
          {
            id: assistantMessageId,
            sessionId,
            turnNumber: 1,
            role: "assistant",
            content: "现代结果",
            status: "completed",
            assets: [
              {
                assetId: historicalAssetId,
                role: "generated_result",
                position: 0,
                relation: `generation-task:${historicalTaskId}`
              }
            ],
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-08-10T08:02:00.000Z"
          },
          {
            id: "00000000-0000-4000-8000-000000000303",
            sessionId,
            turnNumber: 2,
            role: "user",
            content: "生成旧历史结果",
            status: "completed",
            assets: [],
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-08-10T08:03:00.000Z"
          },
          {
            id: "00000000-0000-4000-8000-000000000304",
            sessionId,
            turnNumber: 2,
            role: "assistant",
            content: "旧结果",
            status: "completed",
            assets: [
              {
                assetId: legacyAssetId,
                role: "generated_result",
                position: 0,
                relation: `generation-task:${legacyTaskId}`
              }
            ],
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-08-10T08:04:00.000Z"
          },
          {
            id: "00000000-0000-4000-8000-000000000305",
            sessionId,
            turnNumber: 3,
            role: "user",
            content: "生成一个会失败的结果",
            status: "completed",
            assets: [],
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-08-10T08:05:00.000Z"
          },
          {
            id: "00000000-0000-4000-8000-000000000306",
            sessionId,
            turnNumber: 3,
            role: "assistant",
            content: "我来处理这次生成",
            status: "completed",
            assets: [],
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-08-10T08:06:00.000Z"
          }
        ],
        latestSnapshot: {
          id: "00000000-0000-4000-8000-000000000401",
          sessionId,
          throughTurn: 3,
          version: 3,
          state: emptyConversationState,
          createdAt: "2026-08-10T08:04:00.000Z"
        },
        requirementRuns,
        latestRequirementRun: requirementRuns[2],
        messagePage: {
          limit: 20,
          oldestTurn: 1,
          newestTurn: 3,
          hasMore: false,
          nextBeforeTurn: null
        }
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/v1/image-generations**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/image-generations/active")) {
      await fulfillJson(route, { task: null });
      return;
    }
    await fulfillJson(route, {
      tasks: [
        task({
          taskId: historicalTaskId,
          requirementRunId: historicalRequirementRunId,
          assetId: historicalAssetId,
          outputs: [
            {
              unitId: historicalUnitId,
              position: 0,
              groupPosition: 0,
              variantPosition: 0,
              generationStatus: "succeeded",
              attemptCount: 1,
              stageStartedAt: "2026-08-10T08:01:00.000Z",
              completedAt: "2026-08-10T08:02:00.000Z",
              subjectConsistencyRequired: false,
              subjectConsistencyStatus: null,
              subjectConsistencyPhase: null,
              generatedAsset: mediaAsset(historicalAssetId),
              deliverableAsset: mediaAsset(historicalAssetId),
              displayName: "历史现代结果",
              favorite: false,
              error: null
            }
          ]
        }),
        task({
          taskId: legacyTaskId,
          requirementRunId: legacyRequirementRunId,
          assetId: legacyAssetId
        }),
        task({
          taskId: failedTaskId,
          requirementRunId: failedRequirementRunId,
          status: "failed",
          outputs: [
            {
              unitId: failedUnitId,
              position: 0,
              groupPosition: 0,
              variantPosition: 0,
              generationStatus: "failed",
              attemptCount: 2,
              stageStartedAt: "2026-08-10T08:05:00.000Z",
              completedAt: "2026-08-10T08:06:00.000Z",
              subjectConsistencyRequired: false,
              subjectConsistencyStatus: null,
              subjectConsistencyPhase: null,
              generatedAsset: null,
              deliverableAsset: null,
              displayName: null,
              favorite: false,
              error: { code: "IMAGE_PROVIDER_TIMEOUT", message: "internal timeout" }
            }
          ]
        })
      ]
    });
  });

  await page.route("**/api/media-assets/*/content", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
  });
}

async function mockStaleRunningGenerationApi(page: Page) {
  const state = { activeRequests: 0, eventRequests: 0, historyRequests: 0 };
  const session = {
    id: sessionId,
    projectId,
    agentId,
    title: "异步状态恢复",
    mode: "image",
    status: "active",
    version: 1,
    processingMessageId: null,
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: "2026-08-10T08:02:00.000Z"
  };
  const asset = {
    id: historicalAssetId,
    projectId,
    kind: "image",
    mimeType: "image/png",
    byteSize: 68,
    createdAt: "2026-08-10T08:02:00.000Z"
  };
  const staleTask = {
    taskId: historicalTaskId,
    requirementRunId: historicalRequirementRunId,
    projectId,
    modelId: "test-model",
    executionConcurrency: 1,
    stageStartedAt: "2026-08-10T08:01:00.000Z",
    subjectConsistencyRequired: false,
    status: "running",
    workflowStatus: "running",
    resultAssets: [asset],
    outputs: [
      {
        unitId: historicalUnitId,
        position: 0,
        groupPosition: 0,
        variantPosition: 0,
        generationStatus: "succeeded",
        attemptCount: 1,
        stageStartedAt: "2026-08-10T08:01:00.000Z",
        completedAt: "2026-08-10T08:02:00.000Z",
        subjectConsistencyRequired: false,
        subjectConsistencyStatus: null,
        subjectConsistencyPhase: null,
        generatedAsset: asset,
        deliverableAsset: asset,
        displayName: "已完成生成结果",
        favorite: false,
        error: null
      }
    ],
    requestedOutputCount: 1,
    succeededOutputCount: 1,
    unitFailures: [],
    regeneratedFrom: null,
    error: null,
    createdAt: "2026-08-10T08:01:00.000Z",
    updatedAt: "2026-08-10T08:02:00.000Z"
  };
  const activeTask = { ...staleTask, status: "succeeded", workflowStatus: "succeeded" };
  const requirementRun = {
    sourceMessageId: userMessageId,
    requirementRunId: historicalRequirementRunId,
    result: {
      schemaVersion: "1.0",
      status: "ready",
      conflictDecisions: [],
      finalRequirement: {
        imageCount: 1,
        aspectRatio: "1:1",
        intent: "生成测试图片",
        scene: null,
        background: null,
        composition: null,
        lighting: null,
        style: null,
        mustKeep: [],
        mustAvoid: [],
        subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
      }
    }
  };

  await page.route("**/api/v1/health/ready", (route) =>
    fulfillJson(route, {
      status: "ready",
      service: "chaoren-api",
      timestamp: "2026-08-10T08:00:00.000Z",
      nodeVersion: "24.19.0",
      checks: { database: true, databaseSchema: true, redis: true, imageWorker: true }
    })
  );
  await page.route("**/api/v1/projects/current", (route) =>
    fulfillJson(route, {
      id: projectId,
      name: "异步状态测试项目",
      description: null,
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-10T08:00:00.000Z"
    })
  );
  await page.route(`**/api/v1/agents/${agentId}`, (route) =>
    fulfillJson(route, {
      id: agentId,
      name: "家居推广图 Agent",
      description: "异步状态测试 Agent",
      agentInstruction: "",
      type: "image",
      mode: "intelligent",
      origin: "custom",
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-10T08:00:00.000Z"
    })
  );
  await page.route("**/api/v1/agents?*", (route) =>
    fulfillJson(route, {
      items: [
        {
          id: agentId,
          name: "家居推广图 Agent",
          description: "异步状态测试 Agent",
          agentInstruction: "",
          type: "image",
          mode: "intelligent",
          origin: "custom",
          createdAt: "2026-08-10T08:00:00.000Z",
          updatedAt: "2026-08-10T08:00:00.000Z"
        }
      ],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 }
    })
  );
  await page.route("**/api/v1/image-models", (route) =>
    fulfillJson(route, {
      models: [
        {
          id: "test-model",
          name: "测试生图模型",
          provider: "openai",
          enabled: true,
          maxImageCount: 4,
          supportedAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"]
        }
      ]
    })
  );

  await page.route("**/api/v1/conversations**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/conversations/current")) {
      await fulfillJson(route, { session });
      return;
    }
    if (url.pathname.endsWith(`/conversations/${sessionId}`)) {
      await fulfillJson(route, {
        session,
        messages: [
          {
            id: userMessageId,
            sessionId,
            turnNumber: 1,
            role: "user",
            content: "生成测试图片",
            status: "completed",
            assets: [],
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-08-10T08:00:00.000Z"
          },
          {
            id: assistantMessageId,
            sessionId,
            turnNumber: 1,
            role: "assistant",
            content: "图片已经生成完成",
            status: "completed",
            assets: [
              {
                assetId: historicalAssetId,
                role: "generated_result",
                position: 0,
                relation: `generation-task:${historicalTaskId}`
              }
            ],
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-08-10T08:02:00.000Z"
          }
        ],
        latestSnapshot: {
          id: "00000000-0000-4000-8000-000000000401",
          sessionId,
          throughTurn: 1,
          version: 1,
          state: emptyConversationState,
          createdAt: "2026-08-10T08:02:00.000Z"
        },
        requirementRuns: [requirementRun],
        latestRequirementRun: requirementRun,
        messagePage: {
          limit: 20,
          oldestTurn: 1,
          newestTurn: 1,
          hasMore: false,
          nextBeforeTurn: null
        }
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/v1/image-generations**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/image-generations/${historicalTaskId}/events`)) {
      state.eventRequests += 1;
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      return;
    }
    if (url.pathname.endsWith("/image-generations/active")) {
      state.activeRequests += 1;
      await fulfillJson(route, { task: state.activeRequests === 1 ? activeTask : null });
      return;
    }
    if (url.pathname.endsWith(`/image-generations/${historicalTaskId}`)) {
      await fulfillJson(route, staleTask);
      return;
    }
    state.historyRequests += 1;
    await fulfillJson(route, { tasks: [staleTask] });
  });

  await page.route("**/api/media-assets/*/content", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
  });
  return state;
}

function conversationMessages(firstTurn: number, lastTurn: number) {
  return Array.from({ length: lastTurn - firstTurn + 1 }, (_, index) => {
    const turnNumber = firstTurn + index;
    return {
      id: `00000000-0000-4000-8000-${turnNumber.toString().padStart(12, "0")}`,
      sessionId,
      turnNumber,
      role: "user",
      content: `第 ${turnNumber} 轮用户消息`,
      status: "completed",
      assets: [],
      errorCode: null,
      errorMessage: null,
      createdAt: `2026-08-10T08:${turnNumber.toString().padStart(2, "0")}:00.000Z`
    };
  });
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
