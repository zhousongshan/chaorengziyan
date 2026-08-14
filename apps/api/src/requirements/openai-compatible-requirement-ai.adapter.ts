import { Injectable } from "@nestjs/common";
import { z } from "zod";

import type { Environment } from "@chaoren/contracts";

import type { ConversationRequirementContext } from "../conversations/conversation-context.js";

import type {
  ConversationRequirementImage,
  RepairConversationRequirementInput,
  RequirementAiCallOptions,
  RequirementAiPort,
  RequirementExecutionConstraints
} from "./requirement-ai.port.js";
import { getConversationRequirementConfiguration } from "./conversation-requirement.configuration.js";
import { RequirementAiConfigurationError, RequirementAiError } from "./requirement-ai.errors.js";
import { buildRequirementSystemPrompt } from "./requirement.prompt.js";

const chatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() })
      })
    )
    .min(1)
});

@Injectable()
export class OpenAiCompatibleRequirementAiAdapter implements RequirementAiPort {
  public constructor(private readonly environment: Environment) {}

  public resolveConversation(
    input: ConversationRequirementContext,
    constraints: RequirementExecutionConstraints,
    images: ConversationRequirementImage[],
    options?: RequirementAiCallOptions
  ): Promise<unknown> {
    return this.completeConversation(
      `你正在处理同一个电商生图会话。currentTurn 是本轮输入；sessionState 是当前唯一有效事实；recentTurns 是最近完整轮次，只是历史证据；olderMemoryIndex 是较早轮次的结构化索引；retrievedLongTermMemory 是同会话较早轮次的原始证据。\n
必须遵守：
1. 信息优先级固定为：currentTurn 中用户的明确修改 > sessionState 当前有效事实 > 全部 product_source 共同提供的可见商品事实 > recentTurns > retrievedLongTermMemory > 助手历史回复。
2. 最近轮次和召回记忆只用于理解连续指代，不得把已 superseded 或 rejected 的旧方向恢复为当前要求，除非用户本轮明确恢复。
3. 用户本轮未明确修改的已有字段必须保持 sessionState.currentRequirement 中的值；但本轮显式提交 product_source 且不是编辑历史结果时，表示重新确定当前商品事实，必须完整重述当前商品需求，不得继承其他商品的主体、场景、构图、禁改项或主体修改权限。
4. 一般后续轮次只在 requirements 中输出本轮明确修改或页面设置明确提供的字段；本轮重新确定商品事实时，requirements 必须输出一份不依赖旧商品需求的完整当前需求。
5. 商品主体默认保持；只有用户本轮明确要求主体变化时，才能在 requirements 中输出 subjectPolicy。
6. 只允许四种 action：respond_only、ask_user、update_requirement、generate。
7. 普通聊天、打招呼、产品功能咨询使用 respond_only。普通模式支持新图片生成、修改已有生成结果、整理或修改生图需求、必要的创作澄清；其他能力使用 respond_only 且 responseType=unsupported_capability，在 assistantReply 中说明暂不支持并建议联系产品人员。不得用关键词表判断，必须结合本轮完整语义。
8. 用户明确要求生成、再来一张、重新生成或修改已有结果时使用 generate。用户明确只记录或暂不生成时使用 update_requirement。创作意图存在但确有阻塞歧义时使用 ask_user，并把问题同时写入自然语言 assistantReply 和 questions。
9. 修改已有生成结果时，从随请求提供的 generated_result、selected_result 或 edit_base 图片中选择唯一目标，并在 generate 中返回它的 targetImageKey。不得输出 assetId。若图片指代不唯一，返回 action=ask_user；新建图片时 targetImageKey 为 null 或省略。
10. 不得假设多张 product_source 一定是同一商品。必须结合用户完整表达判断图片间的语义关系：可以是同一商品多角度、多个商品合成一张、每张分别处理、或组成拼图。只有结果形式确实无法确定时才 ask_user。edit_base 是继续修改的画面。user_reference 不是商品事实，必须按参考图产品规则分析并迁移设计语言。
11. assetMemories 只按 assetId 对应图片。只有 product_source 的 productFacts 可作为商品事实，其他图片的 productFacts 必须忽略。本轮每张图片都有唯一 image key，可在 imageObservations 中按 key 返回实际可见观察。
12. requirements 是开放需求对象。已知字段使用 imageCount、aspectRatio、intent、scene、background、composition、lighting、style、mustKeep、mustAvoid、subjectPolicy、additionalRequirements。新的创意维度可使用清晰的新字段，程序会无损收入扩展区。
13. 不得在 requirements 中输出或改变 userId、projectId、sessionId、messageId、modelId、assetId、assetIds、productImageIds、referenceImageIds、requirementRunId 或 stateSnapshotId。
14. generate 必须输出 generationPlan，schemaVersion 固定为 3.0。groups 表示若干输出组；sourceImages 只能引用本轮提供的 image key；usage 只能是 edit_target、subject_fact、composition_member、style_reference、layout_cell；outputLayout 只能是 separate_image、single_canvas、collage_canvas。每个 group.instruction 都是必填的本组完整执行需求，必须自包含本次商品、场景、构图、风格、保留项和禁改项，不能依赖或带入未被本组采用的历史商品需求。每组必须输出独立 subjectPolicy，且只允许包含用户本轮明确授权的商品变化。subjectEntities 只表示需要保持商品身份并进行主体一致性检查的商品，不包含人物、道具、背景等创作对象。新商品只能使用 lineageKind=new_product_source，并从 role=product_source 的图片中填写 sourceImageKeys；同一商品多角度放在同一实体，不同商品分别建实体。继续编辑历史成品时，只能使用 lineageKind=inherited_product_entity，从该图片随附的 productEntities 中选择 productEntityId，并用 sourceImageKey 指明所属历史图；不得为历史图新建实体、重分配原图或猜测血缘。历史图没有 productEntities 时，它不能提供可继承商品事实，需要商品一致性时应 ask_user 要求重新提供或选择商品原图。
15. 输出数量必须按以下优先级判断：currentTurn.text 中明确的输出语义 > currentTurn.imageSettings.imageCount > sessionState.currentRequirement.imageCount > 1。明确语义既包括“生成4张”，也包括“每张原图各生成1张”等能确定最终独立文件数的表达。必须识别任意明确数量；明确数量超过系统上限或模型上限时使用 ask_user 说明当前上限，不得忽略、截断或改用页面控件。文字和控件冲突时文字优先，不要询问用户。模糊表达如“多来几张”不能覆盖控件。requirements.imageCount 与 generationPlan 所有 outputCount 的总和必须一致。
16. 用户要求“每张分别优化、输出四张独立图”时，建立四个组，每组只引用对应原图且 outputCount=1。用户要求多商品合在一张时，建立一个组引用全部必要图片且 outputCount=1。用户要求同一方案多个候选时，使用一个组并设置相应 outputCount。
17. generate 必须输出 quantityDecision，source 只能是 explicit_user_text、ui_control、previous_requirement、system_default。若 source=explicit_user_text，必须同时输出 evidenceQuote、evidenceStart、evidenceEnd，且 quote 必须逐字来自 currentTurn.text，[start,end) 必须是该 quote 在原文中的精确字符区间，证据本身必须能确定最终独立文件数。其他来源用 rule 说明采用的优先级。
18. 每个 group 必须输出 referenceAnalyses 数组，并采用当前提供的 user_reference；没有参考图时必须为空。参考图只能使用 style_reference 或 layout_cell，商品图不能使用这两种用途。本轮提供的商品图必须至少进入一个输出组，不得静默遗漏。每个 usage=style_reference 或 layout_cell 的图片必须恰好对应一份分析，imageKey 必须等于该参考图 key。observedDesign 必须包含 sellingPointPresentation、composition、informationHierarchy、typography、colorAndLighting、spacingAndRhythm、propsAndScene 七项实际可见分析。transferPlan 必须包含非空 adopt、adapt、avoid 和可为空的 userPriority。adopt 写可直接采用的抽象规则；adapt 写如何按当前商品改造；avoid 写默认不直接复制的参考商品、品牌、Logo、原文案和未经证实事实。用户在图片 relation 或 currentTurn.text 中明确指定的参考重点必须写入 userPriority。
19. 先完成 referenceDesignPlan，再写 group.instruction。采用参考图时必须严格使用以下结构：{"understanding":{"designIntent":"...","strengths":["..."],"weaknesses":["..."],"readingOrder":["..."]},"layoutBlueprint":{"canvas":"...","subjectPlacement":"...","whitespace":"...","zones":[{"zone":"...","purpose":"...","placement":"...","relativeSize":"...","hierarchy":"..."}]},"productAdaptation":{"subjectReplacement":"...","preserve":["..."],"adapt":["..."],"avoid":["..."]}}。它必须明确参考图设计目标、有效之处、问题、阅读顺序、版式分区、主体位置、留白和当前商品替换方式。没有采用参考图时 referenceDesignPlan 必须为 null。group.instruction 必须落实这个方案，不能用“参考风格”“主体居中”等宽泛或与实际参考布局冲突的句子替代。
20. copyPlan 必须始终存在且只在 group.copyPlan 输出，不得在 referenceDesignPlan 内重复。精确结构是 {"blocks":[{"role":"...","text":"...","source":"user_provided|confirmed_fact|ai_creative","placement":"...","hierarchy":"..."}],"forbiddenFacts":["..."]}。用户提供的文字必须原意保留并标记 user_provided；已确认事实标记 confirmed_fact；没有用户文案时可以生成非事实型标题、场景短句、情绪表达或装饰文字并标记 ai_creative。不得编造材质、规格、功效、认证、价格或承诺。

首轮尚无 sessionState.currentRequirement 时，requirements 应给出完整创作意图。后续轮次只输出本轮变化。

稳定JSON外壳只能是以下四种之一：
{"contractVersion":"4.0","action":"respond_only","responseType":"normal","assistantReply":"自然语言回复"}
{"contractVersion":"4.0","action":"respond_only","responseType":"unsupported_capability","assistantReply":"当前普通模式暂不支持该能力。你可以继续进行图片生成或修改；如有相关需求，请联系产品人员。"}
{"contractVersion":"4.0","action":"ask_user","assistantReply":"自然语言问题","questions":["结构化问题"]}
{"contractVersion":"4.0","action":"update_requirement","assistantReply":"需求已更新，暂不生成","requirements":{"background":"户外花园"}}
{"contractVersion":"4.0","action":"generate","assistantReply":"开始生成","targetImageKey":null,"requirements":{"background":"户外花园"},"quantityDecision":{"source":"ui_control","value":1,"rule":"当前文字无明确数量，采用页面数量控件"},"generationPlan":{"schemaVersion":"3.0","summary":"生成一张商品图","groups":[{"sourceImages":[{"imageKey":"image_1","usage":"subject_fact"}],"subjectEntities":[{"entityKey":"product_1","label":"商品","lineageKind":"new_product_source","sourceImageKeys":["image_1"]}],"subjectPolicy":{"defaultAction":"preserve","allowedChanges":[]},"referenceAnalyses":[],"referenceDesignPlan":null,"copyPlan":{"blocks":[],"forbiddenFacts":["不得编造材质、规格、功效、认证、价格或承诺"]},"outputCount":1,"outputLayout":"separate_image","instruction":"以image_1为唯一商品事实生成当前商品图，不改变商品可见特征"}]}}
generate 在复用当前需求时允许 requirements 为空对象。imageObservations 和 conflictDecisions 是可选辅助数据。

会话输入：${JSON.stringify(input)}`,
      constraints,
      images,
      options
    );
  }

