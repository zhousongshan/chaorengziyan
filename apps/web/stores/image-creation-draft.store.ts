import { create } from "zustand";

import {
  clearPersistedImageCreationDrafts,
  initialPersistedImageCreationDraft,
  loadPersistedImageCreationDrafts,
  savePersistedImageCreationDraft,
  type PersistedImageCreationDraft,
  type PersistedImageCreationDrafts
} from "./image-creation-draft.persistence";

const DRAFT_PERSIST_DELAY_MS = 300;
const pendingPersistedDrafts = new Map<string, PersistedImageCreationDraft>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let beforeUnloadListenerInstalled = false;

type ImageDraftBase = {
  clientId: string;
  name: string;
  byteSize: number;
  previewUrl: string;
};

export type LocalImageDraft = ImageDraftBase & {
  kind: "local";
  file: File;
  assetId?: string;
};

export type ExistingAssetDraft = ImageDraftBase & {
  kind: "asset";
  assetId: string;
};

export type ImageInputDraft = LocalImageDraft | ExistingAssetDraft;

type RuntimeImageCreationDraft = PersistedImageCreationDraft & {
  editBaseImage: ImageInputDraft | null;
  productImages: ImageInputDraft[];
  referenceImages: ImageInputDraft[];
  watermarkLogo: ImageInputDraft | null;
  excludedReferenceAssetIds: string[];
  productCleared: boolean;
  referenceCleared: boolean;
};

type ImageCreationDraftState = RuntimeImageCreationDraft & {
  draftScope: string;
  scopeInitialized: boolean;
  persistedDrafts: PersistedImageCreationDrafts;
  runtimeDrafts: Record<string, RuntimeImageCreationDraft>;
  activateDraftScope: (
    scope: string,
    fallbackScopes?: string[]
  ) => {
    draft: PersistedImageCreationDraft;
    restored: boolean;
  };
  addProductImages: (images: ImageInputDraft[]) => void;
  replaceWithEditBase: (image: ExistingAssetDraft) => void;
  clearEditBaseImage: () => void;
  removeProductImage: (index: number) => void;
  markProductImageUploaded: (clientId: string, assetId: string) => void;
  addReferenceImages: (images: ImageInputDraft[]) => void;
  removeReferenceImage: (index: number) => void;
  markReferenceImageUploaded: (clientId: string, assetId: string) => void;
  excludeReferenceAssetId: (assetId: string) => void;
  setWatermarkLogo: (image: ImageInputDraft | null) => void;
  markWatermarkLogoUploaded: (clientId: string, assetId: string) => void;
  clearReferenceImages: () => void;
  clearSentProductImages: () => void;
  clearSentEditBaseImage: () => void;
  updateDraft: (
    input: Partial<
      Pick<
        ImageCreationDraftState,
        | "userText"
        | "referencePrompt"
        | "agentInstruction"
        | "watermarkEnabled"
        | "watermarkPosition"
        | "imageCount"
        | "aspectRatio"
        | "goal"
        | "style"
        | "quality"
        | "outputFormat"
      >
    >
  ) => void;
  reset: () => void;
};

const initialDraft = {
  editBaseImage: null,
  productImages: [] as ImageInputDraft[],
  referenceImages: [] as ImageInputDraft[],
  watermarkLogo: null,
  excludedReferenceAssetIds: [] as string[],
  productCleared: false,
  referenceCleared: false,
  ...initialPersistedImageCreationDraft
} as const;

