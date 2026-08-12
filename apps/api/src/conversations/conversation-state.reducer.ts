import {
  conversationStateSchema,
  finalRequirementSchema,
  type ConversationRequirementAiOutput,
  type ConversationRequirementField,
  type ConversationState,
  type CreateConversationMessageRequest,
  type RequirementResult,
  type ResolvedGenerationPlan
} from "@chaoren/contracts";

const requirementFields = [
  "imageCount",
  "aspectRatio",
  "intent",
  "scene",
  "background",
  "composition",
  "lighting",
  "style",
  "mustKeep",
  "mustAvoid",
  "additionalRequirements",
  "subjectPolicy"
] as const satisfies readonly ConversationRequirementField[];

export class ConversationStateReducer {
  public reduce(input: {
    previous: ConversationState;
    request: CreateConversationMessageRequest;
    output: ConversationRequirementAiOutput;
    generationPlan: ResolvedGenerationPlan | null;
    messageId: string;
    turnNumber: number;
  }): { state: ConversationState; result: RequirementResult | null } {
    const productAttachments = input.request.attachments.filter(
      (attachment) => attachment.role === "product_source"
    );
    const editBaseAttachment = input.request.attachments.find(
      (attachment) => attachment.role === "edit_base"
    );
    const referenceAttachments = input.request.attachments.filter(
      (attachment) => attachment.role === "user_reference"
    );
    const referenceGuidance = referenceAttachments.map((attachment) => ({
      assetId: attachment.assetId,
      instruction: attachment.relation ?? "仅参考该图的场景、构图或视觉风格，不作为商品主体事实"
    }));

    const stateBase: ConversationState = {
      ...input.previous,
      activeProductAssetIds:
        productAttachments.length > 0
          ? productAttachments.map((attachment) => attachment.assetId)
          : input.request.clearProductImage
            ? []
            : input.previous.activeProductAssetIds,
      editBaseAssetId: editBaseAttachment?.assetId ?? null,
      referenceAssetIds:
        referenceAttachments.length > 0
          ? referenceAttachments.map((attachment) => attachment.assetId)
          : input.request.clearReferenceImages
            ? []
            : input.previous.referenceAssetIds,
      referenceGuidance:
        referenceAttachments.length > 0
          ? referenceGuidance
          : input.request.clearReferenceImages
            ? []
            : input.previous.referenceGuidance,
      agentInstruction: input.request.agentInstruction ?? input.previous.agentInstruction,
      renderSettings: input.request.renderSettings ?? input.previous.renderSettings,
      deliverySettings: input.request.deliverySettings ?? input.previous.deliverySettings,
      currentGenerationPlan: input.generationPlan ?? input.previous.currentGenerationPlan
    };

    if (input.output.action === "respond_only") {
      return {
        state: conversationStateSchema.parse(stateBase),
        result: null
      };
    }

    if (input.output.action === "ask_user") {
      if (input.output.result?.status !== "needs_clarification") {
        throw new Error("ask_user 缺少结构化问题结果");
      }
      const state = conversationStateSchema.parse({
        ...stateBase,
        unresolvedQuestions: input.output.result.questions
      });
      return { state, result: input.output.result };
    }

    if (input.output.result?.status !== "ready") {
      throw new Error(`${input.output.action} 缺少可用需求结果`);
    }
    const candidate = input.output.result.finalRequirement;
    const current = input.previous.currentRequirement;
    const changedFields = new Set(input.output.changedFields);
    const merged = current ? { ...current } : { ...candidate };
    const appliedFields = current
      ? requirementFields.filter((field) => changedFields.has(field))
      : requirementFields;
    for (const field of appliedFields) {
      Object.assign(merged, { [field]: candidate[field] });
    }
    const finalRequirement = finalRequirementSchema.parse(merged);
    const fieldSources = { ...input.previous.fieldSources };
    for (const field of appliedFields) {
      fieldSources[field] = { messageId: input.messageId, turnNumber: input.turnNumber };
    }
    const state = conversationStateSchema.parse({
      ...stateBase,
      currentRequirement: finalRequirement,
      unresolvedQuestions: [],
      fieldSources
    });
    return {
      state,
      result: { ...input.output.result, finalRequirement }
    };
  }
}