  public repairConversation(
    input: RepairConversationRequirementInput,
    options?: RequirementAiCallOptions
  ): Promise<unknown> {
    return this.completeConversation(
      `你上一次的会话输出未通过技术结构校验。只能修正JSON外壳、必填字段和无法安全转换的值；不得改变用户原意、action、图片分组语义或增加本轮未授权的需求。\n原始会话输入：${JSON.stringify(input.originalInput)}\n上一次输出：${JSON.stringify(input.previousOutput)}\n归一化失败：${JSON.stringify(input.validationIssues)}\n合法action只有 respond_only、ask_user、update_requirement、generate。respond_only需要assistantReply；ask_user需要assistantReply和questions；update_requirement需要assistantReply和requirements；generate需要assistantReply、requirements、quantityDecision和generationPlan，requirements允许为空对象。quantityDecision 必须遵守文字明确数量 > 页面控件 > 当前需求 > 默认1；使用 explicit_user_text 时必须给出当前原文的精确 quote 和 [start,end) 区间。generationPlan.schemaVersion 必须为3.0，只能引用已提供的 image key，且所有组总输出不得超过 ${input.constraints.maxImageCount}。每组必须包含独立 subjectPolicy、referenceAnalyses、referenceDesignPlan 和 copyPlan；每张参考图必须恰好对应一份完整分析。采用参考图时 referenceDesignPlan 的精确结构是 {"understanding":{"designIntent":"...","strengths":["..."],"weaknesses":["..."],"readingOrder":["..."]},"layoutBlueprint":{"canvas":"...","subjectPlacement":"...","whitespace":"...","zones":[{"zone":"...","purpose":"...","placement":"...","relativeSize":"...","hierarchy":"..."}]},"productAdaptation":{"subjectReplacement":"...","preserve":["..."],"adapt":["..."],"avoid":["..."]}}；没有采用参考图时 referenceAnalyses=[] 且 referenceDesignPlan=null。copyPlan 只允许放在 group.copyPlan，精确结构是 {"blocks":[{"role":"...","text":"...","source":"user_provided|confirmed_fact|ai_creative","placement":"...","hierarchy":"..."}],"forbiddenFacts":["..."]}。修改已有结果时 targetImageKey 只能取随请求图片的现有 key；新建图片时省略或返回 null。requirements 是开放对象，可保留原有创意字段。`,
      input.constraints,
      input.images,
      options
    );
  }