export const useImageCreationDraftStore = create<ImageCreationDraftState>((set, get) => ({
  ...initialDraft,
  draftScope: "new:default",
  scopeInitialized: false,
  persistedDrafts: {},
  runtimeDrafts: {},
  activateDraftScope: (scope, fallbackScopes = []) => {
    flushPendingDraftPersistence();
    const state = get();
    if (state.scopeInitialized && state.draftScope === scope) {
      return {
        draft: toPersistedDraft(state),
        restored: Boolean(state.persistedDrafts[scope])
      };
    }
    const persistedDrafts = {
      ...loadPersistedImageCreationDrafts(),
      ...state.persistedDrafts
    };
    const runtimeDrafts = state.scopeInitialized
      ? { ...state.runtimeDrafts, [state.draftScope]: toRuntimeDraft(state) }
      : state.runtimeDrafts;
    const fallbackScope = fallbackScopes.find(
      (candidate) => runtimeDrafts[candidate] ?? persistedDrafts[candidate]
    );
    const restoredDraft =
      persistedDrafts[scope] ?? (fallbackScope ? persistedDrafts[fallbackScope] : undefined);
    const target = runtimeDrafts[scope] ??
      (fallbackScope ? runtimeDrafts[fallbackScope] : undefined) ?? {
        ...initialDraft,
        ...(restoredDraft ?? {})
      };
    const restored = Boolean(runtimeDrafts[scope] ?? persistedDrafts[scope] ?? fallbackScope);
    const nextPersistedDrafts =
      fallbackScope && !persistedDrafts[scope]
        ? { ...persistedDrafts, [scope]: toPersistedDraft(target) }
        : persistedDrafts;
    if (fallbackScope && !persistedDrafts[scope]) {
      scheduleDraftPersistence(scope, toPersistedDraft(target));
    }
    set({
      ...target,
      draftScope: scope,
      scopeInitialized: true,
      persistedDrafts: nextPersistedDrafts,
      runtimeDrafts
    });
    return { draft: toPersistedDraft(target), restored };
  },
  addProductImages: (images) =>
    set((state) => ({
      productImages: mergeUniqueImages(state.productImages, images, 4),
      productCleared: false
    })),
  replaceWithEditBase: (image) => {
    const state = get();
    for (const current of [...state.productImages, ...state.referenceImages, state.editBaseImage]) {
      releaseLocalPreview(current);
    }
    set({
      editBaseImage: image,
      productImages: [],
      referenceImages: [],
      excludedReferenceAssetIds: [],
      productCleared: true,
      referenceCleared: true
    });
  },
  clearEditBaseImage: () => {
    releaseLocalPreview(get().editBaseImage);
    set({ editBaseImage: null });
  },
  removeProductImage: (index) => {
    const state = get();
    const removed = state.productImages[index];
    releaseLocalPreview(removed);
    set({
      productImages: state.productImages.filter((_, itemIndex) => itemIndex !== index),
      productCleared: false
    });
  },
  markProductImageUploaded: (clientId, assetId) =>
    set((state) => ({
      productImages: markImageUploaded(state.productImages, clientId, assetId)
    })),
  addReferenceImages: (images) =>
    set((state) => ({
      referenceImages: [...state.referenceImages, ...images].slice(0, 1),
      referenceCleared: false
    })),
  removeReferenceImage: (index) => {
    const state = get();
    const removed = state.referenceImages[index];
    releaseLocalPreview(removed);
    set({
      referenceImages: state.referenceImages.filter((_, itemIndex) => itemIndex !== index)
    });
  },
  markReferenceImageUploaded: (clientId, assetId) =>
    set((state) => ({
      referenceImages: markImageUploaded(state.referenceImages, clientId, assetId)
    })),
  excludeReferenceAssetId: (assetId) =>
    set((state) => ({
      excludedReferenceAssetIds: [...new Set([...state.excludedReferenceAssetIds, assetId])],
      referenceCleared: true
    })),
  setWatermarkLogo: (image) => {
    const current = get().watermarkLogo;
    if (current?.clientId !== image?.clientId) releaseLocalPreview(current);
    set({ watermarkLogo: image });
  },
  markWatermarkLogoUploaded: (clientId, assetId) =>
    set((state) => ({
      watermarkLogo:
        state.watermarkLogo?.clientId === clientId
          ? { ...state.watermarkLogo, assetId }
          : state.watermarkLogo
    })),
  clearReferenceImages: () => {
    const current = get().referenceImages;
    for (const image of current) releaseLocalPreview(image);
    set({ referenceImages: [], referenceCleared: true });
  },
  clearSentProductImages: () => {
    const current = get().productImages;
    for (const image of current) releaseLocalPreview(image);
    set({ productImages: [], productCleared: false });
  },
  clearSentEditBaseImage: () => {
    releaseLocalPreview(get().editBaseImage);
    set({ editBaseImage: null });
  },
  updateDraft: (input) =>
    set((state) => {
      if (!state.scopeInitialized) return input;
      const draft = toPersistedDraft({ ...state, ...input });
      const persistedDrafts = { ...state.persistedDrafts, [state.draftScope]: draft };
      scheduleDraftPersistence(state.draftScope, draft);
      return { ...input, persistedDrafts };
    }),
  reset: () => {
    cancelPendingDraftPersistence();
    const state = get();
    for (const draft of [state, ...Object.values(state.runtimeDrafts)]) {
      for (const image of [
        draft.editBaseImage,
        ...draft.productImages,
        ...draft.referenceImages,
        draft.watermarkLogo
      ]) {
        releaseLocalPreview(image);
      }
    }
    clearPersistedImageCreationDrafts();
    set({
      ...initialDraft,
      draftScope: "new:default",
      scopeInitialized: false,
      persistedDrafts: {},
      runtimeDrafts: {}
    });
  }
}));

