import { Injectable } from "@nestjs/common";
import { z } from "zod";

import type { Environment } from "@chaoren/contracts";

import {
  getPromptOptimizationConfiguration,
  type MultimodalAiConfiguration
} from "../requirements/conversation-requirement.configuration.js";
import type {
  PromptOptimizationAiInput,
  PromptOptimizationAiPort,
  PromptOptimizationImage,
  PromptOptimizationRepairInput
} from "./prompt-optimization-ai.port.js";
import {
  buildPromptOptimizationImageDecisionSystemPrompt,
  buildPromptOptimizationTextSystemPrompt,
  PROMPT_OPTIMIZATION_CONTRACT_VERSION
} from "./prompt-optimization.prompt.js";

const chatCompletionResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1)
});

@Injectable()
export class OpenAiCompatiblePromptOptimizationAiAdapter implements PromptOptimizationAiPort {
  private readonly configuration: MultimodalAiConfiguration;

  public constructor(environment: Environment) {
    this.configuration = getPromptOptimizationConfiguration(environment);
  }

  public getModelName(): string {
    return this.configuration.model;
  }

  public decideImages(input: PromptOptimizationAiInput): Promise<unknown> {
    return this.complete({
      systemPrompt: buildPromptOptimizationImageDecisionSystemPrompt(),
      userText: `请判断以下当前输入是否依赖图片：${JSON.stringify(toImageDecisionModelInput(input))}`,
      images: input.images
    });
  }

  public optimize(input: PromptOptimizationAiInput): Promise<unknown> {
    return this.complete({
      systemPrompt: buildPromptOptimizationTextSystemPrompt(),
      userText: `请优化以下输入：${JSON.stringify(toModelInput(input))}`,
      images: input.images
    });
  }

  public repair(input: PromptOptimizationRepairInput): Promise<unknown> {
    return this.complete({
      systemPrompt: buildPromptOptimizationTextSystemPrompt(),
      userText: `上一次优化稿未通过程序校验。只能修正 JSON 结构、明确数量或比例的保真问题，不得改变用户原意。\n原始输入：${JSON.stringify(toModelInput(input))}\n上一次输出：${JSON.stringify(input.previousOutput)}\n校验问题：${JSON.stringify(input.validationIssues)}\ncontractVersion 必须为 ${PROMPT_OPTIMIZATION_CONTRACT_VERSION}。`,
      images: input.images
    });
  }

  private async complete(input: {
    systemPrompt: string;
    userText: string;
    images: PromptOptimizationImage[];
  }): Promise<unknown> {
    if (!this.configuration.apiKey) throw new PromptOptimizationAiConfigurationError();
    const baseUrl = this.configuration.baseUrl.endsWith("/")
      ? this.configuration.baseUrl
      : `${this.configuration.baseUrl}/`;
    const response = await fetch(new URL("chat/completions", baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.configuration.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.configuration.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.systemPrompt },
          {
            role: "user",
            content:
              input.images.length === 0
                ? input.userText
                : [
                    { type: "text", text: input.userText },
                    ...input.images.flatMap((image) => [
                      {
                        type: "text",
                        text: `图片 ${image.key}；角色=${image.role}；来源=${image.source}；关系=${image.relation ?? "未说明"}`
                      },
                      {
                        type: "image_url",
                        image_url: {
                          url: `data:${image.mimeType};base64,${image.content.toString("base64")}`,
                          detail: "high"
                        }
                      }
                    ])
                  ]
          }
        ]
      }),
      signal: AbortSignal.timeout(this.configuration.timeoutMs)
    });
    if (!response.ok) throw new PromptOptimizationAiRequestError(response.status);
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new PromptOptimizationAiResponseError();
    }
    const completion = chatCompletionResponseSchema.safeParse(responseBody);
    if (!completion.success) throw new PromptOptimizationAiResponseError();
    const content = completion.data.choices[0]?.message.content;
    if (!content) throw new PromptOptimizationAiResponseError();
    try {
      return JSON.parse(content) as unknown;
    } catch {
      return content;
    }
  }
}

function toImageDecisionModelInput(input: PromptOptimizationAiInput) {
  return {
    text: input.text,
    images: input.images.map(({ key, role, source, relation }) => ({
      key,
      role,
      source,
      relation
    }))
  };
}

function toModelInput(input: PromptOptimizationAiInput) {
  return {
    operation: input.operation,
    text: input.text,
    revisionInstruction: input.revisionInstruction,
    imageSettings: input.imageSettings,
    limitedContext: input.limitedContext,
    generationModel: input.generationModel,
    images: input.images.map(({ key, role, source, relation }) => ({
      key,
      role,
      source,
      relation
    }))
  };
}

export class PromptOptimizationAiConfigurationError extends Error {}
export class PromptOptimizationAiRequestError extends Error {
  public constructor(public readonly statusCode: number) {
    super("提示词优化模型请求失败");
  }
}
export class PromptOptimizationAiResponseError extends Error {}
