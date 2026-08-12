import { expect, test, type Page } from "@playwright/test";

const projectId = "00000000-0000-4000-8000-000000000098";
const customFolderId = "00000000-0000-4000-8000-000000000201";
const imageBody = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const assetFixtures = Array.from({ length: 21 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  projectId,
  kind: "image" as const,
  mimeType: "image/png",
  byteSize: 68,
  createdAt: `2026-08-${String(10 - (index % 3)).padStart(2, "0")}T02:00:00.000Z`,
  name: `确定性素材-${index + 1}.png`,
  source: index < 12 ? ("generated" as const) : ("uploaded" as const),
  favorite: index < 3,
  folderId: index < 2 ? customFolderId : null
}));

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号/账号").fill("MINISO");
  await page.getByPlaceholder("请输入密码").fill("development-password");
  await page.getByRole("button", { name: "立即登录" }).click();
  await expect(page).toHaveURL(/\/create$/);
}

async function mockAssetLibrary(page: Page, options: { failRename?: boolean } = {}) {
  let assets = structuredClone(assetFixtures);

  await page.route("**/api/v1/projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        projects: [
          {
            id: projectId,
            name: "资产库 E2E 项目",
            description: null,
            createdAt: "2026-08-10T02:00:00.000Z",
            updatedAt: "2026-08-10T02:00:00.000Z"
          }
        ]
      })
    });
  });
  await page.route("**/api/v1/asset-folders", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "default",
            name: "默认文件夹",
            system: true,
            assetCount: 1,
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z"
          },
          {
            id: customFolderId,
            name: "商品主图",
            system: false,
            assetCount: 2,
            createdAt: "2026-08-10T02:00:00.000Z",
            updatedAt: "2026-08-10T02:00:00.000Z"
          }
        ]
      })
    });
  });
  await page.route("**/api/v1/media-assets/calendar?*", async (route) => {
    const month = new URL(route.request().url()).searchParams.get("month") ?? "2026-08";
    const counts = new Map<string, number>();
    for (const asset of assets) {
      const date = asset.createdAt.slice(0, 10);
      if (date.startsWith(`${month}-`)) counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        month,
        days: [...counts].map(([date, count]) => ({ date, count })),
        minDate: "2026-08-08",
        maxDate: "2026-08-10"
      })
    });
  });
  await page.route("**/api/v1/media-assets?*", async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get("source") ?? "all";
    const scope = url.searchParams.get("scope") ?? "all";
    const folderId = url.searchParams.get("folderId");
    const keyword = (url.searchParams.get("keyword") ?? "").toLocaleLowerCase();
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    const pageNumber = Number(url.searchParams.get("page") ?? 1);
    const pageSize = Number(url.searchParams.get("pageSize") ?? 20);
    let items = assets.filter((asset) => {
      if (source !== "all" && asset.source !== source) return false;
      if (scope === "favorites" && !asset.favorite) return false;
      if (folderId === "default" && asset.folderId !== null) return false;
      if (folderId && folderId !== "default" && asset.folderId !== folderId) return false;
      const assetDate = asset.createdAt.slice(0, 10);
      if (dateFrom && assetDate < dateFrom) return false;
      if (dateTo && assetDate > dateTo) return false;
      return !keyword || asset.name.toLocaleLowerCase().includes(keyword);
    });
    const total = items.length;
    items = items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items,
        pagination: {
          page: pageNumber,
          pageSize,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / pageSize)
        }
      })
    });
  });
  await page.route("**/api/v1/media-assets/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/images") && request.method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "00000000-0000-4000-8000-000000000099",
          projectId,
          kind: "image",
          mimeType: "image/png",
          byteSize: 8,
          createdAt: "2026-08-10T02:00:00.000Z"
        })
      });
      return;
    }
    if (request.method() === "PATCH" && options.failRename) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ code: "ASSET_NAME_EXISTS", message: "素材名称已存在" })
      });
      return;
    }
    if (request.method() === "DELETE" && !pathname.endsWith("/favorite")) {
      const assetId = pathname.split("/").at(-1);
      assets = assets.filter((asset) => asset.id !== assetId);
    }
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/media-assets/*/content", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: imageBody });
  });
}

test("asset library supports preview, filtering, paging, and favorite folders", async ({
  page
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await mockAssetLibrary(page);
  await login(page);
  const creationShellMetrics = await readShellMetrics(page);
  await page.getByRole("link", { name: "资产库" }).click();

  await expect(page).toHaveURL(/\/assets$/);
  await expect(page.getByRole("heading", { name: "资产库" })).toBeVisible();
  await expect(page.getByText(/共 \d+ 个素材/)).toBeVisible();
  expect(await readShellMetrics(page)).toEqual(creationShellMetrics);

  const cards = page.locator("article");
  await expect(cards.first()).toBeVisible();
  await expect(cards).toHaveCount(20);
  await expect(page.getByRole("navigation", { name: "资产分页" })).toBeVisible();

  const firstCardImages = cards.first().locator("img");
  await expect(firstCardImages).toHaveCount(1);
  await waitForLoadedImages(firstCardImages);
  await expect
    .poll(() => firstCardImages.nth(0).evaluate((image) => getComputedStyle(image).objectFit))
    .toBe("contain");

  const firstCard = cards.first();
  const firstAssetName =
    (await firstCard.locator("strong").first().getAttribute("title")) ?? "图片预览";
  await firstCard
    .getByRole("button", { name: `放大预览 ${firstAssetName}` })
    .first()
    .click();
  await expect(page.getByRole("dialog", { name: firstAssetName })).toBeVisible();
  await page.getByRole("button", { name: "关闭图片预览" }).click();
  await expect(firstCard.getByRole("button", { name: "下载", exact: true })).toBeVisible();
  const assetDownloadPromise = page.waitForEvent("download");
  await firstCard.getByRole("button", { name: "下载", exact: true }).click();
  const assetDownload = await assetDownloadPromise;
  expect(assetDownload.suggestedFilename()).toBe(firstAssetName);

  await page.getByLabel("选择上传图片").setInputFiles([
    { name: "valid.png", mimeType: "image/png", buffer: Buffer.from("fake-png") },
    { name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("text") }
  ]);
  const uploadDialog = page.getByRole("dialog", { name: "上传素材" });
  await expect(uploadDialog).toContainText("上传完成：1 个成功，1 个失败。");
  await expect(uploadDialog).toContainText("仅支持 PNG、JPG 或 WEBP 图片");
  await uploadDialog.getByRole("button", { name: "完成" }).click();

  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByText("第 2 / 2 页")).toBeVisible();
  await expect(cards).toHaveCount(1);

  await page.getByLabel("素材来源").selectOption("generated");
  await expect(cards.first()).toContainText("AI 生成");
  const generatedTotal = await readAssetTotal(page);
  await expect(cards).toHaveCount(Math.min(20, generatedTotal));
  await expect(cards.locator("text=AI 生成")).toHaveCount(Math.min(20, generatedTotal));

  if (generatedTotal > 20) {
    await page.getByRole("button", { name: "下一页" }).click();
    await expect(page.getByText(/第 2 \/ \d+ 页/)).toBeVisible();
    await expect(cards).toHaveCount(Math.min(20, generatedTotal - 20));
  }

  await page.getByLabel("素材来源").selectOption("uploaded");
  await expect(cards.first()).toContainText("本地上传");
  const uploadedTotal = await readAssetTotal(page);
  await expect(cards).toHaveCount(Math.min(20, uploadedTotal));
  if (uploadedTotal > 20) {
    await expect(page.getByText(/第 1 \/ \d+ 页/)).toBeVisible();
  }
  await waitForLoadedImages(cards.locator("img"));

  await page.getByRole("button", { name: "按生成或上传日期筛选" }).click();
  await page.getByRole("button", { name: "最近 7 天" }).click();
  const rangeRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith("/media-assets") && url.searchParams.has("dateFrom");
  });
  await page.getByRole("button", { name: "应用" }).click();
  const rangeUrl = new URL((await rangeRequest).url());
  const selectedFrom = rangeUrl.searchParams.get("dateFrom");
  const selectedTo = rangeUrl.searchParams.get("dateTo");
  expect(selectedFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(selectedTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Date.parse(`${selectedTo}T00:00:00Z`) - Date.parse(`${selectedFrom}T00:00:00Z`)).toBe(
    6 * 24 * 60 * 60 * 1000
  );
  await page.getByRole("button", { name: "清除日期筛选" }).click();

  await page.getByRole("tab", { name: "我的收藏" }).click();
  await expect(page.getByRole("button", { name: "新建文件夹" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传素材" })).toHaveCount(0);
  await expect(page.getByLabel("素材类型")).toBeDisabled();
  await expect(page.getByLabel("素材来源")).toBeDisabled();
  await expect(page.getByLabel("按生成或上传日期筛选")).toBeDisabled();
  await expect(page.getByText(/共 \d+ 个文件夹/)).toBeVisible();
  await expect(page.getByText("已选 0 / 4")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "用于生图" })).toHaveCount(0);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("asset-library.png") });
  expect(consoleErrors).toEqual([]);
});

test("asset library recovers an invalid page and keeps mutation errors visible", async ({
  page
}) => {
  await mockAssetLibrary(page, { failRename: true });
  await login(page);
  await page.goto("/assets");

  const cards = page.locator("article");
  await expect(cards).toHaveCount(20);
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(cards).toHaveCount(1);

  await cards
    .first()
    .getByRole("button", { name: /更多操作/ })
    .click();
  await page.getByRole("menuitem", { name: "删除素材" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "删除素材" });
  await deleteDialog.getByRole("button", { name: "确认删除" }).click();

  await expect(page.getByText("共 20 个素材")).toBeVisible();
  await expect(page.getByText("第 1 / 1 页")).toBeVisible();
  await expect(cards).toHaveCount(20);

  await cards.first().getByRole("button", { name: "重命名" }).click();
  const renameDialog = page.getByRole("dialog", { name: "重命名素材" });
  await renameDialog.getByLabel("名称").fill("重复名称.png");
  await renameDialog.getByRole("button", { name: "确认" }).click();
  await expect(renameDialog.getByRole("alert")).toHaveText("素材名称已存在");
  await expect(renameDialog).toBeVisible();
});

async function readAssetTotal(page: Page) {
  const summary = await page.getByText(/共 \d+ 个素材/).innerText();
  const total = Number(summary.match(/\d+/)?.[0]);
  expect(Number.isInteger(total)).toBe(true);
  return total;
}

async function waitForLoadedImages(images: ReturnType<Page["locator"]>) {
  const firstImage = images.first();
  await expect(firstImage).toBeVisible();
  await firstImage.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      firstImage.evaluate(
        (image) =>
          (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0
      )
    )
    .toBe(true);
}

async function readShellMetrics(page: Page) {
  return page.evaluate(() => {
    const readStyles = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
        throw new Error(`Missing shell element: ${selector}`);
      }
      const styles = getComputedStyle(element);
      return {
        width: styles.width,
        height: styles.height,
        minHeight: styles.minHeight,
        padding: styles.padding,
        gap: styles.gap,
        fontSize: styles.fontSize,
        fontWeight: styles.fontWeight,
        borderRadius: styles.borderRadius,
        display: styles.display,
        visibility: styles.visibility
      };
    };

    return {
      sidebar: readStyles(".app-sidebar"),
      brandImage: readStyles(".sidebar-brand img"),
      brandName: readStyles(".sidebar-brand strong"),
      navigationLink: readStyles(".sidebar-link"),
      navigationIcon: readStyles(".sidebar-link svg"),
      availabilityLabel: readStyles(".sidebar-link small"),
      topbar: readStyles(".app-topbar"),
      userAvatar: readStyles(".user-menu > button > span")
    };
  });
}
