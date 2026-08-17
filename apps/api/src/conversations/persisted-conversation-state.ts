import { conversationStateSchema, type ConversationState } from "@chaoren/contracts";

import { parsePersistedGenerationPlan } from "../persistence/persisted-generation-plan.js";

export function parsePersistedConversationState(value: unknown): ConversationState {
  const current = conversationStateSchema.safeParse(value);
  if (current.success) return current.data;

  const state = asRecord(value);
  const plan = state?.currentGenerationPlan;
  if (!state || plan === null || plan === undefined) {
    return conversationStateSchema.parse(value);
  }
  return conversationStateSchema.parse({
    ...state,
    currentGenerationPlan: parsePersistedGenerationPlan(plan)
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
