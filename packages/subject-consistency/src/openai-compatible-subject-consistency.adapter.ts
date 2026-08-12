import { z } from "zod";

import type { Environment } from "@chaoren/contracts";

import {
  SubjectConsistencyConfigurationError,
  SubjectConsistencyProviderError
} from "./subject-consistency.errors.js";
import type {
  SubjectConsistencyPort,
  SubjectInspectionOutputRepairInput,
  SubjectInspectionInput,
  SubjectRequirementReconcilerPort,
  SubjectRequirementReconciliationInput
} from "./subject-consistency.port.js";
import {
  buildSubjectInspectionSystemPrompt,
  buildSubjectInspectionOutputRepairPrompt,
  buildSubjectReconciliationSystemPrompt
} from "./subject-consistency.prompt.js";

const chatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() })
      })
    )
    .min(1)
});

export class OpenAiCompatibleSubjectConsistencyAdapter implements SubjectConsistencyPort {
  public constructor(private readonly environment: Environment) {}

  public inspect(input: SubjectInspectionInput): Promise<unknown> {
    if (!this.environment.SUBJECT_INSPECTION_AI_API_KEY) {
      throw new SubjectConsistencyConfigurationError("SUBJECT_INSPECTION_AI_API_KEY 未配置");
    }

    const requirementText = JSON.stringify({
      originalUserText: input.originalUserText,
      finalRequirement: input.requirement,
      round: input.round
    });
    const subjectEntities =
      input.subjectEntities && input.subjectEntities.length > 0
        ? input.subjectEntities
        : [
            {
              entityKey: "legacy_product",
              label: "历史商品主体",
              sourceProductIndexes: input.sourceProducts.map((_, index) => index)
            }
          ];
    return completeJson({
      baseUrl: this.environment.SUBJECT_INSPECTION_AI_BASE_URL,
      apiKey: this.environment.SUBJECT_INSPECTION_AI_API_KEY,
      model: this.environment.SUBJECT_INSPECTION_AI_MODEL,
      timeoutMs: this.environment.SUBJECT_INSPECTION_AI_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
      systemPrompt: buildSubjectInspectionSystemPrompt(),
      userContent: [
        {
          type: "text",
          text: `[A] SOURCE_ENTITIES：${JSON.stringify(subjectEntities)}。索引从0开始，对应后续 SOURCE_PRODUCTS。`
        },
        ...input.sourceProducts.flatMap((sourceProduct, index) => [
          { type: "text", text: `[A${index + 1}] 商品原图 ${index + 1}` },
          { type: "image_url", image_url: { url: toDataUrl(sourceProduct) } }
        ]),
        { type: "text", text: "[B] GENERATED_CANDIDATE：需要检查的生成结果。" },
        { type: "image_url", image_url: { url: toDataUrl(input.generatedCandidate) } },
        { type: "text", text: `[C] CONFIRMED_REQUIREMENT：${requirementText}` }
      ]
    });
  }

  public repairOutput(input: SubjectInspectionOutputRepairInput): Promise<unknown> {
    return completeJson({
      baseUrl: this.environment.SUBJECT_INSPECTION_AI_BASE_URL,
      apiKey: this.environment.SUBJECT_INSPECTION_AI_API_KEY ?? "",
      model: this.environment.SUBJECT_INSPECTION_AI_MODEL,
      timeoutMs: this.environment.SUBJECT_INSPECTION_AI_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
      systemPrompt: buildSubjectInspectionOutputRepairPrompt(),
      userContent: JSON.stringify(input)
    });
  }
}

export class OpenAiCompatibleSubjectRequirementReconciler implements SubjectRequirementReconcilerPort {
  public constructor(private readonly environment: Environment) {}

  public reconcile(input: SubjectRequirementReconciliationInput): Promise<unknown> {
    if (!this.environment.REQUIREMENT_AI_API_KEY) {
      throw new SubjectConsistencyConfigurationError("REQUIREMENT_AI_API_KEY 未配置");
    }

    return completeJson({
      baseUrl: this.environment.REQUIREMENT_AI_BASE_URL,
      apiKey: this.environment.REQUIREMENT_AI_API_KEY,
      model: this.environment.REQUIREMENT_AI_MODEL,
      timeoutMs: this.environment.REQUIREMENT_AI_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
      systemPrompt: buildSubjectReconciliationSystemPrompt(),
      userContent: `请根据用户原意重整主体策略。\n${JSON.stringify(input)}`
    });
  }
}

interface CompletionOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  systemPrompt: string;
  userContent: string | Array<Record<string, unknown>>;
  signal?: AbortSignal;
}

async function completeJson(options: CompletionOptions): Promise<unknown> {
  const baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
  const endpoint = new URL("chat/completions", baseUrl);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: options.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: options.userContent }
        ]
      }),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)])
        : AbortSignal.timeout(options.timeoutMs)
    });
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    throw new SubjectConsistencyProviderError(
      "SUBJECT_AI_REQUEST_FAILED",
      error instanceof Error ? error.message : "主体质检AI请求失败",
      true
    );
  }

  if (!response.ok) {
    const message = (await response.text()).slice(0, 1_000);
    throw new SubjectConsistencyProviderError(
      "SUBJECT_AI_REQUEST_FAILED",
      `AI请求失败 (${response.status}): ${message}`,
      response.status === 408 || response.status === 429 || response.status >= 500
    );
  }

  let completion;
  try {
    completion = chatCompletionResponseSchema.parse(await response.json());
  } catch (error) {
    throw new SubjectConsistencyProviderError(
      "INVALID_SUBJECT_AI_RESPONSE",
      error instanceof Error ? error.message : "AI响应格式无效",
      true
    );
  }
  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new SubjectConsistencyProviderError("EMPTY_SUBJECT_AI_RESPONSE", "AI返回了空内容", true);
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new SubjectConsistencyProviderError(
      "INVALID_SUBJECT_AI_JSON",
      "AI没有返回合法JSON",
      true
    );
  }
}

function toDataUrl(image: { mimeType: string; content: Buffer }): string {
  return `data:${image.mimeType};base64,${image.content.toString("base64")}`;
}
