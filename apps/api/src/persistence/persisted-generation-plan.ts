import { resolvedGenerationPlanSchema, type ResolvedGenerationPlan } from "@chaoren/contracts";

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

/** Reads persisted plans while keeping the current execution contract strict. */
export function parsePersistedGenerationPlan(value: unknown): ResolvedGenerationPlan {
  const current = resolvedGenerationPlanSchema.safeParse(value);
  if (current.success) return current.data;

  const compatible = downgradeEarlyV3Plan(value);
  return resolvedGenerationPlanSchema.parse(compatible ?? value);
}

/** Only the complete current plan may cross the execution boundary. */
export function parseExecutableGenerationPlan(
  value: unknown
): Extract<ResolvedGenerationPlan, { schemaVersion: "3.0" }> {
  const parsed = resolvedGenerationPlanSchema.parse(value);
  if (parsed.schemaVersion !== "3.0") {
    throw new Error("当前执行计划不是可执行的 3.0 契约");
  }
  return parsed;
}

function downgradeEarlyV3Plan(value: unknown): unknown {
  const plan = asRecord(value);
  if (!plan || plan.schemaVersion !== "3.0" || !Array.isArray(plan.groups)) {
    return undefined;
  }
  if (!hasOnlyKeys(plan, earlyV3PlanKeys) || !plan.groups.every(isEarlyV3Group)) {
    return undefined;
  }

  return {
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