  private completeConversation(
    userMessage: string,
    constraints: RequirementExecutionConstraints,
    images: ConversationRequirementImage[],
    options?: RequirementAiCallOptions
  ): Promise<unknown> {
    return this.complete(
      userMessage,
      constraints,
      images,
      getConversationRequirementConfiguration(this.environment),
      options
    );
  }

  private async complete(
    userMessage: string,
    constraints: RequirementExecutionConstraints,
    images: ConversationRequirementImage[] = [],
    override?: {
      baseUrl: string;
      apiKey: string | undefined;
      model: string;
      timeoutMs: number;
    },
    options?: RequirementAiCallOptions
  ): Promise<unknown> {
    const configuration = override ?? {
      baseUrl: this.environment.REQUIREMENT_AI_BASE_URL,
      apiKey: this.environment.REQUIREMENT_AI_API_KEY,
      model: this.environment.REQUIREMENT_AI_MODEL,
      timeoutMs: this.environment.REQUIREMENT_AI_TIMEOUT_MS
    };
    if (!configuration.apiKey) {
      throw new RequirementAiConfigurationError("多模态需求 AI API Key 未配置");
    }

    const baseUrl = configuration.baseUrl.endsWith("/")
      ? configuration.baseUrl
      : `${configuration.baseUrl}/`;
    const endpoint = new URL("chat/completions", baseUrl);
    const timeoutMs = Math.min(
      configuration.timeoutMs,
      options?.timeoutMs ?? configuration.timeoutMs
    );
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${configuration.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: configuration.model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: buildRequirementSystemPrompt({
                maxImageCount: constraints.maxImageCount,
                allowedAspectRatios: constraints.allowedAspectRatios
              })
            },
            {
              role: "user",
              content:
                images.length === 0
                  ? userMessage
                  : [
                      { type: "text", text: userMessage },
                      ...images.flatMap((image) => [
                        {
                          type: "text",
                          text: `图片 ${image.key}；角色=${image.role}；关系=${image.relation ?? "未说明"}；可继承商品实体=${JSON.stringify(image.productEntities)}`
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
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw mapFetchError(error, timeoutMs);
    }

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw mapHttpError(response, responseBody);
    }

    let responsePayload: unknown;
    try {
      responsePayload = await response.json();
    } catch (error) {
      throw new RequirementAiError(
        "REQUIREMENT_AI_INVALID_RESPONSE",
        "response",
        false,
        502,
        "需求理解服务返回了无法读取的结果",
        { responseStatus: response.status },
        error
      );
    }
    const parsedCompletion = chatCompletionResponseSchema.safeParse(responsePayload);
    if (!parsedCompletion.success) {
      throw new RequirementAiError(
        "REQUIREMENT_AI_INVALID_RESPONSE",
        "response",
        false,
        502,
        "需求理解服务返回了无效结果",
        {
          responseStatus: response.status,
          validationIssueCount: parsedCompletion.error.issues.length
        }
      );
    }
    const completion = parsedCompletion.data;
    const content = completion.choices[0]?.message.content;
    if (!content) {
      throw new RequirementAiError(
        "REQUIREMENT_AI_INVALID_RESPONSE",
        "response",
        false,
        502,
        "需求理解服务没有返回有效内容"
      );
    }

    try {
      return JSON.parse(content) as unknown;
    } catch {
      return content;
    }
  }
}

function mapFetchError(error: unknown, timeoutMs: number): RequirementAiError {
  if (isTimeoutError(error)) {
    return new RequirementAiError(
      "REQUIREMENT_AI_TIMEOUT",
      "request",
      false,
      504,
      "本次需求理解等待时间过长",
      { timeoutMs, errorName: error instanceof Error ? error.name : typeof error },
      error
    );
  }
  return new RequirementAiError(
    "REQUIREMENT_AI_SERVICE_UNAVAILABLE",
    "request",
    true,
    503,
    "需求理解服务暂时不可用",
    {
      errorName: error instanceof Error ? error.name : typeof error,
      networkCode: readErrorCode(error)
    },
    error
  );
}

function mapHttpError(response: Response, responseBody: string): RequirementAiError {
  const diagnostics = {
    responseStatus: response.status,
    upstreamRequestId:
      response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined
  };
  if (response.status === 429) {
    return new RequirementAiError(
      "REQUIREMENT_AI_RATE_LIMITED",
      "request",
      true,
      429,
      "当前需求理解请求较多，请稍后重试",
      diagnostics
    );
  }
  if (response.status === 401 || response.status === 403) {
    return new RequirementAiError(
      "REQUIREMENT_AI_AUTH_FAILED",
      "configuration",
      false,
      503,
      "需求理解服务鉴权失败，请联系管理员",
      diagnostics
    );
  }
  if (response.status >= 500) {
    return new RequirementAiError(
      "REQUIREMENT_AI_SERVICE_UNAVAILABLE",
      "request",
      true,
      503,
      "需求理解服务暂时不可用",
      diagnostics
    );
  }
  const capabilityRejected =
    response.status === 400 ||
    response.status === 404 ||
    response.status === 405 ||
    response.status === 415 ||
    response.status === 422 ||
    /multimodal|vision|image|response[_ -]?format|json[_ -]?object|not support|unsupported/i.test(
      responseBody
    );
  if (capabilityRejected) {
    return new RequirementAiError(
      "REQUIREMENT_AI_CAPABILITY_UNSUPPORTED",
      "configuration",
      false,
      503,
      "当前需求理解模型不支持所需的图片或结构化输出能力",
      diagnostics
    );
  }
  return new RequirementAiError(
    "REQUIREMENT_AI_SERVICE_UNAVAILABLE",
    "request",
    false,
    503,
    "需求理解服务拒绝了本次请求",
    diagnostics
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function readErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("cause" in error)) return undefined;
  const cause = error.cause;
  if (!cause || typeof cause !== "object" || !("code" in cause)) return undefined;
  const code = cause.code;
  return typeof code === "string" ? code : undefined;
}
