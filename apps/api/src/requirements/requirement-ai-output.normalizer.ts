import {
  finalRequirementSchema,
  type AdditionalRequirement,
  type ConversationRequirementField,
  type FinalRequirement
} from "@chaoren/contracts";

import type { RequirementValidationIssue } from "./requirement-ai.port.js";

type JsonValue = Exclude<AdditionalRequirement["value"], undefined>;

// AI boundary only: tolerate provider-shaped values and preserve open creative fields.
// Authorization, ownership, model capability and execution limits remain program-owned gates.

const prohibitedAiFields = new Set([
  "id",
  "userId",
  "projectId",
  "sessionId",
  "messageId",
  "modelId",
  "assetId",
  "assetIds",
  "productImageIds",
  "referenceImageIds",
  "requirementRunId",
  "stateSnapshotId"
]);

const fieldAliases = new Map<string, ConversationRequirementField>([
  ["imageCount", "imageCount"],
  ["aspectRatio", "aspectRatio"],
  ["intent", "intent"],
  ["scene", "scene"],
  ["background", "background"],
  ["composition", "composition"],
  ["lighting", "lighting"],
  ["style", "style"],
  ["visualStyle", "style"],
  ["mustKeep", "mustKeep"],
  ["mustAvoid", "mustAvoid"],
  ["avoid", "mustAvoid"],
  ["subjectPolicy", "subjectPolicy"],
  ["allowedChanges", "subjectPolicy"],
  ["additionalRequirements", "additionalRequirements"]
]);

const programControlledFields = new Set(["generationGoal"]);

export type RequirementUpdateNormalizationResult =
  | {
      success: true;
      finalRequirement: FinalRequirement;
      changedFields: ConversationRequirementField[];
    }
  | { success: false; issues: RequirementValidationIssue[] };

export function normalizeRequirementUpdate(input: {
  requirements: Record<string, unknown>;
  currentRequirement: FinalRequirement | null;
  defaults: { userText: string; imageCount: number; aspectRatio: string };
}): RequirementUpdateNormalizationResult {
  const patch: Record<string, unknown> = {};
  const changedFields = new Set<ConversationRequirementField>();
  const discoveredExtensions: AdditionalRequirement[] = [];
  const removedExtensionKeys = new Set<string>();
  let explicitExtensions: AdditionalRequirement[] | undefined;
  const issues: RequirementValidationIssue[] = [];

  for (const [rawKey, rawValue] of Object.entries(input.requirements)) {
    if (prohibitedAiFields.has(rawKey)) {
      issues.push({ field: `requirements.${rawKey}`, message: "AI不得输出程序控制字段" });
      continue;
    }
    if (programControlledFields.has(rawKey)) continue;

    const field = fieldAliases.get(rawKey);
    if (!field) {
      const extensionKey = normalizeAdditionalKey(rawKey);
      if (rawValue === null || rawValue === undefined) {
        removedExtensionKeys.add(extensionKey);
      } else {
        discoveredExtensions.push(normalizeDiscoveredRequirement(extensionKey, rawValue));
      }
      changedFields.add("additionalRequirements");
      continue;
    }

    const normalized = normalizeKnownField(field, rawValue);
    if (!normalized.success) {
      issues.push({ field: `requirements.${rawKey}`, message: normalized.message });
      continue;
    }
    if (field === "additionalRequirements") {
      explicitExtensions = normalized.value as AdditionalRequirement[];
      changedFields.add(field);
      continue;
    }
    patch[field] = normalized.value;
    changedFields.add(field);
  }

  if (issues.length > 0) return { success: false, issues };

  if (
    explicitExtensions !== undefined ||
    discoveredExtensions.length > 0 ||
    removedExtensionKeys.size > 0
  ) {
    patch.additionalRequirements = mergeAdditionalRequirements(
      explicitExtensions ?? input.currentRequirement?.additionalRequirements ?? [],
      discoveredExtensions,
      removedExtensionKeys
    );
  }

  if (!input.currentRequirement) {
    patch.imageCount ??= input.defaults.imageCount;
    patch.aspectRatio ??= input.defaults.aspectRatio;
    patch.intent ??= input.defaults.userText.trim();
    changedFields.add("imageCount");
    changedFields.add("aspectRatio");
    changedFields.add("intent");
  }

  const candidate = { ...(input.currentRequirement ?? {}), ...patch };
  const parsed = finalRequirementSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        field: ["requirements", ...issue.path.map(String)].join("."),
        message: issue.message
      }))
    };
  }
  return { success: true, finalRequirement: parsed.data, changedFields: [...changedFields] };
}

export function normalizeConflictDecisions(value: unknown) {
  const source = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return source.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      return [
        {
          field: "general",
          decision: item.trim(),
          reason: "需求AI记录的冲突处理"
        }
      ];
    }
    const record = asRecord(item);
    if (!record) return [];
    const field = firstText(record.field, record.topic, record.key) ?? "general";
    const decision = firstText(record.decision, record.result, record.summary);
    if (!decision) return [];
    const reason = firstText(record.reason, record.explanation) ?? "需求AI记录的冲突处理";
    return [{ field, decision, reason }];
  });
}

export function normalizeImageObservations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).flatMap((item) => {
    const record = asRecord(item);
    const key = firstText(record?.key, record?.imageKey);
    const caption = firstText(record?.caption, record?.description);
    if (!key || !caption) return [];
    return [
      {
        key: key.slice(0, 100),
        caption: caption.slice(0, 2_000),
        ocrText: firstText(record?.ocrText, record?.ocr)?.slice(0, 4_000) ?? null,
        productFacts: asRecord(record?.productFacts) ?? {},
        creativeFacts: asRecord(record?.creativeFacts) ?? {}
      }
    ];
  });
}

