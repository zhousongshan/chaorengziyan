import { conversationStateSchema, type ConversationState } from "@chaoren/contracts";

const earlyV3PlanKeys = new Set(["schemaVersion", "summary", "groups"]);
const earlyV3GroupKeys = new Set([
  "sourceImages",
  "subjectEntities",
  "subjectPolicy",
  "referenceAnalyses",
  "outputCount",
  "outputLayout",
  "instruction"
]);

export function parsePersistedConversationState(value: unknown): ConversationState {
  const current = conversationStateSchema.safeParse(value);
  if (current.success) return current.data;

  const compatible = downgradeEarlyV3Plan(value);
  return conversationStateSchema.parse(compatible ?? value);
}

function downgradeEarlyV3Plan(value: unknown): unknown {
  const state = asRecord(value);
  const plan = asRecord(state?.currentGenerationPlan);
  if (!state || !plan || plan.schemaVersion !== "3.0" || !Array.isArray(plan.groups)) {
    return undefined;
  }
  if (!hasOnlyKeys(plan, earlyV3PlanKeys) || !plan.groups.every(isEarlyV3Group)) {
    return undefined;
  }

  // Early v3 snapshots predate the complete reference/copy execution contract. Treat them as
  // read-only legacy context; a later generation must produce a fresh, strictly validated v3 plan.
  return {
    ...state,
    currentGenerationPlan: {
      schemaVersion: "2.0",
      summary: plan.summary,
      groups: plan.groups.map((value) => {
        const group = value as Record<string, unknown>;
        return {
          sourceImages: group.sourceImages,
          subjectEntities: group.subjectEntities,
          outputCount: group.outputCount,
          outputLayout: group.outputLayout,
          instruction: group.instruction
        };
      })
    }
  };
}

function isEarlyV3Group(value: unknown): boolean {
  const group = asRecord(value);
  if (!group || !hasOnlyKeys(group, earlyV3GroupKeys)) return false;
  return [...earlyV3GroupKeys].every((key) => Object.hasOwn(group, key));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
