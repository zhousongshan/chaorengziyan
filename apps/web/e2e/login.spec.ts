import { expect, test } from "@playwright/test";

test("development login enters the intelligent creation library", async ({ page }, testInfo) => {
  await page.route("**/api/v1/health/ready", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        service: "chaoren-api",
        timestamp: new Date().toISOString(),
        nodeVersion: "24.19.0",
        checks: { database: true, redis: true, imageWorker: true }
      })
    })
  );
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const uniqueName = `E2E ${testInfo.project.name} ${Date.now().toString().slice(-6)}`;
  const renamedName = `${uniqueName} 已改名`;
  const instruction = "优先生成明亮、简洁的商品推广图。";

  await page.goto("/login");
  await expect(page.getByPlaceholder("请输入验证码")).toHaveCount(0);
  await page.getByPlaceholder("请输入手机号/账号").fill("MINISO");
  await page.getByPlaceholder("请输入密码").fill("development-password");
  await page.getByRole("button", { name: "立即登录" }).click();

  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole("heading", { name: "智能创作" })).toBeVisible();
  await expect(page.getByRole("link", { name: /家居推广图 Agent/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建 Agent" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "重命名 家居推广图 Agent" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "删除 家居推广图 Agent" })).toBeDisabled();

  await page.getByRole("searchbox", { name: "搜索 Agent" }).fill("不存在的 Agent");
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(
    page.getByText("没有找到符合当前条件的 Agent，请调整关键词或筛选条件。")
  ).toBeVisible();
  await page.getByRole("searchbox", { name: "搜索 Agent" }).fill("");
  await page.getByRole("button", { name: "搜索" }).click();

  await page.getByRole("button", { name: "新建 Agent" }).click();
  const createDialog = page.getByRole("dialog", { name: "新建 Agent" });
  await expect(createDialog.getByRole("button", { name: /视频 Agent/ })).toBeDisabled();
  await createDialog.getByRole("button", { name: "下一步" }).click();
  const detailsDialog = page.getByRole("dialog", { name: "填写 Agent 信息" });
  await detailsDialog.getByLabel(/Agent 名称/).fill("家居推广图 Agent");
  await detailsDialog.getByLabel(/简介/).fill("端到端测试 Agent");
  await detailsDialog.getByLabel(/Agent 设定/).fill(instruction);
  await detailsDialog.getByRole("button", { name: "创建 Agent" }).click();
  await expect(detailsDialog.getByRole("alert")).toHaveText("Agent 名称已存在，请使用其他名称");
  await detailsDialog.getByLabel(/Agent 名称/).fill(uniqueName);
  await detailsDialog.getByRole("button", { name: "创建 Agent" }).click();

  await expect(page).toHaveURL(/\/create\/image\?agentId=/);
  await expect(page.getByRole("heading", { name: `与 ${uniqueName} 开始创作` })).toBeVisible();
  await expect(page.getByLabel("Agent 设定")).toHaveValue(instruction);
  await page.getByRole("button", { name: "返回智能创作" }).click();
  await expect(page).toHaveURL(/\/create$/);

  const originalRow = page
    .locator("article")
    .filter({ has: page.getByText(uniqueName, { exact: true }) });
  await expect(originalRow).toBeVisible();
  await originalRow.getByRole("button", { name: `复制 ${uniqueName}` }).click();
  const copiedName = `${uniqueName} - 副本`;
  await expect(page.getByText(`已复制为「${copiedName}」，历史数据未继承。`)).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(copiedName) })).toBeVisible();

  await originalRow.getByRole("button", { name: `重命名 ${uniqueName}` }).click();
  const renameDialog = page.getByRole("dialog", { name: "重命名 Agent" });
  await renameDialog.getByLabel("Agent 名称").fill(renamedName);
  await renameDialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("link", { name: new RegExp(renamedName) })).toBeVisible();

  for (const name of [renamedName, copiedName]) {
    const row = page.locator("article").filter({ has: page.getByText(name, { exact: true }) });
    await row.getByRole("button", { name: `删除 ${name}` }).click();
    const deleteDialog = page.getByRole("dialog", { name: "删除 Agent" });
    await deleteDialog.getByRole("button", { name: "确认删除" }).click();
    await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
  }

  await expect(page.getByRole("link", { name: /家居推广图 Agent/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("intelligent-creation.png") });
  const expectedConflictErrors = consoleErrors.filter((message) =>
    message.includes("status of 409 (Conflict)")
  );
  expect(expectedConflictErrors).toHaveLength(1);
  expect(consoleErrors.filter((message) => !expectedConflictErrors.includes(message))).toEqual([]);
});