function normalizeKnownField(
  field: ConversationRequirementField,
  value: unknown
): { success: true; value: unknown } | { success: false; message: string } {
  if (field === "imageCount") {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isInteger(number) && number > 0
      ? { success: true, value: number }
      : { success: false, message: "图片数量必须是正整数" };
  }
  if (field === "aspectRatio") {
    const text = toText(value);
    return text
      ? { success: true, value: text }
      : { success: false, message: "图片比例必须是字符串" };
  }
  if (["intent", "scene", "background", "composition", "lighting", "style"].includes(field)) {
    if (value === null && field !== "intent") return { success: true, value: null };
    const text = toText(value);
    return text
      ? { success: true, value: text }
      : { success: false, message: `${field} 必须是可用文本` };
  }
  if (field === "mustKeep" || field === "mustAvoid") {
    return { success: true, value: toTextList(value) };
  }
  if (field === "subjectPolicy") {
    return { success: true, value: normalizeSubjectPolicy(value) };
  }
  if (field === "additionalRequirements") {
    return { success: true, value: normalizeAdditionalRequirements(value) };
  }
  return { success: false, message: "不支持的需求字段" };
}

function normalizeSubjectPolicy(value: unknown) {
  const record = asRecord(value);
  const rawChanges = record?.allowedChanges ?? value;
  const changeRecord = asRecord(rawChanges);
  const source = Array.isArray(rawChanges)
    ? rawChanges
    : changeRecord && !firstText(changeRecord.feature, changeRecord.key, changeRecord.name)
      ? Object.entries(changeRecord).map(([feature, instruction]) => ({ feature, instruction }))
      : rawChanges === undefined || rawChanges === null || isPreserveOnlyValue(rawChanges)
        ? []
        : [rawChanges];
  return {
    defaultAction: "preserve" as const,
    allowedChanges: source.slice(0, 32).flatMap((item, index) => {
      if (typeof item === "string" && item.trim()) {
        const label = item.trim();
        if (isPreserveOnlyValue(label)) return [];
        return [
          {
            feature: normalizeFeatureKey(label, index),
            instruction: `仅允许修改 ${label}`
          }
        ];
      }
      const change = asRecord(item);
      if (!change) return [];
      const label = firstText(change.feature, change.key, change.name);
      if (!label) return [];
      return [
        {
          feature: normalizeFeatureKey(label, index),
          instruction: (
            firstText(change.instruction, change.description, change.value) ?? `仅允许修改 ${label}`
          ).slice(0, 2_000)
        }
      ];
    })
  };
}

function isPreserveOnlyValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return ["preserve", "none", "no_change", "保持不变", "不修改", "无"].includes(
    value.trim().toLowerCase()
  );
}

function normalizeAdditionalRequirements(
  value: unknown,
  fallbackKey?: string
): AdditionalRequirement[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      normalizeAdditionalRequirements(item, fallbackKey ?? `additional_requirement_${index + 1}`)
    );
  }
  const record = asRecord(value);
  if (record) {
    const explicitInstruction = firstText(record.instruction, record.description, record.text);
    if (explicitInstruction) {
      const key = normalizeAdditionalKey(
        firstText(record.key, record.name) ?? fallbackKey ?? "additional_requirement"
      );
      const label = firstText(record.label, record.name);
      return [
        {
          key,
          label: label?.slice(0, 200),
          instruction: explicitInstruction.slice(0, 2_000),
          value: toJsonValue(record.value ?? value)
        }
      ];
    }
    return Object.entries(record).flatMap(([key, item]) =>
      normalizeAdditionalRequirements(item, key)
    );
  }
  const instruction = toInstruction(value);
  if (!instruction) return [];
  return [
    {
      key: normalizeAdditionalKey(fallbackKey ?? "additional_requirement"),
      instruction,
      value: toJsonValue(value)
    }
  ];
}

function normalizeDiscoveredRequirement(key: string, value: unknown): AdditionalRequirement {
  return {
    key,
    label: key,
    instruction: toInstruction(value) ?? `已提供 ${key} 的结构化补充要求`,
    value: toJsonValue(value)
  };
}

function normalizeAdditionalKey(value: string): string {
  return value.trim().slice(0, 100) || "additional_requirement";
}

function mergeAdditionalRequirements(
  current: AdditionalRequirement[],
  additions: AdditionalRequirement[],
  removals: ReadonlySet<string> = new Set()
): AdditionalRequirement[] {
  const merged = new Map(current.map((item) => [item.key, item]));
  for (const key of removals) merged.delete(key);
  for (const item of additions) merged.set(item.key, item);
  return [...merged.values()].slice(0, 32);
}

function normalizeFeatureKey(value: string, index: number): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return /^[a-z][a-z0-9_]*$/.test(normalized) ? normalized : `other_detail_${index + 1}`;
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function toTextList(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  return source
    .map(toInstruction)
    .filter((item): item is string => Boolean(item))
    .slice(0, 32);
}

function toInstruction(value: unknown): string | undefined {
  const text = toText(value);
  if (text) return text.slice(0, 2_000);
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}" ? serialized.slice(0, 2_000) : undefined;
  } catch {
    return undefined;
  }
}

function toJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return null;
  }
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
