import { randomUUID } from "node:crypto";
import { access, chmod, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  modelSettingsFormSchema,
  type ModelSettingsResponse
} from "@/features/model-settings/model-settings.schema";
import {
  DEVELOPMENT_SESSION_COOKIE,
  isDevelopmentAuthorizationEnabled
} from "@/lib/auth/development-session";
import {
  fixedModelConfiguration,
  parseEnvironmentFile,
  updateModelEnvironmentFile
} from "@/lib/model-settings/env-file";

export const runtime = "nodejs";

export async function GET() {
  const denied = await authorize();
  if (denied) return denied;

  const content = await readFile(await findWorkspaceEnvironmentFile(), "utf8");
  return NextResponse.json(toResponse(parseEnvironmentFile(content), false), {
    headers: { "Cache-Control": "no-store" }
  });
}

export async function PUT(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;

  const parsed = modelSettingsFormSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_MODEL_SETTINGS", message: "模型配置格式不正确" },
      { status: 400 }
    );
  }

  const envPath = await findWorkspaceEnvironmentFile();
  const current = await readFile(envPath, "utf8");
  const next = updateModelEnvironmentFile(current, {
    requirementBaseUrl: parsed.data.requirementBaseUrl,
    requirementApiKey: parsed.data.requirementApiKey || undefined,
    requirementModel: parsed.data.requirementModel,
    promptOptimizationBaseUrl: parsed.data.promptOptimizationBaseUrl,
    promptOptimizationApiKey: parsed.data.promptOptimizationApiKey || undefined,
    promptOptimizationModel: parsed.data.promptOptimizationModel,
    imageBaseUrl: parsed.data.imageBaseUrl,
    imageApiKey: parsed.data.imageApiKey || undefined,
    inspectionBaseUrl: parsed.data.inspectionBaseUrl,
    inspectionApiKey: parsed.data.inspectionApiKey || undefined
  });

  const temporaryPath = `${envPath}.tmp-${randomUUID()}`;
  try {
    const currentMode = (await stat(envPath)).mode;
    await writeFile(temporaryPath, next, { encoding: "utf8", mode: currentMode });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, envPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  return NextResponse.json(toResponse(parseEnvironmentFile(next), true), {
    headers: { "Cache-Control": "no-store" }
  });
}

async function authorize(request?: Request): Promise<NextResponse | null> {
  if (!isDevelopmentAuthorizationEnabled()) {
    return NextResponse.json(
      { code: "MODEL_SETTINGS_DISABLED", message: "模型配置页面仅在本地开发环境开放" },
      { status: 404 }
    );
  }
  const session = (await cookies()).get(DEVELOPMENT_SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "请先登录" }, { status: 401 });
  }
  if (request) {
    const origin = request.headers.get("origin");
    const requestHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const originHost = origin ? new URL(origin).host : null;
    if (originHost && requestHost && originHost !== requestHost) {
      return NextResponse.json(
        { code: "CROSS_ORIGIN_REQUEST_REJECTED", message: "不允许跨站修改模型配置" },
        { status: 403 }
      );
    }
  }
  return null;
}

function toResponse(
  values: Record<string, string>,
  restartRequired: boolean
): ModelSettingsResponse {
  const requirementBaseUrl = values.REQUIREMENT_AI_BASE_URL;
  const requirementApiKey = values.REQUIREMENT_AI_API_KEY;
  const requirementModel = values.REQUIREMENT_AI_MODEL;
  const promptOptimizationDedicated = Boolean(values.PROMPT_OPTIMIZATION_AI_API_KEY);
  const promptOptimizationBaseUrl = promptOptimizationDedicated
    ? values.PROMPT_OPTIMIZATION_AI_BASE_URL || requirementBaseUrl
    : requirementBaseUrl;
  const promptOptimizationModel = promptOptimizationDedicated
    ? values.PROMPT_OPTIMIZATION_AI_MODEL || requirementModel
    : requirementModel;
  return {
    schemaVersion: "1.0",
    models: {
      promptOptimization: {
        provider: promptOptimizationDedicated ? "OpenAI 兼容接口" : "继承需求理解节点",
        model: promptOptimizationModel || fixedModelConfiguration.REQUIREMENT_AI_MODEL,
        baseUrl: promptOptimizationBaseUrl || "https://jennyapi.site/v1",
        apiKeyConfigured: Boolean(
          promptOptimizationDedicated ? values.PROMPT_OPTIMIZATION_AI_API_KEY : requirementApiKey
        ),
        configurationMode: promptOptimizationDedicated ? "dedicated" : "inherited"
      },
      requirement: {
        provider: "Jenny API · OpenAI",
        model: requirementModel || fixedModelConfiguration.REQUIREMENT_AI_MODEL,
        baseUrl: requirementBaseUrl || "https://jennyapi.site/v1",
        apiKeyConfigured: Boolean(requirementApiKey)
      },
      image: {
        provider: "Jenny API · OpenAI",
        model: fixedModelConfiguration.OPENAI_IMAGE_MODEL,
        baseUrl: values.OPENAI_IMAGE_BASE_URL || "https://jennyapi.site/v1",
        apiKeyConfigured: Boolean(values.OPENAI_IMAGE_API_KEY)
      },
      inspection: {
        provider: "Jenny API · OpenAI",
        model: fixedModelConfiguration.SUBJECT_INSPECTION_AI_MODEL,
        baseUrl: values.SUBJECT_INSPECTION_AI_BASE_URL || "https://jennyapi.site/v1",
        apiKeyConfigured: Boolean(values.SUBJECT_INSPECTION_AI_API_KEY)
      }
    },
    restartRequired
  };
}

async function findWorkspaceEnvironmentFile(): Promise<string> {
  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const workspaceFile = path.join(directory, "pnpm-workspace.yaml");
    const envFile = path.join(directory, ".env");
    if ((await exists(workspaceFile)) && (await exists(envFile))) return envFile;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("找不到工作区根目录 .env 文件");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
