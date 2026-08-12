import { z } from "zod";

const STORAGE_KEY = "chaoren:image-creation-drafts:v2";
const LEGACY_STORAGE_KEY = "chaoren:image-creation-drafts:v1";
export const MAX_PERSISTED_DRAFT_SCOPES = 20;
export const PERSISTED_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

const persistedImageCreationDraftSchema = z
  .object({
    userText: z.string().max(12_000),
    referencePrompt: z.string().max(1_000),
    agentInstruction: z.string().max(1_000),
    watermarkEnabled: z.boolean(),
    watermarkPosition: z.enum(["右下角", "左上角", "右上角", "左下角", "居中"]),
    imageCount: z.number().int().min(1).max(4),
    aspectRatio: z.enum(["1:1", "3:4", "4:3", "9:16", "16:9"]),
    goal: z.enum(["商品主图", "场景展示", "营销海报", "详情页配图"]),
    style: z.enum(["真实摄影", "清新简约", "高级质感", "创意视觉"]),
    quality: z.enum(["标准", "高清"]),
    outputFormat: z.enum(["PNG", "JPG", "WEBP"])
  })
  .strict();

const legacyDraftEnvelopeSchema = z
  .object({
    version: z.literal(1),
    drafts: z.record(z.string(), persistedImageCreationDraftSchema)
  })
  .strict();

const persistedDraftEntrySchema = z
  .object({
    draft: persistedImageCreationDraftSchema,
    updatedAt: z.number().int().nonnegative()
  })
  .strict();

const draftEnvelopeSchema = z
  .object({
    version: z.literal(2),
    drafts: z.record(z.string(), persistedDraftEntrySchema)
  })
  .strict();

export type PersistedImageCreationDraft = z.infer<typeof persistedImageCreationDraftSchema>;
export type PersistedImageCreationDrafts = Record<string, PersistedImageCreationDraft>;
type PersistedDraftEntries = z.infer<typeof draftEnvelopeSchema>["drafts"];
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const initialPersistedImageCreationDraft: PersistedImageCreationDraft = {
  userText: "",
  referencePrompt: "",
  agentInstruction: "",
  watermarkEnabled: false,
  watermarkPosition: "右下角",
  imageCount: 1,
  aspectRatio: "1:1",
  goal: "营销海报",
  style: "清新简约",
  quality: "高清",
  outputFormat: "PNG"
};

export function loadPersistedImageCreationDrafts(
  storage = browserStorage(),
  now = Date.now()
): PersistedImageCreationDrafts {
  if (!storage) return {};
  const entries = loadEntries(storage, now);
  return Object.fromEntries(Object.entries(entries).map(([scope, entry]) => [scope, entry.draft]));
}

export function savePersistedImageCreationDraft(
  scope: string,
  draft: PersistedImageCreationDraft,
  storage = browserStorage(),
  now = Date.now()
): void {
  if (!storage) return;
  try {
    const entries = loadEntries(storage, now);
    entries[scope] = { draft: persistedImageCreationDraftSchema.parse(draft), updatedAt: now };
    writeEntries(storage, pruneEntries(entries, now));
  } catch {
    // Draft persistence is best-effort and must not block the composer.
  }
}

export function clearPersistedImageCreationDrafts(storage = browserStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
    storage?.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function loadEntries(storage: DraftStorage, now: number): PersistedDraftEntries {
  const current = parseCurrentEntries(storage);
  if (current) {
    const pruned = pruneEntries(current, now);
    if (Object.keys(pruned).length !== Object.keys(current).length) writeEntries(storage, pruned);
    return pruned;
  }

  const legacy = parseLegacyDrafts(storage);
  if (!legacy) return {};
  const migrated = pruneEntries(
    Object.fromEntries(
      Object.entries(legacy).map(([scope, draft]) => [scope, { draft, updatedAt: now }])
    ),
    now
  );
  writeEntries(storage, migrated);
  storage.removeItem(LEGACY_STORAGE_KEY);
  return migrated;
}

function parseCurrentEntries(storage: DraftStorage): PersistedDraftEntries | null {
  const serialized = storage.getItem(STORAGE_KEY);
  if (!serialized) return null;
  try {
    return draftEnvelopeSchema.parse(JSON.parse(serialized)).drafts;
  } catch {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

function parseLegacyDrafts(storage: DraftStorage): PersistedImageCreationDrafts | null {
  const serialized = storage.getItem(LEGACY_STORAGE_KEY);
  if (!serialized) return null;
  try {
    return legacyDraftEnvelopeSchema.parse(JSON.parse(serialized)).drafts;
  } catch {
    storage.removeItem(LEGACY_STORAGE_KEY);
    return null;
  }
}

function pruneEntries(entries: PersistedDraftEntries, now: number): PersistedDraftEntries {
  return Object.fromEntries(
    Object.entries(entries)
      .filter(([, entry]) => now - entry.updatedAt <= PERSISTED_DRAFT_MAX_AGE_MS)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_PERSISTED_DRAFT_SCOPES)
  );
}

function writeEntries(storage: DraftStorage, drafts: PersistedDraftEntries): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, drafts }));
}

function browserStorage(): DraftStorage | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return window.localStorage;
  } catch {
    return undefined;
  }
}
