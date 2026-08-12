import { Injectable } from "@nestjs/common";
import { z } from "zod";

import type { Environment } from "@chaoren/contracts";

import type { ConversationRequirementContext } from "../conversations/conversation-context.js";

import type {
  ConversationRequirementImage,
  RepairConversationRequirementInput,
  RequirementAiPort,
  RequirementExecutionConstraints
} from "./requirement-ai.port.js";
import { getConversationRequirementConfiguration } from "./conversation-requirement.configuration.js";
import { RequirementAiConfigurationError } from "./requirement-ai.errors.js";
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
    images: ConversationRequirementImage[]
  ): Promise<unknown> {
    return this.completeConversation(
      `你正在处理同一个电商生图会话。currentTurn 是本轮输入；sessionState 是当前唯一有效事实；recentTurns 是最近完整轮次，只是历史证据；olderMemoryIndex 是较早轮次的结构化索引；retrievedLongTermMemory 是同会话较早轮次的原始证据。\n
必须遵守：
1. 信息优先级固定为：currentTurn 中用户的明确修改 > sessionState 当前有效事实 > 全部 product_source 共同提供的可见商品事实 > recentTurns > retrievedLongTermMemory > 助手历史回复。
2. 最近轮次和召回记忆只用于理解连续指代，不得把已 superseded 或 rejected 的旧方向恢复为当前要求，除非用户本轮明确恢复。
3. 用户本轮未明确修改的已有字段必须保持 sessionState.currentRequirement 中的值。
4. 只在 requirements 中输出用户本轮明确修改，或本轮页面设置明确提供的字段。未修改字段不得出现在 requirements 中。
5. 商品主体默认保持；只有用户本轮明确要求主体变化时，才能在 requirements 中输出 subjectPolicy。
6. 只允许四种 action：respond_only、ask_user、update_requirement、generate。
7. 普通聊天、打招呼、产品功能咨询使用 respond_only。普通模式支持新图片生成、修改已有生成结果、整理或修改生图需求、必要的创作澄清；其他能力使用 respond_only 且 responseType=unsupported_capability，在 assistantReply 中说明暂不支持并建议联系产品人员。不得用关键词表判断，必须结合本轮完整语义。
8. 用户明确要求生成、再来一张、重新生成或修改已有结果时使用 generate。用户明确只记录或暂不生成时使用 update_requirement。创作意图存在但确有阻塞歧义时使用 ask_user，并把问题同时写入自然语言 assistantReply 和 questions。
9. 修改已有生成结果时，从随请求提供的 generated_result、selected_result 或 edit_base 图片中选择唯一目标，并在 generate 中返回它的 targetImageKey。不得输出 assetId。若图片指代不唯一，返回 action=ask_user；新建图片时 targetImageKey 为 null 或省略。
10. 不得假设多张 product_source 一定是同一商品。必须结合用户完整表达判断图片间的语义关系：可以是同一商品多角度、多个商品合成一张、每张分别处理、或组成拼图。只有结果形式确实无法确定时才 ask_user。edit_base 是继续修改的画面，user_reference 只参考场景、构图或风格。
11. assetMemories 只按 assetId 对应图片。只有 product_source 的 productFacts 可作为商品事实，其他图片的 productFacts 必须忽略。本轮每张图片都有唯一 image key，可在 imageObservations 中按 key 返回实际可见观察。
12. requirements 是开放需求对象。已知字段使用 imageCount、aspectRatio、intent、scene、background、composition、lighting、style、mustKeep、mustAvoid、subjectPolicy、additionalRequirements。新的创意维度可使用清晰的新字段，程序会无损收入扩展区。
13. 不得在 requirements 中输出或改变 userId、projectId、sessionId、messageId、modelId、assetId、assetIds、productImageIds、referenceImageIds、requirementRunId 或 stateSnapshotId。
14. generate 必须输出 generationPlan，schemaVersion 固定为 2.0。groups 表示若干输出组；sourceImages 只能引用本轮提供的 image key；usage 只能是 edit_target、subject_fact、composition_member、style_reference、layout_cell；outputLayout 只能是 separate_image、single_canvas、collage_canvas。subjectEntities 只表示需要保持商品身份并进行主体一致性检查的商品，不包含人物、道具、背景等创作对象。新商品只能使用 lineageKind=new_product_source，并从 role=product_source 的图片中填写 sourceImageKeys；同一商品多角度放在同一实体，不同商品分别建实体。继续编辑历史成品时，只能使用 lineageKind=inherited_product_entity，从该图片随附的 productEntities 中选择 productEntityId，并用 sourceImageKey 指明所属历史图；不得为历史图新建实体、重分配原图或猜测血缘。历史图没有 productEntities 时，它不能提供可继承商品事实，需要商品一致性时应 ask_user 要求重新提供或选择商品原图。
15. 输出数量必须按以下优先级判断：currentTurn.text 中明确的输出语义 > currentTurn.imageSettings.imageCount > sessionState.currentRequirement.imageCount > 1。明确语义既包括“生成4张”，也包括“每张原图各生成1张”等能确定最终独立文件数的表达。必须识别任意明确数量；明确数量超过系统上限或模型上限时使用 ask_user 说明当前上限，不得忽略、截断或改用页面控件。文字和控件冲突时文字优先，不要询问用户。模糊表达如“多来几张”不能覆盖控件。requirements.imageCount 与 generationPlan 所有 outputCount 的总和必须一致。
16. 用户要求“每张分别优化、输出四张独立图”时，建立四个组，每组只引用对应原图且 outputCount=1。用户要求多商品合在一张时，建立一个组引用全部必要图片且 outputCount=1。用户要求同一方案多个候选时，使用一个组并设置相应 outputCount。
17. generate 必须输出 quantityDecision，source 只能是 explicit_user_text、ui_control、previous_requirement、system_default。若 source=explicit_user_text，必须同时输出 evidenceQuote、evidenceStart、evidenceEnd，且 quote 必须逐字来自 currentTurn.text，[start,end) 必须是该 quote 在原文中的精确字符区间，证据本身必须能确定最终独立文件数。其他来源用 rule 说明采用的优先级。

首轮尚无 sessionState.currentRequirement 时，requirements 应给出完整创作意图。后续轮次只输出本轮变化。

稳定JSON外壳只能是以下四种之一：
{"contractVersion":"4.0","action":"respond_only","responseType":"normal","assistantReply":"自然语言回复"}
{"contractVersion":"4.0","action":"respond_only","responseType":"unsupported_capability","assistantReply":"当前普通模式暂不支持该能力。你可以继续进行图片生成或修改；如有相关需求，请联系产品人员。"}
{"contractVersion":"4.0","action":"ask_user","assistantReply":"自然语言问题","questions":["结构化问题"]}
{"contractVersion":"4.0","action":"update_requirement","assistantReply":"需求已更新，暂不生成","requirements":{"background":"户外花园"}}
{"contractVersion":"4.0","action":"generate","assistantReply":"开始生成","targetImageKey":null,"requirements":{"background":"户外花园"},"quantityDecision":{"source":"ui_control","value":1,"rule":"当前文字无明确数量，采用页面数量控件"},"generationPlan":{"schemaVersion":"2.0","summary":"每张原图独立优化","groups":[{"sourceImages":[{"imageKey":"image_1","usage":"edit_target"}],"subjectEntities":[{"entityKey":"product_1","label":"商品","lineageKind":"new_product_source","sourceImageKeys":["image_1"]}],"outputCount":1,"outputLayout":"separate_image","instruction":"只优化该图"}]}}
generate 在复用当前需求时允许 requirements 为空对象。imageObservations 和 conflictDecisions 是可选辅助数据。

会话输入：${JSON.stringify(input)}`,
      constraints,
      images
    );
  }

  public repairConversation(input: RepairConversationRequirementInput): Promise<unknown> {
    return this.completeConversation(
      `你上一次的会话输出未通过技术结构校验。只能修正JSON外壳、必填字段和无法安全转换的值；不得改变用户原意、action、图片分组语义或增加本轮未授权的需求。\n原始会话输入：${JSON.stringify(input.originalInput)}\n上一次输出：${JSON.stringify(input.previousOutput)}\n归一化失败：${JSON.stringify(input.validationIssues)}\n合法action只有 respond_only、ask_user、update_requirement、generate。respond_only需要assistantReply；ask_user需要assistantReply和questions；update_requirement需要assistantReply和requirements；generate需要assistantReply、requirements、quantityDecision和generationPlan，requirements允许为空对象。quantityDecision 必须遵守文字明确数量 > 页面控件 > 当前需求 > 默认1；使用 explicit_user_text 时必须给出当前原文的精确 quote 和 [start,end) 区间。generationPlan 只能引用已提供的 image key，且所有组总输出不得超过 ${input.constraints.maxImageCount}。修改已有结果时 targetImageKey 只能取随请求图片的现有 key；新建图片时省略或返回 null。requirements 是开放对象，可保留原有创意字段。`,
      input.constraints,
      input.images
    );
  }

  private completeConversation(
    userMessage: string,
    constraints: RequirementExecutionConstraints,
    images: ConversationRequirementImage[]
  ): Promise<unknown> {
    return this.complete(
      userMessage,
      constraints,
      images,
      getConversationRequirementConfiguration(this.environment)
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
    }
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
    const response = await fetch(endpoint, {
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
      signal: AbortSignal.timeout(configuration.timeoutMs)
    });

    if (!response.ok) {
      const message = (await response.text()).slice(0, 1_000);
      throw new Error(`需求AI请求失败 (${response.status}): ${message}`);
    }

    const completion = chatCompletionResponseSchema.parse(await response.json());
    const content = completion.choices[0]?.message.content;
    if (!content) throw new Error("需求AI返回了空内容");

    try {
      return JSON.parse(content) as unknown;
    } catch {
      return content;
    }
  }
}