export function flushPendingDraftPersistence(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = undefined;
  for (const [scope, draft] of pendingPersistedDrafts) {
    savePersistedImageCreationDraft(scope, draft);
  }
  pendingPersistedDrafts.clear();
}

function scheduleDraftPersistence(scope: string, draft: PersistedImageCreationDraft): void {
  pendingPersistedDrafts.set(scope, draft);
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(flushPendingDraftPersistence, DRAFT_PERSIST_DELAY_MS);
  installBeforeUnloadListener();
}

function cancelPendingDraftPersistence(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = undefined;
  pendingPersistedDrafts.clear();
}

function installBeforeUnloadListener(): void {
  if (beforeUnloadListenerInstalled || typeof window === "undefined") return;
  window.addEventListener("beforeunload", flushPendingDraftPersistence);
  beforeUnloadListenerInstalled = true;
}

function toRuntimeDraft(state: RuntimeImageCreationDraft): RuntimeImageCreationDraft {
  return {
    editBaseImage: state.editBaseImage,
    productImages: state.productImages,
    referenceImages: state.referenceImages,
    watermarkLogo: state.watermarkLogo,
    excludedReferenceAssetIds: state.excludedReferenceAssetIds,
    productCleared: state.productCleared,
    referenceCleared: state.referenceCleared,
    ...toPersistedDraft(state)
  };
}

function toPersistedDraft(state: PersistedImageCreationDraft): PersistedImageCreationDraft {
  return {
    userText: state.userText,
    referencePrompt: state.referencePrompt,
    agentInstruction: state.agentInstruction,
    watermarkEnabled: state.watermarkEnabled,
    watermarkPosition: state.watermarkPosition,
    imageCount: state.imageCount,
    aspectRatio: state.aspectRatio,
    goal: state.goal,
    style: state.style,
    quality: state.quality,
    outputFormat: state.outputFormat
  };
}

function markImageUploaded(
  images: ImageInputDraft[],
  clientId: string,
  assetId: string
): ImageInputDraft[] {
  return images.map((image) => (image.clientId === clientId ? { ...image, assetId } : image));
}

function mergeUniqueImages(
  current: ImageInputDraft[],
  incoming: ImageInputDraft[],
  limit: number
): ImageInputDraft[] {
  const merged = [...current];
  for (const image of incoming) {
    const duplicate = merged.some(
      (existing) =>
        existing.clientId === image.clientId ||
        (existing.assetId !== undefined && existing.assetId === image.assetId)
    );
    if (!duplicate) merged.push(image);
    if (merged.length >= limit) break;
  }
  return merged;
}

function releaseLocalPreview(image: ImageInputDraft | null | undefined): void {
  if (image?.kind === "local") URL.revokeObjectURL(image.previewUrl);
}
