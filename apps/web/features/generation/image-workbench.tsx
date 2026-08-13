"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  Download,
  Heart,
  ImagePlus,
  LoaderCircle,
  Pencil,
  RefreshCw,
  WandSparkles,
  X
} from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { useForm, useWatch, type Control, type UseFormRegister } from "react-hook-form";
import { z } from "zod";

import type {
  ConversationHistoryResponse,
  ConversationMessage,
  ConversationSession,
  CurrentConversationResponse,
  ImageGenerationTask,
  MediaAssetListItem,
  MediaAssetResponse,
  PromptOptimization
} from "@chaoren/contracts";

import { Button } from "@/components/ui/button";
import { AssetPickerDialog } from "@/features/assets/asset-picker-dialog";
import { activeProjectQueryOptions } from "@/lib/api/active-project";
import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { downloadMediaAsset } from "@/lib/download-media-asset";
import {
  openGenerationEventStream,
  openSubjectConsistencyEventStream
} from "@/lib/sse/generation-events";
import { cn } from "@/lib/utils";
import {
  useImageCreationDraftStore,
  type ExistingAssetDraft,
  type LocalImageDraft
} from "@/stores/image-creation-draft.store";

import { mergeAcceptedConversationTurn } from "./conversation-cache";
import { formatConversationTime } from "./conversation-time";
import {
  mergeLatestConversationHistory,
  mergeOlderConversationHistory,
  type LoadedConversationHistory
} from "./conversation-history-pagination";
import { creationUrl } from "./conversation-navigation";
import { findGenerationTurnNumber } from "./conversation-task-lineage";
import { recoverLatestCompletedTurnRequirement } from "./conversation-result-recovery";
import {
  generationStageForQualityPhase,
  generationStageLabel,
  type GenerationStage
} from "./generation-stage";
import { groupGenerationOutputFailures } from "./generation-failure-presentation";
import {
  indexHistoricalGenerationResults,
  type HistoricalGenerationResult
} from "./historical-generation-results";
import { deriveWorkflowError, getDeliverableAssets } from "./creation-run-presentation";
import { estimateWorkflowProgress, formatProgressDuration } from "./workflow-progress";
import { resolveGenerationViewModel } from "./generation-view-model";
import {
  activeGenerationPollingInterval,
  conversationPollingInterval,
  readinessPollingInterval
} from "./query-polling";
import { deriveSubmitAvailability, hasComposerInput } from "./submit-availability";
import {
  createBrowserRegenerationSubmissionStore,
  shouldRetainRegenerationSubmission,
  type RegenerationSubmissionIdentity
} from "./regeneration-submission";
import {
  presentUserError,
  presentUserErrorCode,
  type UserErrorPresentation
} from "./user-error-catalog";
import {
  NormalModeComposer,
  NormalModeEmptyState,
  NormalModeReferencePanel,
  NormalModeSettings,
  type NormalModeSettingField
} from "./normal-mode/normal-mode-ui";
import normalModeStyles from "./normal-mode/normal-mode.module.css";
import { extractClipboardImageFiles } from "./image-input/clipboard-image";
import {
  createLocalImageDraft,
  type LocalImageInputSource,
  type LocalImageTarget
} from "./image-input/local-image-file";
import { resolveImageAssetIds } from "./image-input/resolve-image-assets";

const knownRatios = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
const imageCounts = [1, 2, 3, 4] as const;

const imageCreationFormSchema = z
  .object({
    modelId: z.string().trim().min(1, "当前没有可用的生图模型"),
    userText: z.string().trim().max(12_000),
    imageCount: z.number().int().min(1).max(4),
    aspectRatio: z.enum(knownRatios),
    goal: z.enum(["商品主图", "场景展示", "营销海报", "详情页配图"]),
    style: z.enum(["真实摄影", "清新简约", "高级质感", "创意视觉"]),
    quality: z.enum(["标准", "高清"]),
    outputFormat: z.enum(["PNG", "JPG", "WEBP"]),
    watermark: z.boolean()
  })
  .strict();

type ImageCreationFormValues = z.infer<typeof imageCreationFormSchema>;
type PendingTurn = { text: string; previewUrls: string[]; createdAt: string };
type EditResultTarget = { asset: MediaAssetResponse; name: string };
type PromptOptimizationUiState = {
  record: PromptOptimization;
  contextSignature: string;
  history: Array<{
    text: string;
    record: PromptOptimization | null;
    contextSignature: string | null;
  }>;
  error: string | null;
};
type WorkbenchComposerProps = Omit<
  ComponentProps<typeof NormalModeComposer>,
  | "textLength"
  | "userTextRegistration"
  | "submitDisabled"
  | "submitLabel"
  | "submitUnavailableReason"
> & {
  control: Control<ImageCreationFormValues>;
  register: UseFormRegister<ImageCreationFormValues>;
  referenceImageCount: number;
  submitAvailability: ReturnType<typeof deriveSubmitAvailability>;
  updateUserTextDraft: (userText: string) => void;
};

export function ImageWorkbench() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const regenerationSubmissions = useMemo(createBrowserRegenerationSubmissionStore, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const historyTopRef = useRef<HTMLDivElement>(null);
  const historyScrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const positionedHistorySessionRef = useRef<string | null>(null);
  const shouldFollowLatestRef = useRef(true);
  const olderMessagesLoadingRef = useRef(false);
  const automaticGenerationRef = useRef<string | null>(null);
  const restoredConversationRef = useRef<string | null>(null);
  const restoredAgentRef = useRef<string | null>(null);
  const persistedDraftScopeRef = useRef<string | null>(null);
  const skipDraftPersistRef = useRef(false);

  const editBaseImage = useImageCreationDraftStore((state) => state.editBaseImage);
  const productImages = useImageCreationDraftStore((state) => state.productImages);
  const referenceImages = useImageCreationDraftStore((state) => state.referenceImages);
  const watermarkLogo = useImageCreationDraftStore((state) => state.watermarkLogo);
  const excludedReferenceAssetIds = useImageCreationDraftStore(
    (state) => state.excludedReferenceAssetIds
  );
  const productCleared = useImageCreationDraftStore((state) => state.productCleared);
  const referenceCleared = useImageCreationDraftStore((state) => state.referenceCleared);
  const addProductImages = useImageCreationDraftStore((state) => state.addProductImages);
  const replaceWithEditBase = useImageCreationDraftStore((state) => state.replaceWithEditBase);
  const clearEditBaseImage = useImageCreationDraftStore((state) => state.clearEditBaseImage);
  const removeProductImage = useImageCreationDraftStore((state) => state.removeProductImage);
  const markProductImageUploaded = useImageCreationDraftStore(
    (state) => state.markProductImageUploaded
  );
  const addReferenceImages = useImageCreationDraftStore((state) => state.addReferenceImages);
  const removeReferenceImage = useImageCreationDraftStore((state) => state.removeReferenceImage);
  const markReferenceImageUploaded = useImageCreationDraftStore(
    (state) => state.markReferenceImageUploaded
  );
  const excludeReferenceAssetId = useImageCreationDraftStore(
    (state) => state.excludeReferenceAssetId
  );
  const setWatermarkLogo = useImageCreationDraftStore((state) => state.setWatermarkLogo);
  const markWatermarkLogoUploaded = useImageCreationDraftStore(
    (state) => state.markWatermarkLogoUploaded
  );
  const clearSentProductImages = useImageCreationDraftStore(
    (state) => state.clearSentProductImages
  );
  const clearSentEditBaseImage = useImageCreationDraftStore(
    (state) => state.clearSentEditBaseImage
  );
  const updateDraft = useImageCreationDraftStore((state) => state.updateDraft);
  const activateDraftScope = useImageCreationDraftStore((state) => state.activateDraftScope);
  const referencePrompt = useImageCreationDraftStore((state) => state.referencePrompt);
  const agentInstruction = useImageCreationDraftStore((state) => state.agentInstruction);
  const watermarkPosition = useImageCreationDraftStore((state) => state.watermarkPosition);

  const [uploadError, setUploadError] = useState("");
  const [imageInputNotice, setImageInputNotice] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [conversationSession, setConversationSession] = useState<ConversationSession | null>(null);
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  const [runError, setRunError] = useState<UserErrorPresentation | null>(null);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [editResultTarget, setEditResultTarget] = useState<EditResultTarget | null>(null);
  const [promptOptimization, setPromptOptimization] = useState<PromptOptimizationUiState | null>(
    null
  );
  const [promptOptimizationPending, setPromptOptimizationPending] = useState(false);
  const [loadedConversationHistory, setLoadedConversationHistory] =
    useState<LoadedConversationHistory | null>(null);
  const [historyPagingArmedSessionId, setHistoryPagingArmedSessionId] = useState<string | null>(
    null
  );

  const recoveredRequirementRunId = parseUuid(searchParams.get("requirementRunId"));
  const recoveredTaskId = parseUuid(searchParams.get("taskId"));
  const recoveredSessionId = parseUuid(searchParams.get("sessionId"));
  const selectedAgentId = parseUuid(searchParams.get("agentId"));
  const draftScope = `agent:${selectedAgentId ?? "default"}`;
  const legacyDraftScopes = useMemo(
    () => [
      ...(recoveredSessionId ? [`session:${recoveredSessionId}`] : []),
      `new:${selectedAgentId ?? "default"}`
    ],
    [recoveredSessionId, selectedAgentId]
  );

  useEffect(() => {
    setLoadedConversationHistory(null);
    setHistoryPagingArmedSessionId(null);
    positionedHistorySessionRef.current = null;
    historyScrollRestoreRef.current = null;
    olderMessagesLoadingRef.current = false;
  }, [recoveredSessionId]);

  const activeProjectQuery = useQuery(activeProjectQueryOptions);

  const imageModelsQuery = useQuery({
    queryKey: queryKeys.imageModels,
    queryFn: () => apiClient.getImageModels(),
    staleTime: 5 * 60_000
  });

  const selectedAgentQuery = useQuery({
    queryKey: queryKeys.agent(selectedAgentId ?? "none"),
    queryFn: () => apiClient.getAgent(selectedAgentId!),
    enabled: Boolean(selectedAgentId),
    retry: false,
    staleTime: 5 * 60_000
  });

  const readinessQuery = useQuery({
    queryKey: queryKeys.readiness,
    queryFn: () => apiClient.getReadiness(),
    retry: false,
    refetchInterval: (query) => readinessPollingInterval(query.state.data?.status)
  });
  const generationServiceReady = readinessQuery.data?.status === "ready";

  const conversationQuery = useQuery({
    queryKey: queryKeys.conversation(recoveredSessionId ?? "none", selectedAgentId ?? "none"),
    queryFn: () => apiClient.getConversation(recoveredSessionId!, selectedAgentId!),
    enabled: Boolean(recoveredSessionId && selectedAgentId),
    retry: false,
    gcTime: 10 * 60_000,
    refetchInterval: (query) =>
      conversationPollingInterval(query.state.data?.session.processingMessageId)
  });

  useEffect(() => {
    if (!conversationQuery.data) return;
    setLoadedConversationHistory((current) =>
      mergeLatestConversationHistory(current, conversationQuery.data)
    );
  }, [conversationQuery.data]);

  const conversationHistory = useMemo(() => {
    const latest = conversationQuery.data;
    if (!latest || loadedConversationHistory?.sessionId !== latest.session.id) return latest;
    return {
      ...latest,
      messages: loadedConversationHistory.messages,
      requirementRuns: loadedConversationHistory.requirementRuns,
      messagePage: loadedConversationHistory.messagePage
    };
  }, [conversationQuery.data, loadedConversationHistory]);

  const olderMessagesMutation = useMutation({
    mutationFn: (input: { sessionId: string; agentId: string; beforeTurn: number }) =>
      apiClient.getConversationMessages(input.sessionId, input.agentId, input.beforeTurn),
    onMutate: () => {
      historyScrollRestoreRef.current = {
        height: document.documentElement.scrollHeight,
        top: window.scrollY
      };
    },
    onSuccess: (page, input) => {
      setLoadedConversationHistory((current) =>
        current?.sessionId === input.sessionId
          ? mergeOlderConversationHistory(current, page)
          : current
      );
    },
    onError: () => {
      historyScrollRestoreRef.current = null;
    },
    onSettled: () => {
      olderMessagesLoadingRef.current = false;
    }
  });

  const loadOlderMessages = () => {
    const beforeTurn = conversationHistory?.messagePage.nextBeforeTurn;
    if (!recoveredSessionId || !selectedAgentId || !beforeTurn || olderMessagesLoadingRef.current) {
      return;
    }
    olderMessagesLoadingRef.current = true;
    olderMessagesMutation.mutate({
      sessionId: recoveredSessionId,
      agentId: selectedAgentId,
      beforeTurn
    });
  };

  const currentConversationQuery = useQuery({
    queryKey: queryKeys.currentConversation(selectedAgentId ?? "none"),
    queryFn: () => apiClient.getCurrentConversation(selectedAgentId!),
    enabled: Boolean(selectedAgentId && !recoveredSessionId),
    retry: false,
    staleTime: 30_000
  });

  const promptOptimizationQuery = useQuery({
    queryKey: queryKeys.promptOptimization(
      promptOptimization?.record.sessionId ?? "none",
      promptOptimization?.record.id ?? "none"
    ),
    queryFn: () =>
      apiClient.getPromptOptimization(
        promptOptimization!.record.sessionId,
        promptOptimization!.record.id
      ),
    enabled: promptOptimization?.record.status === "processing",
    retry: false,
    refetchInterval: (query) =>
      !query.state.data || query.state.data.status === "processing" ? 1_500 : false
  });

  useEffect(() => {
    const record = promptOptimizationQuery.data;
    if (!record || record.id !== promptOptimization?.record.id) return;
    setPromptOptimization((current) =>
      current?.record.id === record.id
        ? {
            ...current,
            record,
            error:
              record.status === "failed"
                ? presentUserErrorCode(record.errorCode).message
                : current.error
          }
        : current
    );
  }, [promptOptimization?.record.id, promptOptimizationQuery.data]);

  const activeConversationSession = conversationSession ?? conversationHistory?.session;
  const sessionReadable = Boolean(
    selectedAgentId && activeConversationSession?.agentId === selectedAgentId
  );

  const recoveredRequirementQuery = useQuery({
    queryKey: queryKeys.requirement(recoveredRequirementRunId ?? "none"),
    queryFn: () => apiClient.getRequirement(recoveredRequirementRunId!),
    enabled: Boolean(recoveredRequirementRunId),
    retry: false
  });

  const loadedRequirementRunIds = useMemo(() => {
    const runs = [...(conversationHistory?.requirementRuns ?? [])];
    const latest = conversationHistory?.latestRequirementRun;
    if (latest && !runs.some((run) => run.requirementRunId === latest.requirementRunId)) {
      runs.push(latest);
    }
    const messageTurns = new Map(
      (conversationHistory?.messages ?? []).map((message) => [message.id, message.turnNumber])
    );
    return runs
      .sort(
        (left, right) =>
          (messageTurns.get(right.sourceMessageId) ?? Number.MAX_SAFE_INTEGER) -
          (messageTurns.get(left.sourceMessageId) ?? Number.MAX_SAFE_INTEGER)
      )
      .map((run) => run.requirementRunId);
  }, [conversationHistory]);
  const requirementRunChunks = useMemo(
    () => chunkValues(loadedRequirementRunIds, 20),
    [loadedRequirementRunIds]
  );
  const sessionGenerationQueries = useQueries({
    queries: requirementRunChunks.map((requirementRunIds) => ({
      queryKey: queryKeys.sessionGenerations(recoveredSessionId ?? "none", requirementRunIds),
      queryFn: () =>
        apiClient.getImageGenerationsForSession(recoveredSessionId!, requirementRunIds),
      enabled: Boolean(recoveredSessionId && sessionReadable),
      retry: false,
      staleTime: 10_000
    }))
  });
  const sessionGenerationTasks = useMemo(() => {
    const tasks = new Map<string, ImageGenerationTask>();
    for (const query of sessionGenerationQueries) {
      for (const task of query.data?.tasks ?? []) tasks.set(task.taskId, task);
    }
    return [...tasks.values()];
  }, [sessionGenerationQueries]);
  const sessionGenerationsReady = sessionGenerationQueries.every((query) => query.isSuccess);

  const activeSessionGenerationQuery = useQuery({
    queryKey: queryKeys.activeSessionGeneration(recoveredSessionId ?? "none"),
    queryFn: () => apiClient.getActiveImageGenerationForSession(recoveredSessionId!),
    enabled: Boolean(recoveredSessionId && sessionReadable),
    retry: false,
    refetchInterval: (query) => activeGenerationPollingInterval(query.state.data?.task)
  });

  useEffect(() => {
    if (
      !recoveredSessionId ||
      !activeSessionGenerationQuery.isSuccess ||
      activeSessionGenerationQuery.data.task
    ) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: queryKeys.sessionGenerationsRoot(recoveredSessionId)
    });
  }, [
    activeSessionGenerationQuery.data?.task,
    activeSessionGenerationQuery.isSuccess,
    queryClient,
    recoveredSessionId
  ]);

  const historicalSubjectQueries = useQueries({
    queries: sessionGenerationTasks
      .filter((task) =>
        ["succeeded", "partially_succeeded"].includes(task.workflowStatus ?? task.status)
      )
      .filter((task) => task.subjectConsistencyRequired)
      .map((task) => ({
        queryKey: queryKeys.subjectChecks(task.taskId),
        queryFn: () => apiClient.getSubjectConsistencyChecks(task.taskId),
        retry: false,
        staleTime: 10_000
      }))
  });

  const generationQuery = useQuery({
    queryKey: queryKeys.generation(recoveredTaskId ?? "none"),
    queryFn: () => apiClient.getImageGeneration(recoveredTaskId!),
    enabled: Boolean(recoveredTaskId && sessionReadable),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.workflowStatus ?? query.state.data?.status;
      return status === "queued" || status === "running" ? 3_000 : false;
    }
  });

  const subjectChecksQuery = useQuery({
    queryKey: queryKeys.subjectChecks(recoveredTaskId ?? "none"),
    queryFn: () => apiClient.getSubjectConsistencyChecks(recoveredTaskId!),
    enabled: Boolean(
      recoveredTaskId &&
      generationQuery.data?.outputs?.some(
        (output) => output.generationStatus === "succeeded" && output.subjectConsistencyRequired
      )
    ),
    retry: false,
    refetchInterval: (query) => {
      const checks = query.state.data;
      if (!checks || checks.length === 0) return 3_000;
      return checks.some((check) => check.status === "queued" || check.status === "running")
        ? 3_000
        : false;
    }
  });

  useEffect(() => {
    if (conversationHistory?.session) setConversationSession(conversationHistory.session);
  }, [conversationHistory?.session]);

  useEffect(() => {
    const current = currentConversationQuery.data?.session;
    if (!current || recoveredSessionId || !selectedAgentId) return;
    router.replace(creationUrl({ agentId: selectedAgentId, sessionId: current.id }), {
      scroll: false
    });
  }, [currentConversationQuery.data?.session, recoveredSessionId, router, selectedAgentId]);

  const initialFormDraft = useRef(useImageCreationDraftStore.getState()).current;
  const form = useForm<ImageCreationFormValues>({
    resolver: zodResolver(imageCreationFormSchema),
    defaultValues: {
      modelId: "",
      userText: initialFormDraft.userText,
      imageCount: initialFormDraft.imageCount,
      aspectRatio: initialFormDraft.aspectRatio,
      goal: initialFormDraft.goal,
      style: initialFormDraft.style,
      quality: initialFormDraft.quality,
      outputFormat: initialFormDraft.outputFormat,
      watermark: initialFormDraft.watermarkEnabled
    }
  });

  const selectedModelId = useWatch({ control: form.control, name: "modelId" });
  const imageCount = useWatch({ control: form.control, name: "imageCount" });
  const aspectRatio = useWatch({ control: form.control, name: "aspectRatio" });
  const goal = useWatch({ control: form.control, name: "goal" });
  const style = useWatch({ control: form.control, name: "style" });
  const quality = useWatch({ control: form.control, name: "quality" });
  const outputFormat = useWatch({ control: form.control, name: "outputFormat" });
  const watermark = useWatch({ control: form.control, name: "watermark" });
  const selectedModel = imageModelsQuery.data?.models.find((model) => model.id === selectedModelId);
  const availableRatios = useMemo(
    () =>
      knownRatios.filter(
        (ratio) => !selectedModel || selectedModel.supportedAspectRatios.includes(ratio)
      ),
    [selectedModel]
  );
  const availableImageCounts = imageCounts.filter(
    (count) => !selectedModel || count <= selectedModel.maxImageCount
  );

  useEffect(() => {
    skipDraftPersistRef.current = true;
    const restored = activateDraftScope(draftScope, legacyDraftScopes);
    persistedDraftScopeRef.current = restored.restored ? draftScope : null;
    form.reset({
      ...form.getValues(),
      userText: restored.draft.userText,
      imageCount: restored.draft.imageCount,
      aspectRatio: restored.draft.aspectRatio,
      goal: restored.draft.goal,
      style: restored.draft.style,
      quality: restored.draft.quality,
      outputFormat: restored.draft.outputFormat,
      watermark: restored.draft.watermarkEnabled
    });
  }, [activateDraftScope, draftScope, form, legacyDraftScopes]);

  useEffect(() => {
    const selectedAgent = selectedAgentQuery.data;
    if (
      !selectedAgent ||
      recoveredSessionId ||
      restoredAgentRef.current === selectedAgent.id ||
      (persistedDraftScopeRef.current === draftScope && agentInstruction.trim().length > 0)
    ) {
      return;
    }
    restoredAgentRef.current = selectedAgent.id;
    updateDraft({ agentInstruction: selectedAgent.agentInstruction });
  }, [agentInstruction, draftScope, recoveredSessionId, selectedAgentQuery.data, updateDraft]);

  useEffect(() => {
    const history = conversationHistory;
    if (!history || restoredConversationRef.current === history.session.id) return;
    restoredConversationRef.current = history.session.id;
    if (persistedDraftScopeRef.current === draftScope) return;
    const state = history.latestSnapshot.state;
    const requirement = state.currentRequirement;
    if (requirement) {
      form.setValue("imageCount", Math.min(4, requirement.imageCount));
      if (knownRatios.includes(requirement.aspectRatio as (typeof knownRatios)[number])) {
        form.setValue(
          "aspectRatio",
          requirement.aspectRatio as ImageCreationFormValues["aspectRatio"]
        );
      }
      if (
        requirement.style &&
        ["真实摄影", "清新简约", "高级质感", "创意视觉"].includes(requirement.style)
      ) {
        form.setValue("style", requirement.style as ImageCreationFormValues["style"]);
      }
    }
    const restoredQuality = qualityLabelForRenderSettings(state.renderSettings);
    const restoredFormat = outputFormatLabel(state.deliverySettings.outputFormat);
    form.setValue("quality", restoredQuality);
    form.setValue("outputFormat", restoredFormat);
    form.setValue("watermark", state.deliverySettings.watermark.enabled);
    updateDraft({
      agentInstruction: state.agentInstruction,
      referencePrompt: state.referenceGuidance[0]?.instruction ?? "",
      quality: restoredQuality,
      outputFormat: restoredFormat,
      watermarkEnabled: state.deliverySettings.watermark.enabled,
      watermarkPosition: watermarkPositionLabel(state.deliverySettings.watermark.position)
    });
  }, [conversationHistory, draftScope, form, updateDraft]);

  useEffect(() => {
    if (skipDraftPersistRef.current) {
      skipDraftPersistRef.current = false;
      return;
    }
    updateDraft({
      imageCount,
      aspectRatio,
      goal,
      style,
      quality,
      outputFormat,
      watermarkEnabled: watermark
    });
  }, [aspectRatio, goal, imageCount, outputFormat, quality, style, updateDraft, watermark]);

  useEffect(() => {
    const firstModel = imageModelsQuery.data?.models[0];
    if (!selectedModelId && firstModel) form.setValue("modelId", firstModel.id);
  }, [form, imageModelsQuery.data, selectedModelId]);

  useEffect(() => {
    if (!selectedModel) return;
    const adjustments: string[] = [];
    if (imageCount > selectedModel.maxImageCount) {
      const nextImageCount = Math.min(4, selectedModel.maxImageCount);
      form.setValue("imageCount", nextImageCount, { shouldDirty: true });
      adjustments.push(`当前模型最多生成 ${nextImageCount} 张，生成数量已自动调整`);
    }
    if (!selectedModel.supportedAspectRatios.includes(aspectRatio)) {
      const fallback = availableRatios[0];
      if (fallback) {
        form.setValue("aspectRatio", fallback, { shouldDirty: true });
        adjustments.push(`当前模型不支持 ${aspectRatio}，图片比例已调整为 ${fallback}`);
      }
    }
    if (adjustments.length > 0) setImageInputNotice(adjustments.join("；"));
  }, [aspectRatio, availableRatios, form, imageCount, selectedModel]);

  const ensureConversation = async (projectId: string, title: string) => {
    if (!selectedAgentId) throw new Error("请先选择一个 Agent 再开始创作");
    const active = conversationSession ?? conversationHistory?.session;
    if (active) return active;
    if (recoveredSessionId) {
      const history = await apiClient.getConversation(recoveredSessionId, selectedAgentId);
      setConversationSession(history.session);
      return history.session;
    }
    const created = await apiClient.ensureCurrentConversation({
      projectId,
      agentId: selectedAgentId,
      title: title.slice(0, 40) || "新建生图会话"
    });
    setConversationSession(created);
    queryClient.setQueryData<CurrentConversationResponse>(
      queryKeys.currentConversation(selectedAgentId),
      { session: created }
    );
    return created;
  };

  const sendConversationTurn = async (input: {
    session: ConversationSession;
    formValues: ImageCreationFormValues;
    text: string;
    productAssetIds?: string[];
    referenceAssetIds?: string[];
    watermarkAssetId?: string;
    promptOptimizationId?: string;
    attachments?: Array<{
      assetId: string;
      role: "product_source" | "user_reference" | "edit_base";
      relation: string | null;
    }>;
  }) => {
    const effectiveWatermarkAssetId =
      input.watermarkAssetId ??
      conversationHistory?.latestSnapshot.state.deliverySettings.watermark.assetId ??
      null;
    const payloadSignature = JSON.stringify({
      version: input.session.version,
      text: input.text,
      modelId: input.formValues.modelId,
      imageCount: input.formValues.imageCount,
      aspectRatio: input.formValues.aspectRatio,
      style: input.formValues.style,
      quality: input.formValues.quality,
      outputFormat: input.formValues.outputFormat,
      watermark: input.formValues.watermark,
      watermarkPosition,
      agentInstruction,
      referencePrompt,
      editBaseAssetId: editBaseImage?.assetId ?? null,
      productAssetIds: input.productAssetIds ?? [],
      referenceAssetIds: input.referenceAssetIds ?? [],
      promptOptimizationId: input.promptOptimizationId ?? null,
      watermarkAssetId: effectiveWatermarkAssetId,
      clearProductImage: productCleared,
      clearReferenceImages: referenceCleared
    });
    const idempotency = getConversationIdempotency(input.session.id, payloadSignature);
    if (!selectedAgentId) throw new Error("请先选择一个 Agent 再发送消息");
    const response = await apiClient.sendConversationMessage(input.session.id, selectedAgentId, {
      expectedVersion: input.session.version,
      idempotencyKey: idempotency.key,
      ...(input.promptOptimizationId ? { promptOptimizationId: input.promptOptimizationId } : {}),
      modelId: input.formValues.modelId,
      text: input.text,
      imageSettings: {
        imageCount: input.formValues.imageCount,
        aspectRatio: input.formValues.aspectRatio,
        generationGoal: input.formValues.goal,
        visualStyle: input.formValues.style
      },
      renderSettings: renderSettingsForQuality(input.formValues.quality),
      deliverySettings: {
        outputFormat: outputFormatValue(input.formValues.outputFormat),
        watermark: {
          enabled: input.formValues.watermark,
          assetId: input.formValues.watermark ? effectiveWatermarkAssetId : null,
          position: watermarkPositionValue(watermarkPosition)
        }
      },
      agentInstruction,
      clearProductImage: productCleared,
      clearReferenceImages: referenceCleared,
      attachments: input.attachments ?? [
        ...(editBaseImage?.assetId
          ? [
              {
                assetId: editBaseImage.assetId,
                role: "edit_base" as const,
                relation: "用户选择重新编辑的生成结果"
              }
            ]
          : []),
        ...(input.productAssetIds ?? []).map((assetId, index, assetIds) => ({
          assetId,
          role: "product_source" as const,
          relation: `当前商品主体原图 ${index + 1}/${assetIds.length}`
        })),
        ...(input.referenceAssetIds ?? []).map((assetId) => ({
          assetId,
          role: "user_reference" as const,
          relation: referencePrompt.trim() || "仅参考该图的场景、构图或视觉风格，不作为商品主体事实"
        }))
      ]
    });
    clearConversationIdempotency(input.session.id, idempotency.key);
    setConversationSession(response.session);
    return response;
  };

  const resolveMutation = useMutation({
    mutationFn: async (formValues: ImageCreationFormValues) => {
      const project = activeProjectQuery.data;
      if (!project) throw new Error("创作项目尚未准备完成");

      const localProductAssetIds = await resolveImageAssetIds({
        images: productImages,
        upload: (file) => apiClient.uploadImage(project.id, file),
        onUploaded: markProductImageUploaded
      });

      const snapshot = conversationHistory?.latestSnapshot.state;
      const localReferenceAssetIds = await resolveImageAssetIds({
        images: referenceImages,
        upload: (file) => apiClient.uploadImage(project.id, file),
        onUploaded: markReferenceImageUploaded
      });
      if (localProductAssetIds.length > 4) {
        throw new Error("每轮最多上传 4 张商品主体图");
      }
      if (localReferenceAssetIds.length > 1) {
        throw new Error("每轮最多上传 1 张参考图");
      }

      let watermarkAssetId =
        watermarkLogo?.assetId ?? snapshot?.deliverySettings.watermark.assetId ?? null;
      if (formValues.watermark && watermarkLogo && !watermarkAssetId) {
        const [resolvedWatermarkAssetId] = await resolveImageAssetIds({
          images: [watermarkLogo],
          upload: (file) => apiClient.uploadImage(project.id, file),
          onUploaded: markWatermarkLogoUploaded
        });
        watermarkAssetId = resolvedWatermarkAssetId ?? null;
      }
      if (formValues.watermark && !watermarkAssetId) {
        throw new Error("开启水印后请先上传水印 Logo");
      }

      const text = formValues.userText.trim();
      const session = await ensureConversation(project.id, text);
      const effectiveReferenceAssetIds = [...restoredReferenceAssetIds, ...localReferenceAssetIds];
      const submissionContextSignature = createPromptOptimizationContextSignature({
        agentInstruction,
        sessionVersion: session.version,
        modelId: formValues.modelId,
        imageCount: formValues.imageCount,
        aspectRatio: formValues.aspectRatio,
        goal: formValues.goal,
        style: formValues.style,
        editBaseAssetId: editBaseImage?.assetId ?? null,
        productAssetIds: localProductAssetIds,
        referenceAssetIds: effectiveReferenceAssetIds,
        referencePrompt
      });
      const adoptedOptimizationId =
        promptOptimization &&
        promptOptimization.record.status === "succeeded" &&
        promptOptimization.record.optimizedText === text &&
        promptOptimization.contextSignature === submissionContextSignature
          ? promptOptimization.record.id
          : undefined;
      const adoptedOptimization = adoptedOptimizationId ? promptOptimization : null;
      const optimizationAttachments = adoptedOptimization
        ? selectedPromptOptimizationAttachments(adoptedOptimization.record)
        : undefined;
      return sendConversationTurn({
        session,
        formValues,
        text,
        ...(localProductAssetIds.length > 0 ? { productAssetIds: localProductAssetIds } : {}),
        ...(effectiveReferenceAssetIds.length > 0
          ? { referenceAssetIds: effectiveReferenceAssetIds }
          : {}),
        ...(watermarkAssetId ? { watermarkAssetId } : {}),
        ...(adoptedOptimizationId ? { promptOptimizationId: adoptedOptimizationId } : {}),
        ...(optimizationAttachments ? { attachments: optimizationAttachments } : {})
      });
    },
    onSuccess: (response) => {
      queryClient.setQueryData<ConversationHistoryResponse>(
        queryKeys.conversation(response.session.id, selectedAgentId ?? "none"),
        (history) => mergeAcceptedConversationTurn(history, response)
      );
      if (selectedAgentId) {
        queryClient.setQueryData<CurrentConversationResponse>(
          queryKeys.currentConversation(selectedAgentId),
          { session: response.session }
        );
      }
      setPendingTurn(null);
      setRunError(null);
      form.setValue("userText", "");
      setPromptOptimization(null);
      clearSentProductImages();
      clearSentEditBaseImage();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(response.session.id, selectedAgentId ?? "none")
      });
      router.replace(
        creationUrl({
          agentId: selectedAgentId,
          sessionId: response.session.id
        }),
        { scroll: false }
      );
    },
    onError: (error) => {
      setPendingTurn(null);
      setRunError(presentUserError(error));
    }
  });

  const generationMutation = useMutation({
    mutationFn: (input: { requirementRunId: string; newAttempt: boolean }) => {
      const storageKey = `image-generation-idempotency:${input.requirementRunId}`;
      if (input.newAttempt) sessionStorage.removeItem(storageKey);
      let idempotencyKey = sessionStorage.getItem(storageKey);
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        sessionStorage.setItem(storageKey, idempotencyKey);
      }
      return apiClient.createImageGeneration({
        requirementRunId: input.requirementRunId,
        idempotencyKey
      });
    },
    onSuccess: (response, input) => {
      setRunError(null);
      router.replace(
        creationUrl({
          agentId: selectedAgentId,
          sessionId: conversationSession?.id ?? recoveredSessionId,
          requirementRunId: input.requirementRunId,
          taskId: response.taskId
        }),
        { scroll: false }
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.generation(response.taskId) });
      const sessionId = conversationSession?.id ?? recoveredSessionId;
      if (sessionId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.sessionGenerationsRoot(sessionId)
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.activeSessionGeneration(sessionId)
        });
      }
    },
    onError: (error) => setRunError(presentUserError(error))
  });

  const regenerationMutation = useMutation({
    mutationFn: (input: RegenerationSubmissionIdentity) =>
      apiClient.regenerateImageGenerationOutput(input.taskId, input.unitId, {
        idempotencyKey: regenerationSubmissions.getOrCreate(input),
        sourceAssetId: input.sourceAssetId
      }),
    onSuccess: (response, input) => {
      regenerationSubmissions.clear(input);
      setRunError(null);
      router.replace(
        creationUrl({
          agentId: selectedAgentId,
          sessionId: conversationSession?.id ?? recoveredSessionId,
          requirementRunId: response.requirementRunId,
          taskId: response.taskId
        }),
        { scroll: false }
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.generation(response.taskId) });
      const sessionId = conversationSession?.id ?? recoveredSessionId;
      if (sessionId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.sessionGenerationsRoot(sessionId)
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.activeSessionGeneration(sessionId)
        });
      }
    },
    onError: (error, input) => {
      if (!shouldRetainRegenerationSubmission(error)) regenerationSubmissions.clear(input);
      setRunError(presentUserError(error));
    }
  });

  const retryConversationMutation = useMutation({
    mutationFn: (input: { sessionId: string; messageId: string }) => {
      if (!selectedAgentId) throw new Error("请先选择一个 Agent 再重试");
      return apiClient.retryConversationMessage(input.sessionId, input.messageId, selectedAgentId);
    },
    onSuccess: (response) => {
      setConversationSession(response.session);
      setRunError(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(response.session.id, selectedAgentId ?? "none")
      });
    },
    onError: (error) => setRunError(presentUserError(error))
  });

  const cancelGenerationMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.cancelImageGeneration(taskId),
    onSuccess: (response) => {
      setRunError(null);
      setImageInputNotice(
        response.providerCancellationStatus === "not_supported"
          ? "本地任务已停止，后续返回结果不会入库；当前供应商不支持确认远端任务是否停止。"
          : "任务已停止。"
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.generation(response.taskId) });
      if (recoveredSessionId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.sessionGenerationsRoot(recoveredSessionId)
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.activeSessionGeneration(recoveredSessionId)
        });
      }
    },
    onError: (error) => setRunError(presentUserError(error))
  });

  const completedConversationRequirement = conversationHistory
    ? recoverLatestCompletedTurnRequirement({
        sessionVersion: conversationHistory.session.version,
        processingMessageId: conversationHistory.session.processingMessageId,
        messages: conversationHistory.messages,
        latestRequirementRun: conversationHistory.latestRequirementRun
      })
    : null;
  const activeRequirementResponse = pendingTurn
    ? null
    : recoveredRequirementRunId
      ? (recoveredRequirementQuery.data ?? null)
      : completedConversationRequirement;
  const queriedGenerationTask =
    !pendingTurn &&
    generationQuery.data?.requirementRunId === activeRequirementResponse?.requirementRunId
      ? generationQuery.data
      : undefined;
  const matchingRequirementTask = activeRequirementResponse
    ? sessionGenerationTasks.find(
        (task) => task.requirementRunId === activeRequirementResponse.requirementRunId
      )
    : undefined;
  const subjectChecks = subjectChecksQuery.data;
  const conversationIsProcessing = Boolean(
    resolveMutation.isPending ||
    retryConversationMutation.isPending ||
    conversationHistory?.session.processingMessageId
  );
  const generationView = resolveGenerationViewModel({
    activeQuerySucceeded: activeSessionGenerationQuery.isSuccess,
    activeTask: activeSessionGenerationQuery.data?.task,
    historicalTasks: sessionGenerationTasks,
    queriedTask: queriedGenerationTask,
    matchingRequirementTask,
    resolving: conversationIsProcessing,
    creatingTask: generationMutation.isPending,
    checks: subjectChecks
  });
  const activeGenerationTask = generationView.displayTask;
  const activeTaskTurnNumber = findGenerationTurnNumber(
    conversationHistory,
    activeGenerationTask?.requirementRunId
  );
  useEffect(() => {
    if (
      !activeRequirementResponse ||
      activeRequirementResponse.result.status !== "ready" ||
      activeGenerationTask ||
      recoveredTaskId ||
      generationMutation.isPending ||
      !sessionGenerationsReady ||
      !generationServiceReady ||
      automaticGenerationRef.current === activeRequirementResponse.requirementRunId
    ) {
      return;
    }
    automaticGenerationRef.current = activeRequirementResponse.requirementRunId;
    generationMutation.mutate({
      requirementRunId: activeRequirementResponse.requirementRunId,
      newAttempt: false
    });
  }, [
    activeGenerationTask,
    activeRequirementResponse,
    generationMutation,
    generationServiceReady,
    recoveredTaskId,
    sessionGenerationsReady
  ]);

  const generationStatus = generationQuery.data?.workflowStatus ?? generationQuery.data?.status;
  useEffect(() => {
    if (!recoveredTaskId || (generationStatus !== "queued" && generationStatus !== "running")) {
      return;
    }
    return openGenerationEventStream(
      apiClient.imageGenerationEventsUrl(recoveredTaskId),
      () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.generation(recoveredTaskId) });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.subjectChecks(recoveredTaskId)
        });
        if (recoveredSessionId) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.sessionGenerationsRoot(recoveredSessionId)
          });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.activeSessionGeneration(recoveredSessionId)
          });
        }
      },
      () => undefined
    );
  }, [generationStatus, queryClient, recoveredTaskId]);

  const subjectChecksActive = Boolean(
    recoveredTaskId &&
    (generationStatus === "running" ||
      generationStatus === "succeeded" ||
      generationStatus === "partially_succeeded") &&
    generationQuery.data?.subjectConsistencyRequired &&
    (!subjectChecks ||
      subjectChecks.length === 0 ||
      subjectChecks.some((check) => check.status === "queued" || check.status === "running"))
  );
  useEffect(() => {
    if (!recoveredTaskId || !subjectChecksActive) return;
    return openSubjectConsistencyEventStream(
      apiClient.subjectConsistencyEventsUrl(recoveredTaskId),
      () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.subjectChecks(recoveredTaskId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.generation(recoveredTaskId) });
      },
      () => undefined
    );
  }, [queryClient, recoveredTaskId, subjectChecksActive]);

  const stage = generationView.stage;
  const deliverableAssets = getDeliverableAssets(activeGenerationTask, subjectChecks);
  const verifiedHistoricalAssetIds = new Set([
    ...sessionGenerationTasks.flatMap((task) =>
      ["succeeded", "partially_succeeded"].includes(task.workflowStatus ?? task.status) &&
      !task.subjectConsistencyRequired
        ? task.resultAssets.map((asset) => asset.id)
        : []
    ),
    ...historicalSubjectQueries.flatMap((query) =>
      (query.data ?? []).flatMap((check) =>
        check.status === "completed" && check.verdict === "passed"
          ? [(check.deliverableAsset ?? check.latestGeneratedAsset ?? check.generatedAsset).id]
          : []
      )
    )
  ]);
  const historicalGenerationResults = indexHistoricalGenerationResults(sessionGenerationTasks);
  const failedConversationMessage = [...(conversationHistory?.messages ?? [])]
    .reverse()
    .find(
      (message) =>
        message.role === "user" &&
        message.status === "failed" &&
        message.turnNumber === (conversationHistory?.session.version ?? -1) + 1
    );
  const conversationTurnError = failedConversationMessage
    ? presentUserErrorCode(failedConversationMessage.errorCode ?? "CONVERSATION_TURN_FAILED")
    : null;
  const workflowError =
    runError ?? conversationTurnError ?? deriveWorkflowError(activeGenerationTask, subjectChecks);
  const generationProcessing = generationView.generationProcessing;
  const submitAvailability = deriveSubmitAvailability({
    agentBindingRequired: false,
    conversationProcessing: conversationIsProcessing,
    generationProcessing,
    cancellationPending: cancelGenerationMutation.isPending,
    readinessLoading: readinessQuery.isPending,
    generationServiceReady,
    projectLoading: activeProjectQuery.isPending,
    projectReady: Boolean(activeProjectQuery.data),
    modelsLoading: imageModelsQuery.isPending,
    hasModels: Boolean(imageModelsQuery.data?.models.length),
    hasInput: true
  });
  const busy = submitAvailability.busy;
  const hasConversation = Boolean(
    recoveredSessionId || conversationSession || pendingTurn || conversationHistory?.messages.length
  );
  const pageError =
    uploadError ||
    form.formState.errors.userText?.message ||
    form.formState.errors.modelId?.message ||
    queryError(activeProjectQuery.error) ||
    queryError(imageModelsQuery.error) ||
    queryError(currentConversationQuery.error) ||
    queryError(conversationQuery.error) ||
    queryError(olderMessagesMutation.error) ||
    queryError(recoveredRequirementQuery.error) ||
    queryError(generationQuery.error) ||
    queryError(subjectChecksQuery.error);

  useLayoutEffect(() => {
    const restore = historyScrollRestoreRef.current;
    if (!restore || !loadedConversationHistory) return;
    const heightDelta = document.documentElement.scrollHeight - restore.height;
    window.scrollTo({ top: restore.top + heightDelta, behavior: "auto" });
    historyScrollRestoreRef.current = null;
  }, [loadedConversationHistory?.messages.length]);

  useLayoutEffect(() => {
    const sessionId = conversationHistory?.session.id;
    if (!hasConversation || !sessionId || !conversationHistory.messages.length) return;
    if (positionedHistorySessionRef.current === sessionId) return;
    shouldFollowLatestRef.current = true;
    threadEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    const frame = window.requestAnimationFrame(() => {
      positionedHistorySessionRef.current = sessionId;
      threadEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      setHistoryPagingArmedSessionId(sessionId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversationHistory, hasConversation]);

  useEffect(() => {
    const updateFollowState = () => {
      const distanceFromBottom =
        document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      shouldFollowLatestRef.current = distanceFromBottom <= 160;
    };
    window.addEventListener("scroll", updateFollowState, { passive: true });
    return () => window.removeEventListener("scroll", updateFollowState);
  }, []);

  useEffect(() => {
    const target = historyTopRef.current;
    const sessionId = conversationHistory?.session.id;
    if (
      !target ||
      !sessionId ||
      historyPagingArmedSessionId !== sessionId ||
      !conversationHistory.messagePage.hasMore
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadOlderMessages();
      },
      { root: null, rootMargin: "160px 0px 0px", threshold: 0 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    conversationHistory?.messagePage.hasMore,
    conversationHistory?.messagePage.nextBeforeTurn,
    conversationHistory?.session.id,
    historyPagingArmedSessionId,
    olderMessagesMutation.isPending,
    recoveredSessionId,
    selectedAgentId
  ]);

  useEffect(() => {
    const sessionId = conversationHistory?.session.id;
    if (
      !sessionId ||
      historyPagingArmedSessionId !== sessionId ||
      !conversationHistory.messagePage.hasMore
    ) {
      return;
    }
    const loadWhenNearTop = () => {
      if (window.scrollY <= 160) loadOlderMessages();
    };
    window.addEventListener("scroll", loadWhenNearTop, { passive: true });
    loadWhenNearTop();
    return () => window.removeEventListener("scroll", loadWhenNearTop);
  }, [
    conversationHistory?.messagePage.hasMore,
    conversationHistory?.messagePage.nextBeforeTurn,
    conversationHistory?.session.id,
    historyPagingArmedSessionId,
    recoveredSessionId,
    selectedAgentId
  ]);

  useEffect(() => {
    if (!hasConversation || !shouldFollowLatestRef.current) return;
    if (historyScrollRestoreRef.current) return;
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [deliverableAssets.length, hasConversation, stage, subjectChecks?.length]);

  const acceptImageFiles = (
    files: ArrayLike<File> | null | undefined,
    input: {
      source: LocalImageInputSource;
      target: LocalImageTarget;
      setter: (image: LocalImageDraft | null) => void;
    }
  ) => {
    const candidates = files ? Array.from(files) : [];
    if (candidates.length === 0) return false;

    setUploadError("");
    setImageInputNotice("");
    try {
      const draft = createLocalImageDraft(candidates[0]!, {
        source: input.source,
        target: input.target
      });
      input.setter(draft);
      const targetName = {
        product: "商品主体图",
        reference: "参考图",
        watermark: "水印 Logo"
      }[input.target];
      setImageInputNotice(
        candidates.length > 1
          ? `检测到多张图片，普通模式仅使用第一张${targetName}`
          : input.source === "clipboard"
            ? `已从剪贴板添加${targetName}`
            : `已添加${targetName}`
      );
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "图片读取失败，请重新选择");
    }

    return true;
  };

  const acceptProductFiles = (
    files: ArrayLike<File> | null | undefined,
    source: LocalImageInputSource
  ) => {
    const candidates = files ? Array.from(files) : [];
    if (candidates.length === 0) return false;
    const available = Math.max(0, 4 - productImages.length);
    if (available === 0) {
      setUploadError("每轮最多上传 4 张商品主体图");
      return true;
    }

    setUploadError("");
    setImageInputNotice("");
    setRunError(null);
    try {
      const drafts = candidates
        .slice(0, available)
        .map((file) => createLocalImageDraft(file, { source, target: "product" }));
      addProductImages(drafts);
      const ignored = candidates.length - drafts.length;
      setImageInputNotice(
        `${source === "clipboard" ? "已从剪贴板添加" : "已添加"}${drafts.length}张商品主体图${ignored > 0 ? `，另有${ignored}张超过上限未添加` : ""}`
      );
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "图片读取失败，请重新选择");
    }
    return true;
  };

  const acceptProductClipboard = (event: ClipboardEvent<HTMLElement>) => {
    const files = extractClipboardImageFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    acceptProductFiles(files, "clipboard");
  };

  const acceptReferenceFiles = (
    files: ArrayLike<File> | null | undefined,
    source: LocalImageInputSource
  ) => {
    const candidates = files ? Array.from(files) : [];
    if (candidates.length === 0) return false;
    const restoredIds = (conversationHistory?.latestSnapshot.state.referenceAssetIds ?? []).filter(
      (assetId) => !excludedReferenceAssetIds.includes(assetId)
    );
    const available = Math.max(0, 1 - restoredIds.length - referenceImages.length);
    if (available === 0) {
      setUploadError("普通模式最多保留 1 张参考图，请先移除当前参考图");
      return true;
    }
    setUploadError("");
    setImageInputNotice("");
    try {
      const drafts = candidates
        .slice(0, available)
        .map((file) => createLocalImageDraft(file, { source, target: "reference" }));
      addReferenceImages(drafts);
      const ignored = candidates.length - drafts.length;
      setImageInputNotice(
        `${source === "clipboard" ? "已从剪贴板添加" : "已添加"}${drafts.length}张参考图${ignored > 0 ? `，另有${ignored}张超过上限未添加` : ""}`
      );
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "图片读取失败，请重新选择");
    }
    return true;
  };

  const setNormalModeValue = (field: NormalModeSettingField, value: string | number | boolean) => {
    switch (field) {
      case "goal":
        form.setValue("goal", value as ImageCreationFormValues["goal"], { shouldDirty: true });
        break;
      case "imageCount":
        form.setValue("imageCount", value as ImageCreationFormValues["imageCount"], {
          shouldDirty: true
        });
        break;
      case "aspectRatio":
        form.setValue("aspectRatio", value as ImageCreationFormValues["aspectRatio"], {
          shouldDirty: true
        });
        break;
      case "style":
        form.setValue("style", value as ImageCreationFormValues["style"], { shouldDirty: true });
        break;
      case "quality":
        form.setValue("quality", value as ImageCreationFormValues["quality"], {
          shouldDirty: true
        });
        break;
      case "outputFormat":
        form.setValue("outputFormat", value as ImageCreationFormValues["outputFormat"], {
          shouldDirty: true
        });
        break;
      case "watermark":
        form.setValue("watermark", Boolean(value), { shouldDirty: true });
        break;
      case "watermarkPosition":
        if (isWatermarkPositionLabel(value)) updateDraft({ watermarkPosition: value });
        break;
    }
  };

  const onSubmit = form.handleSubmit((formValues) => {
    if (busy || resolveMutation.isPending) return;
    if (!generationServiceReady) {
      setRunError(presentUserErrorCode("IMAGE_GENERATION_QUEUE_UNAVAILABLE"));
      return;
    }
    if (
      !hasComposerInput({
        text: formValues.userText,
        productImageCount: productImages.length,
        referenceImageCount: referenceImages.length,
        editBaseImageCount: editBaseImage ? 1 : 0
      })
    ) {
      setUploadError("请输入内容或上传图片后再发送");
      return;
    }
    const existingWatermarkAssetId =
      watermarkLogo?.assetId ??
      conversationHistory?.latestSnapshot.state.deliverySettings.watermark.assetId ??
      null;
    if (formValues.watermark && !watermarkLogo && !existingWatermarkAssetId) {
      setUploadError("开启水印后请先上传水印 Logo");
      return;
    }
    setUploadError("");
    setRunError(null);
    setPendingTurn({
      text: formValues.userText.trim(),
      createdAt: new Date().toISOString(),
      previewUrls: [
        ...(editBaseImage ? [editBaseImage.previewUrl] : []),
        ...productImages.map((image) => image.previewUrl)
      ]
    });
    automaticGenerationRef.current = null;
    resolveMutation.mutate(formValues);
  });

  const retryCurrentRun = () => {
    setRunError(null);
    if (!generationServiceReady) {
      setRunError(presentUserErrorCode("IMAGE_GENERATION_QUEUE_UNAVAILABLE"));
      return;
    }
    if (failedConversationMessage && recoveredSessionId) {
      retryConversationMutation.mutate({
        sessionId: recoveredSessionId,
        messageId: failedConversationMessage.id
      });
      return;
    }
    if (activeRequirementResponse?.result.status === "ready") {
      automaticGenerationRef.current = activeRequirementResponse.requirementRunId;
      generationMutation.mutate({
        requirementRunId: activeRequirementResponse.requirementRunId,
        newAttempt: true
      });
      return;
    }
    if (
      hasComposerInput({
        text: form.getValues("userText"),
        productImageCount: productImages.length,
        referenceImageCount: referenceImages.length,
        editBaseImageCount: editBaseImage ? 1 : 0
      })
    ) {
      void onSubmit();
    }
  };

  const restoredReferenceAssetIds = referenceCleared
    ? []
    : (conversationHistory?.latestSnapshot.state.referenceAssetIds ?? []).filter(
        (assetId) =>
          !excludedReferenceAssetIds.includes(assetId) &&
          !referenceImages.some((image) => image.assetId === assetId)
      );
  const referencePreviews = [
    ...restoredReferenceAssetIds.map((assetId) => ({
      key: assetId,
      url: apiClient.mediaContentUrl(assetId),
      kind: "restored" as const,
      assetId
    })),
    ...referenceImages.map((image, index) => ({
      key: image.clientId,
      url: image.previewUrl,
      kind: "draft" as const,
      index,
      assetId: image.assetId
    }))
  ];
  const restoredWatermarkAssetId =
    watermarkLogo?.assetId ??
    conversationHistory?.latestSnapshot.state.deliverySettings.watermark.assetId ??
    null;
  const watermarkLogoPreviewUrl =
    watermarkLogo?.previewUrl ??
    (restoredWatermarkAssetId ? apiClient.mediaContentUrl(restoredWatermarkAssetId) : null);
  const currentOptimizationContextSignature = createPromptOptimizationContextSignature({
    agentInstruction,
    sessionVersion: activeConversationSession?.version ?? 0,
    modelId: selectedModelId,
    imageCount,
    aspectRatio,
    goal,
    style,
    editBaseAssetId: editBaseImage?.assetId ?? null,
    productAssetIds: productImages.map((image) => image.assetId ?? `local:${image.clientId}`),
    referenceAssetIds: referencePreviews.map((preview) =>
      preview.kind === "restored"
        ? preview.assetId
        : (preview.assetId ?? `local:${referenceImages[preview.index]!.clientId}`)
    ),
    referencePrompt
  });

  useEffect(() => {
    const record = promptOptimizationQuery.data;
    if (
      record?.status === "succeeded" &&
      record.optimizedText &&
      record.id === promptOptimization?.record.id &&
      promptOptimization.contextSignature === currentOptimizationContextSignature &&
      form.getValues("userText").trim() === record.originalText
    ) {
      form.setValue("userText", record.optimizedText, { shouldDirty: true });
    }
  }, [currentOptimizationContextSignature, form, promptOptimization, promptOptimizationQuery.data]);
  const runPromptOptimization = async (input: {
    operation: "optimize" | "alternative" | "revise";
    revisionInstruction?: string;
  }) => {
    if (promptOptimizationPending) return;
    const formValues = form.getValues();
    const text = formValues.userText.trim();
    if (!text) {
      setUploadError("请输入文字后再优化提示词");
      return;
    }
    if (input.operation !== "optimize" && !promptOptimization) return;
    const project = activeProjectQuery.data;
    if (!project) {
      setUploadError("当前创作项目尚未就绪，请稍后重试");
      return;
    }
    setUploadError("");
    setPromptOptimizationPending(true);
    setPromptOptimization((current) => (current ? { ...current, error: null } : null));
    try {
      const productAssetIds = await resolveImageAssetIds({
        images: productImages,
        upload: (file) => apiClient.uploadImage(project.id, file),
        onUploaded: markProductImageUploaded
      });
      const referenceAssetIds = await resolveImageAssetIds({
        images: referenceImages,
        upload: (file) => apiClient.uploadImage(project.id, file),
        onUploaded: markReferenceImageUploaded
      });
      const session = await ensureConversation(project.id, text);
      const operationText = text;
      const contextSignature = createPromptOptimizationContextSignature({
        agentInstruction,
        sessionVersion: session.version,
        modelId: formValues.modelId,
        imageCount: formValues.imageCount,
        aspectRatio: formValues.aspectRatio,
        goal: formValues.goal,
        style: formValues.style,
        editBaseAssetId: editBaseImage?.assetId ?? null,
        productAssetIds,
        referenceAssetIds: [...restoredReferenceAssetIds, ...referenceAssetIds],
        referencePrompt
      });
      const attachments = [
        ...(editBaseImage?.assetId
          ? [
              {
                assetId: editBaseImage.assetId,
                role: "edit_base" as const,
                relation: "用户选择重新编辑的生成结果"
              }
            ]
          : []),
        ...productAssetIds.map((assetId, index, assetIds) => ({
          assetId,
          role: "product_source" as const,
          relation: `当前商品主体原图 ${index + 1}/${assetIds.length}`
        })),
        ...[...restoredReferenceAssetIds, ...referenceAssetIds].map((assetId) => ({
          assetId,
          role: "user_reference" as const,
          relation: referencePrompt.trim() || "仅参考该图的场景、构图或视觉风格"
        }))
      ];
      const record = await apiClient.createPromptOptimization(session.id, {
        idempotencyKey: crypto.randomUUID(),
        operation: input.operation,
        text: operationText,
        attachments,
        imageSettings: {
          imageCount: formValues.imageCount,
          aspectRatio: formValues.aspectRatio,
          generationGoal: formValues.goal,
          visualStyle: formValues.style
        },
        modelId: formValues.modelId,
        agentInstruction,
        parentOptimizationId: input.operation === "optimize" ? null : promptOptimization!.record.id,
        revisionInstruction: input.operation === "revise" ? input.revisionInstruction! : null
      });
      const previousState = promptOptimization;
      const nextHistory = previousState
        ? [
            ...previousState.history,
            {
              text,
              record: previousState.record,
              contextSignature: previousState.contextSignature
            }
          ]
        : [{ text, record: null, contextSignature: null }];
      setPromptOptimization({
        record,
        contextSignature,
        history: nextHistory,
        error: null
      });
      if (record.status === "processing") setPromptOptimizationPending(false);
    } catch (error) {
      setPromptOptimization((current) =>
        current
          ? {
              ...current,
              error: presentUserError(error).message
            }
          : null
      );
      if (!promptOptimization) setUploadError(presentUserError(error).message);
    } finally {
      setPromptOptimizationPending(false);
    }
  };
  const normalModeProfile = selectedAgentQuery.data
    ? {
        name: selectedAgentQuery.data.name,
        description:
          selectedAgentQuery.data.description ||
          "输入自然语言需求或上传商品图片，Agent 会结合当前配置完成创作。"
      }
    : normalModeProfileForGoal(goal);

  const applyEditResult = (target: EditResultTarget) => {
    const draft: ExistingAssetDraft = {
      clientId: `edit-base-${target.asset.id}`,
      kind: "asset",
      assetId: target.asset.id,
      name: target.name,
      byteSize: target.asset.byteSize,
      previewUrl: apiClient.mediaContentUrl(target.asset.id)
    };
    replaceWithEditBase(draft);
    form.setValue("userText", "", { shouldDirty: false });
    form.clearErrors("userText");
    updateDraft({ userText: "", referencePrompt: "" });
    setEditResultTarget(null);
    setRunError(null);
    setUploadError("");
    setImageInputNotice(`已将「${target.name}」设为编辑底图，请描述需要修改的内容`);
    requestAnimationFrame(() =>
      threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    );
  };

  const requestEditResult = (target: EditResultTarget) => {
    const hasUnsentDraft = Boolean(
      form.getValues("userText").trim() ||
      referencePrompt.trim() ||
      productImages.length > 0 ||
      referenceImages.length > 0 ||
      editBaseImage
    );
    if (hasUnsentDraft) {
      setEditResultTarget(target);
      return;
    }
    applyEditResult(target);
  };

  return (
    <div className={normalModeStyles.page}>
      <form className={normalModeStyles.layout} onSubmit={onSubmit} noValidate>
        <section className={normalModeStyles.workspace}>
          <button
            className={normalModeStyles.backButton}
            type="button"
            aria-label="返回智能创作"
            onClick={() => router.push("/create")}
          >
            <ArrowLeft />
          </button>
          <div className={normalModeStyles.stage} data-has-thread={hasConversation || undefined}>
            {!hasConversation && (
              <NormalModeEmptyState
                agentName={normalModeProfile.name}
                description={normalModeProfile.description}
              />
            )}

            {hasConversation && (
              <div className={normalModeStyles.threadHost}>
                <div
                  ref={historyTopRef}
                  className={normalModeStyles.historyLoader}
                  aria-live="polite"
                >
                  {olderMessagesMutation.isPending ? (
                    <span>
                      <LoaderCircle className="spin" />
                      正在加载更早记录
                    </span>
                  ) : conversationHistory?.messagePage.hasMore ? (
                    <button type="button" onClick={loadOlderMessages}>
                      {olderMessagesMutation.isError ? <RefreshCw /> : null}
                      {olderMessagesMutation.isError ? "重新加载" : "加载更早记录"}
                    </button>
                  ) : loadedConversationHistory?.olderPageLoaded ? (
                    <span>已加载全部记录</span>
                  ) : null}
                </div>
                <ConversationThread
                  agentName={normalModeProfile.name}
                  messages={conversationHistory?.messages ?? []}
                  pendingTurn={pendingTurn}
                  activeTaskId={activeGenerationTask?.taskId ?? null}
                  activeTurnNumber={activeTaskTurnNumber}
                  verifiedAssetIds={verifiedHistoricalAssetIds}
                  historicalGenerationResults={historicalGenerationResults}
                  stage={stage}
                  deliverableAssets={deliverableAssets}
                  task={activeGenerationTask}
                  unitFailures={activeGenerationTask?.unitFailures ?? []}
                  error={workflowError}
                  errorOccurredAt={
                    activeGenerationTask?.updatedAt ??
                    failedConversationMessage?.createdAt ??
                    conversationSession?.updatedAt ??
                    null
                  }
                  onRetry={retryCurrentRun}
                  onCancel={() => {
                    if (activeGenerationTask) {
                      cancelGenerationMutation.mutate(activeGenerationTask.taskId);
                    }
                  }}
                  onReplaceImage={() => fileInputRef.current?.click()}
                  onEditRequirement={() =>
                    threadEndRef.current?.scrollIntoView({ behavior: "smooth" })
                  }
                  onEditResult={requestEditResult}
                  onRegenerateResult={(taskId, unitId, sourceAssetId) =>
                    regenerationMutation.mutate({
                      taskId,
                      unitId,
                      sourceAssetId
                    })
                  }
                  regeneratingUnitId={
                    regenerationMutation.isPending ? regenerationMutation.variables.unitId : null
                  }
                  onPreviewImage={setPreviewImage}
                />
              </div>
            )}
          </div>

          <div className={normalModeStyles.composerStack}>
            <WorkbenchComposer
              control={form.control}
              register={form.register}
              referenceImageCount={referenceImages.length}
              submitAvailability={submitAvailability}
              updateUserTextDraft={(userText) => updateDraft({ userText })}
              fileInputRef={fileInputRef}
              editBaseImage={editBaseImage}
              productImages={productImages}
              busy={busy}
              isDragging={isDragging}
              models={imageModelsQuery.data?.models ?? []}
              selectedModelId={selectedModelId}
              onModelChange={(modelId) => form.setValue("modelId", modelId, { shouldDirty: true })}
              onPaste={acceptProductClipboard}
              onDraggingChange={setIsDragging}
              onFileChange={(event) => {
                acceptProductFiles(event.target.files, "file-picker");
                event.target.value = "";
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                acceptProductFiles(event.dataTransfer.files, "drop");
              }}
              onOpenAssetPicker={() => {
                if (!activeProjectQuery.data) {
                  setUploadError("当前创作项目尚未就绪，请稍后重试");
                  return;
                }
                if (productImages.length >= 4) {
                  setUploadError("每轮最多上传 4 张商品主体图");
                  return;
                }
                setUploadError("");
                setAssetPickerOpen(true);
              }}
              onRemoveEditBaseImage={() => {
                clearEditBaseImage();
                setImageInputNotice("");
              }}
              onRemoveLocalImage={(index) => {
                removeProductImage(index);
                setImageInputNotice("");
              }}
              optimization={
                promptOptimization
                  ? {
                      pending:
                        promptOptimizationPending ||
                        promptOptimization.record.status === "processing",
                      error: promptOptimization.error
                    }
                  : null
              }
              optimizationPending={promptOptimizationPending}
              onOptimize={() => void runPromptOptimization({ operation: "optimize" })}
              onUndoOptimization={() => {
                const previous = promptOptimization?.history.at(-1);
                if (!previous) return;
                form.setValue("userText", previous.text, { shouldDirty: true });
                const remaining = promptOptimization!.history.slice(0, -1);
                setPromptOptimization(
                  previous.record
                    ? {
                        record: previous.record,
                        contextSignature:
                          previous.contextSignature ?? currentOptimizationContextSignature,
                        history: remaining,
                        error: null
                      }
                    : null
                );
              }}
              onOptimizeAgain={() => void runPromptOptimization({ operation: "alternative" })}
            />

            <NormalModeReferencePanel
              previewUrls={referencePreviews.map((preview) => preview.url)}
              maxImages={1}
              prompt={referencePrompt}
              onImageChange={(event) => {
                acceptReferenceFiles(event.target.files, "file-picker");
                event.target.value = "";
              }}
              onPaste={(event) => {
                const files = extractClipboardImageFiles(event.clipboardData);
                if (files.length === 0) return;
                event.preventDefault();
                event.stopPropagation();
                acceptReferenceFiles(files, "clipboard");
              }}
              onRemoveImage={(index) => {
                const preview = referencePreviews[index];
                if (preview?.kind === "restored") excludeReferenceAssetId(preview.assetId);
                if (preview?.kind === "draft") {
                  if (preview.assetId) excludeReferenceAssetId(preview.assetId);
                  removeReferenceImage(preview.index);
                }
                setImageInputNotice("");
              }}
              onPromptChange={(value) => updateDraft({ referencePrompt: value })}
            />

            {imageInputNotice && (
              <p className={normalModeStyles.inputNotice} role="status" aria-live="polite">
                <CircleCheck />
                {imageInputNotice}
              </p>
            )}

            {pageError && (
              <p className={normalModeStyles.inlineError} role="alert">
                <CircleAlert />
                {pageError}
              </p>
            )}
          </div>
          <div ref={threadEndRef} />
        </section>

        <NormalModeSettings
          values={{
            goal,
            imageCount,
            aspectRatio,
            style,
            quality,
            outputFormat,
            watermark,
            watermarkPosition
          }}
          availableImageCounts={availableImageCounts}
          availableRatios={availableRatios}
          watermarkLogoPreviewUrl={watermarkLogoPreviewUrl}
          agentInstruction={agentInstruction}
          onValueChange={setNormalModeValue}
          onWatermarkLogoChange={(event) => {
            acceptImageFiles(event.target.files, {
              source: "file-picker",
              target: "watermark",
              setter: setWatermarkLogo
            });
            event.target.value = "";
          }}
          onAgentInstructionChange={(value) => updateDraft({ agentInstruction: value })}
        />
      </form>
      <ImagePreviewDialog image={previewImage} onClose={() => setPreviewImage(null)} />
      <EditDraftConfirmDialog
        target={editResultTarget}
        onClose={() => setEditResultTarget(null)}
        onConfirm={() => editResultTarget && applyEditResult(editResultTarget)}
      />
      <AssetPickerDialog
        open={assetPickerOpen}
        projectId={activeProjectQuery.data?.id ?? null}
        maxSelection={Math.max(0, 4 - productImages.length)}
        excludedAssetIds={new Set(productImages.flatMap((image) => image.assetId ?? []))}
        onOpenChange={setAssetPickerOpen}
        onConfirm={(assets: MediaAssetListItem[]) => {
          addProductImages(
            assets.map((asset) => ({
              clientId: `asset-${asset.id}`,
              kind: "asset" as const,
              assetId: asset.id,
              name: asset.name,
              byteSize: asset.byteSize,
              previewUrl: apiClient.mediaContentUrl(asset.id)
            }))
          );
          setRunError(null);
          setUploadError("");
          setImageInputNotice(`已从资产库添加 ${assets.length} 张商品主体图`);
        }}
      />
    </div>
  );
}

function WorkbenchComposer({
  control,
  register,
  referenceImageCount,
  submitAvailability,
  updateUserTextDraft,
  ...composerProps
}: Readonly<WorkbenchComposerProps>) {
  const userText = useWatch({ control, name: "userText" });

  useEffect(() => {
    updateUserTextDraft(userText);
  }, [updateUserTextDraft, userText]);

  const hasInput = hasComposerInput({
    text: userText,
    productImageCount: composerProps.productImages.length,
    referenceImageCount,
    editBaseImageCount: composerProps.editBaseImage ? 1 : 0
  });
  const availability =
    submitAvailability.disabled || hasInput
      ? submitAvailability
      : {
          disabled: true,
          busy: false,
          label: "发送",
          reason: "请输入内容或添加图片"
        };

  return (
    <NormalModeComposer
      {...composerProps}
      textLength={userText.length}
      userTextRegistration={register("userText")}
      submitDisabled={availability.disabled}
      submitLabel={availability.label}
      {...(availability.reason ? { submitUnavailableReason: availability.reason } : {})}
    />
  );
}

function ConversationThread({
  agentName,
  messages,
  pendingTurn,
  activeTaskId,
  activeTurnNumber,
  verifiedAssetIds,
  historicalGenerationResults,
  stage,
  deliverableAssets,
  task,
  unitFailures,
  error,
  errorOccurredAt,
  onRetry,
  onCancel,
  onReplaceImage,
  onEditRequirement,
  onEditResult,
  onRegenerateResult,
  regeneratingUnitId,
  onPreviewImage
}: Readonly<{
  agentName: string;
  messages: ConversationMessage[];
  pendingTurn: PendingTurn | null;
  activeTaskId: string | null;
  activeTurnNumber: number | null;
  verifiedAssetIds: Set<string>;
  historicalGenerationResults: Map<string, HistoricalGenerationResult>;
  stage: GenerationStage;
  deliverableAssets: MediaAssetResponse[];
  task: ImageGenerationTask | undefined;
  unitFailures: NonNullable<ImageGenerationTask["unitFailures"]>;
  error: UserErrorPresentation | null;
  errorOccurredAt: string | null;
  onRetry: () => void;
  onCancel: () => void;
  onReplaceImage: () => void;
  onEditRequirement: () => void;
  onEditResult: (target: EditResultTarget) => void;
  onRegenerateResult: (taskId: string, unitId: string, sourceAssetId: string) => void;
  regeneratingUnitId: string | null;
  onPreviewImage: (image: { src: string; alt: string }) => void;
}>) {
  const currentTaskRelations = activeTaskId
    ? new Set([`generation-task:${activeTaskId}`, `generation-repair:${activeTaskId}`])
    : new Set<string>();
  const rounds = groupConversationMessages(messages);
  const showActiveRun = stage !== "draft" || Boolean(error);
  const activeRunContent = showActiveRun ? (
    <div className="conversation-assistant-content active-run-content">
      {task?.outputs && task.outputs.length > 0 ? (
        <GenerationOutputs
          agentName={agentName}
          task={task}
          error={error}
          onCancel={onCancel}
          onRetry={onRetry}
          onReplaceImage={onReplaceImage}
          onEditRequirement={onEditRequirement}
          onEditResult={onEditResult}
          onRegenerateResult={onRegenerateResult}
          regeneratingUnitId={regeneratingUnitId}
          onPreviewImage={onPreviewImage}
        />
      ) : error ? (
        <ErrorMessage
          error={error}
          occurredAt={errorOccurredAt}
          onRetry={onRetry}
          onReplaceImage={onReplaceImage}
          onEditRequirement={onEditRequirement}
        />
      ) : deliverableAssets.length > 0 ? (
        <GeneratedResults
          assets={deliverableAssets}
          unitFailures={unitFailures}
          onEditResult={onEditResult}
          onPreviewImage={onPreviewImage}
        />
      ) : (
        <StreamingProgress key={stage} stage={stage} task={task} />
      )}
    </div>
  ) : null;

  return (
    <div className="conversation-thread" aria-live="polite">
      {rounds.map((round, index) => {
        const containsActiveRun =
          !pendingTurn &&
          showActiveRun &&
          (activeTurnNumber === null
            ? index === rounds.length - 1
            : round.turnNumber === activeTurnNumber);
        const hasAssistantContent = round.assistant.length > 0 || containsActiveRun;
        return (
          <article className="conversation-round" key={round.turnNumber}>
            <div className="conversation-user-row">
              {round.user.map((message) => (
                <ConversationHistoryMessage
                  key={message.id}
                  agentName={agentName}
                  message={message}
                  hiddenRelations={currentTaskRelations}
                  hideGeneratedAssets={message.turnNumber === activeTurnNumber}
                  verifiedAssetIds={verifiedAssetIds}
                  historicalGenerationResults={historicalGenerationResults}
                  onEditResult={onEditResult}
                  onRegenerateResult={onRegenerateResult}
                  regeneratingUnitId={regeneratingUnitId}
                  onPreviewImage={onPreviewImage}
                />
              ))}
            </div>
            {hasAssistantContent && (
              <div className="conversation-agent-name">
                <i>✦</i> {agentName}
              </div>
            )}
            {round.assistant.length > 0 && (
              <div className="conversation-ai-row">
                {round.assistant.map((message) => (
                  <ConversationHistoryMessage
                    key={message.id}
                    agentName={agentName}
                    message={message}
                    hiddenRelations={currentTaskRelations}
                    hideGeneratedAssets={message.turnNumber === activeTurnNumber}
                    verifiedAssetIds={verifiedAssetIds}
                    historicalGenerationResults={historicalGenerationResults}
                    onEditResult={onEditResult}
                    onRegenerateResult={onRegenerateResult}
                    regeneratingUnitId={regeneratingUnitId}
                    onPreviewImage={onPreviewImage}
                  />
                ))}
              </div>
            )}
            {containsActiveRun && activeRunContent}
          </article>
        );
      })}

      {pendingTurn && (
        <article className="conversation-round pending-round">
          <div className="conversation-user-row">
            <PendingUserMessage turn={pendingTurn} onPreviewImage={onPreviewImage} />
          </div>
          {showActiveRun && (
            <>
              <div className="conversation-agent-name">
                <i>✦</i> {agentName}
              </div>
              {activeRunContent}
            </>
          )}
        </article>
      )}

      {rounds.length === 0 && !pendingTurn && showActiveRun && (
        <article className="conversation-round active-only-round">
          <div className="conversation-agent-name">
            <i>✦</i> {agentName}
          </div>
          {activeRunContent}
        </article>
      )}
    </div>
  );
}

function GenerationOutputs({
  agentName,
  task,
  error,
  onCancel,
  onRetry,
  onReplaceImage,
  onEditRequirement,
  onEditResult,
  onRegenerateResult,
  regeneratingUnitId,
  onPreviewImage
}: Readonly<{
  agentName: string;
  task: ImageGenerationTask;
  error: UserErrorPresentation | null;
  onCancel: () => void;
  onRetry: () => void;
  onReplaceImage: () => void;
  onEditRequirement: () => void;
  onEditResult: (target: EditResultTarget) => void;
  onRegenerateResult: (taskId: string, unitId: string, sourceAssetId: string) => void;
  regeneratingUnitId: string | null;
  onPreviewImage: (image: { src: string; alt: string }) => void;
}>) {
  const outputs = [...(task.outputs ?? [])].sort((left, right) => left.position - right.position);
  const completed = outputs.filter((output) => output.deliverableAsset).length;
  const failedOutputs = outputs.filter(isOutputFailed);
  const visibleOutputs = outputs.filter((output) => !isOutputFailed(output));
  const failed = failedOutputs.length;
  const running = outputs.length - completed - failed;
  return (
    <div className="conversation-generated-results">
      {failed > 0 && (
        <GenerationFailureMessage
          outputs={failedOutputs}
          completed={completed}
          running={running}
          occurredAt={task.updatedAt}
          error={error}
          onRetry={onRetry}
          onReplaceImage={onReplaceImage}
          onEditRequirement={onEditRequirement}
        />
      )}
      {running > 0 && (
        <div className="conversation-result-intro">
          <LoaderCircle className="spin" />
          <div>
            <strong>正在处理 {running} 张图片</strong>
            <p>
              {task.regeneratedFrom
                ? "正在按所选结果的原始需求再次生成 1 张图片。"
                : "每张图片独立生成和检查，已完成结果可立即查看。"}
            </p>
          </div>
          <button type="button" className="conversation-stop-button" onClick={onCancel}>
            <X />
            停止任务
          </button>
        </div>
      )}
      {visibleOutputs.length > 0 && (
        <div className={cn("conversation-result-grid", visibleOutputs.length > 1 && "is-multi")}>
          {visibleOutputs.map((output) => (
            <GenerationOutputSlot
              key={output.unitId}
              agentName={agentName}
              output={output}
              modelId={task.modelId}
              outputCount={1}
              regenerated={Boolean(task.regeneratedFrom)}
              onEditResult={onEditResult}
              onRegenerate={() => {
                if (output.deliverableAsset) {
                  onRegenerateResult(task.taskId, output.unitId, output.deliverableAsset.id);
                }
              }}
              regenerationPending={regeneratingUnitId !== null}
              regenerating={regeneratingUnitId === output.unitId}
              onPreviewImage={onPreviewImage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GenerationFailureMessage({
  outputs,
  completed,
  running,
  occurredAt,
  error,
  onRetry,
  onReplaceImage,
  onEditRequirement
}: Readonly<{
  outputs: NonNullable<ImageGenerationTask["outputs"]>;
  completed: number;
  running: number;
  occurredAt: string;
  error: UserErrorPresentation | null;
  onRetry: () => void;
  onReplaceImage: () => void;
  onEditRequirement: () => void;
}>) {
  const groups = groupGenerationOutputFailures(outputs);
  const primaryError = groups[0]?.presentation ?? error;
  const terminal = running === 0;
  const cancelled = groups.every((group) => group.presentation.title === "任务已停止");
  const title = cancelled
    ? "任务已停止"
    : completed > 0 || running > 0
      ? "部分图片未能完成"
      : "这次没有生成出可用图片";
  return (
    <section className="conversation-generation-failure-message" role="status">
      <CircleAlert />
      <div>
        <strong>{title}</strong>
        <p>
          {cancelled
            ? "未完成的图片不会展示，你可以调整需求后重新生成。"
            : running > 0
              ? `其中 ${outputs.length} 张已经停止处理，其余 ${running} 张仍在生成。`
              : completed > 0
                ? `已经完成 ${completed} 张，另外 ${outputs.length} 张未能完成。`
                : "本次任务没有产生可用结果，具体原因如下。"}
        </p>
        <ul>
          {groups.map((group) => (
            <li key={`${group.positions.join(",")}:${group.presentation.title}`}>
              结果 {group.positions.join("、")}：{group.presentation.title}。
              {group.presentation.message}
            </li>
          ))}
        </ul>
        {terminal && primaryError && primaryError.action !== "contact_support" && (
          <Button
            type="button"
            variant="secondary"
            onClick={errorActionHandler(primaryError, {
              onRetry,
              onReplaceImage,
              onEditRequirement
            })}
          >
            {primaryError.action === "replace_image" ? <ImagePlus /> : <RefreshCw />}
            {primaryError.actionLabel}
          </Button>
        )}
        <time className="conversation-message-time" dateTime={occurredAt}>
          {formatConversationTime(occurredAt)}
        </time>
      </div>
    </section>
  );
}

function GenerationOutputSlot({
  agentName,
  output,
  modelId,
  outputCount,
  regenerated,
  onEditResult,
  onRegenerate,
  regenerationPending,
  regenerating,
  onPreviewImage
}: Readonly<{
  agentName: string;
  output: NonNullable<ImageGenerationTask["outputs"]>[number];
  modelId: string;
  outputCount: number;
  regenerated: boolean;
  onEditResult: (target: EditResultTarget) => void;
  onRegenerate: () => void;
  regenerationPending: boolean;
  regenerating: boolean;
  onPreviewImage: (image: { src: string; alt: string }) => void;
}>) {
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [assetActionError, setAssetActionError] = useState("");
  const [downloadPending, setDownloadPending] = useState(false);
  const invalidateAssetQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ["image-generations"] });
    void queryClient.invalidateQueries({ queryKey: ["media-assets"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.assetFolders });
  };
  const renameMutation = useMutation({
    mutationFn: (name: string) => apiClient.renameMediaAsset(output.deliverableAsset!.id, { name }),
    onSuccess: () => {
      setRenameOpen(false);
      setRenameError("");
      setAssetActionError("");
      invalidateAssetQueries();
    },
    onError: (error) => setRenameError(presentUserError(error).message)
  });
  const favoriteMutation = useMutation({
    mutationFn: () =>
      output.favorite
        ? apiClient.unfavoriteMediaAsset(output.deliverableAsset!.id)
        : apiClient.favoriteMediaAsset(output.deliverableAsset!.id, null),
    onSuccess: () => {
      setAssetActionError("");
      invalidateAssetQueries();
    },
    onError: (error) => setAssetActionError(presentUserError(error).message)
  });
  const label = `${agentName}${regenerated ? "再次生成结果" : "生成结果"} ${output.groupPosition + 1}-${output.variantPosition + 1}`;
  const displayName = output.displayName?.trim() || label;
  const failed = isOutputFailed(output);
  const statusText = outputStatusText(output);
  const userError = output.error ? presentUserErrorCode(output.error.code) : null;
  return (
    <>
      <article className={cn("conversation-output-slot", failed && "is-failed")}>
        <div className="conversation-output-media">
          {output.deliverableAsset ? (
            <>
              <button
                className="conversation-image-button"
                type="button"
                aria-label={`放大查看${displayName}`}
                onClick={() =>
                  onPreviewImage({
                    src: apiClient.mediaContentUrl(output.deliverableAsset!.id),
                    alt: displayName
                  })
                }
              >
                <Image
                  src={apiClient.mediaContentUrl(output.deliverableAsset.id)}
                  alt={displayName}
                  width={1200}
                  height={1200}
                  unoptimized
                />
              </button>
              <button
                type="button"
                className={cn(
                  "conversation-output-favorite-button",
                  output.favorite && "is-favorite"
                )}
                aria-label={output.favorite ? `取消收藏${displayName}` : `收藏${displayName}`}
                title={output.favorite ? "取消收藏" : "收藏"}
                disabled={favoriteMutation.isPending}
                onClick={() => favoriteMutation.mutate()}
              >
                <Heart fill={output.favorite ? "currentColor" : "none"} />
              </button>
            </>
          ) : (
            <div className="conversation-output-placeholder">
              {failed ? <CircleAlert /> : <LoaderCircle className="spin" />}
              <strong>{statusText}</strong>
              {!failed && (
                <EstimatedProgressBar
                  key={outputProgressStage(output)}
                  stage={outputProgressStage(output)}
                  modelId={modelId}
                  outputCount={outputCount}
                  maximumAttemptCount={output.attemptCount}
                  startedAt={output.stageStartedAt}
                  compact
                />
              )}
              {userError && <p>{userError.message}</p>}
            </div>
          )}
        </div>
        <div className="conversation-output-details">
          <strong title={displayName}>{displayName}</strong>
          {!output.deliverableAsset && <span>{statusText}</span>}
        </div>
        {output.deliverableAsset && (
          <div className="conversation-output-actions">
            <button
              type="button"
              className="conversation-output-rename-button"
              aria-label={`重命名${displayName}`}
              onClick={() => {
                setRenameName(displayName);
                setRenameError("");
                setRenameOpen(true);
              }}
            >
              <Pencil />
              重命名
            </button>
            <button
              type="button"
              className="conversation-output-edit-button"
              onClick={() => onEditResult({ asset: output.deliverableAsset!, name: displayName })}
            >
              <WandSparkles />
              重新编辑
            </button>
            <button
              type="button"
              className="conversation-output-regenerate-button"
              disabled={regenerationPending}
              onClick={onRegenerate}
            >
              <RefreshCw className={cn(regenerating && "spin")} />
              {regenerating ? "提交中" : "再次生成"}
            </button>
            <button
              type="button"
              className="conversation-output-download-button"
              disabled={downloadPending}
              onClick={() => {
                setDownloadPending(true);
                setAssetActionError("");
                void downloadMediaAsset({
                  url: apiClient.mediaContentUrl(output.deliverableAsset!.id),
                  name: displayName,
                  mimeType: output.deliverableAsset!.mimeType
                })
                  .catch(() => setAssetActionError("图片下载失败，请稍后重试"))
                  .finally(() => setDownloadPending(false));
              }}
            >
              {downloadPending ? <LoaderCircle className="spin" /> : <Download />}
              {downloadPending ? "下载中" : "下载"}
            </button>
          </div>
        )}
        {assetActionError && (
          <p className="conversation-output-action-error" role="alert">
            {assetActionError}
          </p>
        )}
      </article>
      <GenerationRenameDialog
        open={renameOpen}
        name={renameName}
        pending={renameMutation.isPending}
        error={renameError}
        onNameChange={setRenameName}
        onClose={() => !renameMutation.isPending && setRenameOpen(false)}
        onSubmit={() => {
          const name = renameName.trim();
          if (!name) {
            setRenameError("请填写结果名称");
            return;
          }
          renameMutation.mutate(name);
        }}
      />
    </>
  );
}

function GenerationRenameDialog({
  open,
  name,
  pending,
  error,
  onNameChange,
  onClose,
  onSubmit
}: Readonly<{
  open: boolean;
  name: string;
  pending: boolean;
  error: string;
  onNameChange: (name: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}>) {
  if (!open) return null;
  return (
    <div
      className="generation-rename-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="重命名生成结果"
    >
      <button
        type="button"
        className="generation-rename-backdrop"
        aria-label="关闭重命名弹窗"
        onClick={onClose}
      />
      <form
        className="generation-rename-content"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <h2>重命名生成结果</h2>
        <p>仅修改资产库显示名称，不影响图片内容。</p>
        {error && (
          <p className="generation-rename-error" role="alert">
            {error}
          </p>
        )}
        <label>
          <span>名称</span>
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            maxLength={200}
            autoFocus
            required
          />
        </label>
        <div className="generation-rename-footer">
          <button type="button" onClick={onClose} disabled={pending}>
            取消
          </button>
          <button type="submit" disabled={pending}>
            {pending && <LoaderCircle className="spin" />}
            确认
          </button>
        </div>
      </form>
    </div>
  );
}

function isOutputFailed(output: NonNullable<ImageGenerationTask["outputs"]>[number]): boolean {
  return (
    output.generationStatus === "failed" ||
    output.generationStatus === "cancelled" ||
    output.subjectConsistencyStatus === "source_unusable" ||
    output.subjectConsistencyStatus === "execution_failed" ||
    output.subjectConsistencyStatus === "cancelled" ||
    (output.subjectConsistencyStatus === "completed" && !output.deliverableAsset)
  );
}

function outputStatusText(output: NonNullable<ImageGenerationTask["outputs"]>[number]): string {
  if (isOutputFailed(output)) return "处理失败";
  if (output.generationStatus === "queued") return "等待生成";
  if (output.generationStatus === "running") {
    return output.attemptCount > 1 ? "正在重试" : "正在生成";
  }
  if (output.subjectConsistencyRequired && !output.deliverableAsset) {
    if (output.subjectConsistencyStatus === "running") return "正在检查主体";
    return "等待主体检查";
  }
  return "处理完成";
}

function outputProgressStage(
  output: NonNullable<ImageGenerationTask["outputs"]>[number]
): GenerationStage {
  if (isOutputFailed(output)) return "failed";
  if (output.generationStatus === "queued") return "generation_queued";
  if (output.generationStatus === "running") return "generation_running";
  if (output.subjectConsistencyRequired && !output.deliverableAsset) {
    return generationStageForQualityPhase(output.subjectConsistencyPhase);
  }
  return "succeeded";
}

function groupConversationMessages(messages: ConversationMessage[]) {
  const rounds = new Map<
    number,
    { turnNumber: number; user: ConversationMessage[]; assistant: ConversationMessage[] }
  >();

  for (const message of messages) {
    const round = rounds.get(message.turnNumber) ?? {
      turnNumber: message.turnNumber,
      user: [],
      assistant: []
    };
    round[message.role].push(message);
    rounds.set(message.turnNumber, round);
  }

  return [...rounds.values()].sort((left, right) => left.turnNumber - right.turnNumber);
}

function ConversationHistoryMessage({
  agentName,
  message,
  hiddenRelations,
  hideGeneratedAssets,
  verifiedAssetIds,
  historicalGenerationResults,
  onEditResult,
  onRegenerateResult,
  regeneratingUnitId,
  onPreviewImage
}: Readonly<{
  agentName: string;
  message: ConversationMessage;
  hiddenRelations: Set<string>;
  hideGeneratedAssets: boolean;
  verifiedAssetIds: Set<string>;
  historicalGenerationResults: Map<string, HistoricalGenerationResult>;
  onEditResult: (target: EditResultTarget) => void;
  onRegenerateResult: (taskId: string, unitId: string, sourceAssetId: string) => void;
  regeneratingUnitId: string | null;
  onPreviewImage: (image: { src: string; alt: string }) => void;
}>) {
  const visibleAssets = message.assets.filter(
    (asset) =>
      message.role !== "assistant" ||
      !asset.role.endsWith("result") ||
      (verifiedAssetIds.has(asset.assetId) &&
        !hideGeneratedAssets &&
        (!asset.relation || !hiddenRelations.has(asset.relation)))
  );
  const actionableResults = visibleAssets.flatMap((asset) => {
    if (message.role !== "assistant" || !asset.role.endsWith("result")) return [];
    const result = historicalGenerationResults.get(asset.assetId);
    return result ? [result] : [];
  });
  const readOnlyAssets = visibleAssets.filter(
    (asset) =>
      message.role !== "assistant" ||
      !asset.role.endsWith("result") ||
      !historicalGenerationResults.has(asset.assetId)
  );
  return (
    <div className={cn("conversation-message", message.role)}>
      <div className="conversation-message-body">
        {message.role === "assistant" && message.content && (
          <p className="conversation-assistant-copy">{message.content}</p>
        )}
        {readOnlyAssets.length > 0 && (
          <div className="conversation-message-images">
            {readOnlyAssets.map((asset) => {
              const src = apiClient.mediaContentUrl(asset.assetId);
              const alt = asset.role === "product_source" ? "用户上传的商品图" : "历史生成结果";
              return (
                <button
                  className="conversation-image-button"
                  type="button"
                  key={asset.assetId}
                  aria-label={`放大查看${alt}`}
                  onClick={() => onPreviewImage({ src, alt })}
                >
                  <Image src={src} alt={alt} width={420} height={420} unoptimized />
                </button>
              );
            })}
          </div>
        )}
        {actionableResults.length > 0 && (
          <div
            className={cn("conversation-result-grid", actionableResults.length > 1 && "is-multi")}
          >
            {actionableResults.map((result) => (
              <GenerationOutputSlot
                key={`${result.taskId}:${result.output.unitId}`}
                agentName={agentName}
                output={result.output}
                modelId={result.modelId}
                outputCount={1}
                regenerated={result.regenerated}
                onEditResult={onEditResult}
                onRegenerate={() =>
                  onRegenerateResult(
                    result.taskId,
                    result.output.unitId,
                    result.output.deliverableAsset!.id
                  )
                }
                regenerationPending={regeneratingUnitId !== null}
                regenerating={regeneratingUnitId === result.output.unitId}
                onPreviewImage={onPreviewImage}
              />
            ))}
          </div>
        )}
        {message.role === "user" && message.content && <p>{message.content}</p>}
      </div>
      <time className="conversation-message-time" dateTime={message.createdAt}>
        {formatConversationTime(message.createdAt)}
      </time>
    </div>
  );
}

function PendingUserMessage({
  turn,
  onPreviewImage
}: Readonly<{
  turn: PendingTurn;
  onPreviewImage: (image: { src: string; alt: string }) => void;
}>) {
  return (
    <div className="conversation-message user pending">
      <div className="conversation-message-body">
        {turn.previewUrls.length > 0 && (
          <div className="conversation-message-images">
            {turn.previewUrls.map((src, index) => (
              <button
                className="conversation-image-button"
                type="button"
                key={src}
                aria-label={`放大查看本轮商品图 ${index + 1}`}
                onClick={() => onPreviewImage({ src, alt: `本轮商品图 ${index + 1}` })}
              >
                <Image
                  src={src}
                  alt={`本轮商品图 ${index + 1}`}
                  width={420}
                  height={420}
                  unoptimized
                />
              </button>
            ))}
          </div>
        )}
        {turn.text && <p>{turn.text}</p>}
      </div>
      <time className="conversation-message-time" dateTime={turn.createdAt}>
        {formatConversationTime(turn.createdAt)}
      </time>
    </div>
  );
}

function StreamingProgress({
  stage,
  task
}: Readonly<{ stage: GenerationStage; task: ImageGenerationTask | undefined }>) {
  const text = useProgressiveText(generationStageLabel[stage]);
  const outputCount = task?.requestedOutputCount ?? task?.outputs?.length;
  return (
    <div className="conversation-streaming-progress">
      <span className="streaming-orb">
        <LoaderCircle className="spin" />
      </span>
      <div className="streaming-progress-copy">
        <strong>
          {text}
          <i className="streaming-caret" />
        </strong>
        <EstimatedProgressBar
          stage={stage}
          {...(task?.modelId ? { modelId: task.modelId } : {})}
          {...(outputCount ? { outputCount } : {})}
          maximumAttemptCount={Math.max(
            0,
            ...(task?.outputs?.map((output) => output.attemptCount) ?? [])
          )}
          {...(task?.executionConcurrency ? { concurrency: task.executionConcurrency } : {})}
          {...(task?.stageStartedAt ? { startedAt: task.stageStartedAt } : {})}
        />
      </div>
    </div>
  );
}

function EstimatedProgressBar({
  stage,
  modelId,
  outputCount,
  maximumAttemptCount,
  concurrency,
  startedAt,
  compact = false
}: Readonly<{
  stage: GenerationStage;
  modelId?: string;
  outputCount?: number;
  maximumAttemptCount?: number;
  concurrency?: number;
  startedAt?: string;
  compact?: boolean;
}>) {
  const localStartedAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const estimate = estimateWorkflowProgress({
    stage,
    elapsedMs: now - (startedAt ? Date.parse(startedAt) : localStartedAt.current),
    ...(modelId ? { modelId } : {}),
    ...(outputCount ? { outputCount } : {}),
    ...(maximumAttemptCount ? { maximumAttemptCount } : {}),
    ...(concurrency ? { concurrency } : {})
  });
  return (
    <div className={cn("estimated-progress", compact && "is-compact")}>
      <div
        className="estimated-progress-track"
        role="progressbar"
        aria-label={`${generationStageLabel[stage]}进度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={estimate.percent}
      >
        <span style={{ width: `${estimate.percent}%` }} />
      </div>
      <p>
        已处理 {formatProgressDuration(estimate.elapsedMs)}
        {estimate.expectedRemainingMs !== null
          ? ` · 预计还需 ${formatProgressDuration(estimate.expectedRemainingMs)}`
          : " · 处理时间较长，仍在继续"}
      </p>
    </div>
  );
}

function GeneratedResults({
  assets,
  unitFailures,
  onEditResult,
  onPreviewImage
}: Readonly<{
  assets: MediaAssetResponse[];
  unitFailures: NonNullable<ImageGenerationTask["unitFailures"]>;
  onEditResult: (target: EditResultTarget) => void;
  onPreviewImage: (image: { src: string; alt: string }) => void;
}>) {
  const [downloadingAssetId, setDownloadingAssetId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState("");
  return (
    <div className="conversation-generated-results">
      <div className="conversation-result-intro">
        <CircleCheck />
        <div>
          <strong>图片已经生成好了</strong>
          <p>已完成结果确认，可以查看或下载原图。</p>
        </div>
      </div>
      {unitFailures.length > 0 && (
        <div className="conversation-partial-failure" role="status">
          <CircleAlert />
          <div>
            <strong>部分图片未生成成功</strong>
            {unitFailures.map((failure) => (
              <p key={`${failure.position}:${failure.code}`}>
                第 {failure.position + 1} 张：{presentUserErrorCode(failure.code).title}。
                {presentUserErrorCode(failure.code).message}
              </p>
            ))}
          </div>
        </div>
      )}
      <div className={cn("conversation-result-grid", assets.length > 1 && "is-multi")}>
        {assets.map((asset, index) => (
          <article className="conversation-output-slot" key={asset.id}>
            <div className="conversation-output-media">
              <button
                className="conversation-image-button"
                type="button"
                aria-label={`放大查看生成结果 ${index + 1}`}
                onClick={() =>
                  onPreviewImage({
                    src: apiClient.mediaContentUrl(asset.id),
                    alt: `生成结果 ${index + 1}`
                  })
                }
              >
                <Image
                  src={apiClient.mediaContentUrl(asset.id)}
                  alt={`生成结果 ${index + 1}`}
                  width={1200}
                  height={1200}
                  unoptimized
                />
              </button>
            </div>
            <div className="conversation-output-details">
              <strong>生成结果 {index + 1}</strong>
            </div>
            <div className="conversation-output-actions">
              <button
                type="button"
                className="conversation-output-edit-button"
                onClick={() => onEditResult({ asset, name: `生成结果 ${index + 1}` })}
              >
                <WandSparkles />
                重新编辑
              </button>
              <button
                type="button"
                className="conversation-output-download-button"
                disabled={downloadingAssetId !== null}
                onClick={() => {
                  setDownloadingAssetId(asset.id);
                  setDownloadError("");
                  void downloadMediaAsset({
                    url: apiClient.mediaContentUrl(asset.id),
                    name: `生成结果 ${index + 1}`,
                    mimeType: asset.mimeType
                  })
                    .catch(() => setDownloadError("图片下载失败，请稍后重试"))
                    .finally(() => setDownloadingAssetId(null));
                }}
              >
                {downloadingAssetId === asset.id ? <LoaderCircle className="spin" /> : <Download />}
                {downloadingAssetId === asset.id ? "下载中" : "下载"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {downloadError && (
        <p className="conversation-output-action-error" role="alert">
          {downloadError}
        </p>
      )}
    </div>
  );
}

function EditDraftConfirmDialog({
  target,
  onClose,
  onConfirm
}: Readonly<{
  target: EditResultTarget | null;
  onClose: () => void;
  onConfirm: () => void;
}>) {
  if (!target) return null;
  return (
    <div
      className="generation-rename-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="覆盖当前草稿"
    >
      <button
        type="button"
        className="generation-rename-backdrop"
        aria-label="取消重新编辑"
        onClick={onClose}
      />
      <div className="generation-rename-content">
        <h2>覆盖当前草稿？</h2>
        <p>
          当前有尚未发送的文字、商品图或参考图。继续后将清空这些内容，并把「{target.name}
          」设为编辑底图。
        </p>
        <div className="generation-rename-footer">
          <button type="button" onClick={onClose}>
            保留草稿
          </button>
          <button type="submit" onClick={onConfirm}>
            覆盖并重新编辑
          </button>
        </div>
      </div>
    </div>
  );
}

function ImagePreviewDialog({
  image,
  onClose
}: Readonly<{
  image: { src: string; alt: string } | null;
  onClose: () => void;
}>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pinchRef = useRef<{
    distance: number;
    centerX: number;
    centerY: number;
    scale: number;
    x: number;
    y: number;
  } | null>(null);
  const [previewTransform, setPreviewTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [previewDragging, setPreviewDragging] = useState(false);

  useEffect(() => {
    setPreviewTransform({ scale: 1, x: 0, y: 0 });
    setPreviewDragging(false);
    pointersRef.current.clear();
    dragRef.current = null;
    pinchRef.current = null;
  }, [image?.src]);

  useEffect(() => {
    if (!image) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [image, onClose]);

  const constrainTransform = (transform: { scale: number; x: number; y: number }) => {
    const viewport = viewportRef.current;
    if (!viewport || transform.scale <= 1) return { scale: 1, x: 0, y: 0 };
    const maximumX = (viewport.clientWidth * (transform.scale - 1)) / 2;
    const maximumY = (viewport.clientHeight * (transform.scale - 1)) / 2;
    return {
      scale: transform.scale,
      x: Math.max(-maximumX, Math.min(maximumX, transform.x)),
      y: Math.max(-maximumY, Math.min(maximumY, transform.y))
    };
  };

  const zoomAtPoint = (nextScale: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const pointX = clientX - rect.left - rect.width / 2;
    const pointY = clientY - rect.top - rect.height / 2;
    setPreviewTransform((current) => {
      const scale = Math.max(1, Math.min(5, nextScale));
      const ratio = scale / current.scale;
      return constrainTransform({
        scale,
        x: pointX - (pointX - current.x) * ratio,
        y: pointY - (pointY - current.y) * ratio
      });
    });
  };

  const handlePreviewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAtPoint(previewTransform.scale * factor, event.clientX, event.clientY);
  };

  const startPinch = () => {
    const viewport = viewportRef.current;
    const points = [...pointersRef.current.values()];
    if (!viewport || points.length < 2) return;
    const [first, second] = points;
    if (!first || !second) return;
    const rect = viewport.getBoundingClientRect();
    pinchRef.current = {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      centerX: (first.x + second.x) / 2 - rect.left - rect.width / 2,
      centerY: (first.y + second.y) / 2 - rect.top - rect.height / 2,
      ...previewTransform
    };
    dragRef.current = null;
  };

  const handlePreviewPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setPreviewDragging(true);
    if (pointersRef.current.size >= 2) {
      startPinch();
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: previewTransform.x,
      originY: previewTransform.y
    };
  };

  const handlePreviewPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    const pinch = pinchRef.current;
    const viewport = viewportRef.current;
    if (points.length >= 2 && pinch && viewport) {
      const [first, second] = points;
      if (!first || !second) return;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const scale = Math.max(1, Math.min(5, pinch.scale * (distance / pinch.distance)));
      const rect = viewport.getBoundingClientRect();
      const centerX = (first.x + second.x) / 2 - rect.left - rect.width / 2;
      const centerY = (first.y + second.y) / 2 - rect.top - rect.height / 2;
      const ratio = scale / pinch.scale;
      setPreviewTransform(
        constrainTransform({
          scale,
          x: centerX - (pinch.centerX - pinch.x) * ratio,
          y: centerY - (pinch.centerY - pinch.y) * ratio
        })
      );
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || previewTransform.scale <= 1) return;
    setPreviewTransform(
      constrainTransform({
        scale: previewTransform.scale,
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY
      })
    );
  };

  const handlePreviewPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 1) {
      const [remaining] = [...pointersRef.current.entries()];
      if (!remaining) return;
      dragRef.current = {
        pointerId: remaining[0],
        startX: remaining[1].x,
        startY: remaining[1].y,
        originX: previewTransform.x,
        originY: previewTransform.y
      };
      pinchRef.current = null;
      return;
    }
    if (pointersRef.current.size === 0) {
      dragRef.current = null;
      pinchRef.current = null;
      setPreviewDragging(false);
    }
  };

  if (!image) return null;
  return (
    <div className="image-preview-dialog" role="dialog" aria-modal="true" aria-label={image.alt}>
      <button
        className="image-preview-backdrop"
        type="button"
        onClick={onClose}
        aria-label="关闭图片预览"
      />
      <div className="image-preview-content">
        <button className="image-preview-close" type="button" onClick={onClose} aria-label="关闭">
          <X />
        </button>
        {previewTransform.scale > 1 && (
          <output className="image-preview-scale" aria-live="polite">
            {Math.round(previewTransform.scale * 100)}%
          </output>
        )}
        <div
          ref={viewportRef}
          className="image-preview-viewport"
          data-zoomed={previewTransform.scale > 1 || undefined}
          data-dragging={previewDragging || undefined}
          onWheel={handlePreviewWheel}
          onDoubleClick={(event) => {
            if (previewTransform.scale > 1) setPreviewTransform({ scale: 1, x: 0, y: 0 });
            else zoomAtPoint(2, event.clientX, event.clientY);
          }}
          onPointerDown={handlePreviewPointerDown}
          onPointerMove={handlePreviewPointerMove}
          onPointerUp={handlePreviewPointerEnd}
          onPointerCancel={handlePreviewPointerEnd}
        >
          <div
            className="image-preview-canvas"
            style={{
              transform: `translate3d(${previewTransform.x}px, ${previewTransform.y}px, 0) scale(${previewTransform.scale})`
            }}
          >
            <Image
              src={image.src}
              alt={image.alt}
              width={1600}
              height={1600}
              draggable={false}
              unoptimized
              priority
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorMessage({
  error,
  occurredAt,
  onRetry,
  onReplaceImage,
  onEditRequirement
}: Readonly<{
  error: UserErrorPresentation;
  occurredAt: string | null;
  onRetry: () => void;
  onReplaceImage: () => void;
  onEditRequirement: () => void;
}>) {
  const action = errorActionHandler(error, { onRetry, onReplaceImage, onEditRequirement });
  return (
    <div className="conversation-error-message">
      <CircleAlert />
      <div>
        <strong>{error.title}</strong>
        <p>{error.message}</p>
        {error.action !== "contact_support" && (
          <Button type="button" variant="secondary" onClick={action}>
            {error.action === "replace_image" ? <ImagePlus /> : <RefreshCw />}
            {error.actionLabel}
          </Button>
        )}
        {occurredAt && (
          <time className="conversation-message-time" dateTime={occurredAt}>
            {formatConversationTime(occurredAt)}
          </time>
        )}
      </div>
    </div>
  );
}

function errorActionHandler(
  error: UserErrorPresentation,
  handlers: {
    onRetry: () => void;
    onReplaceImage: () => void;
    onEditRequirement: () => void;
  }
) {
  if (error.action === "replace_image") return handlers.onReplaceImage;
  if (error.action === "edit_requirement") return handlers.onEditRequirement;
  if (error.action === "refresh") return () => window.location.reload();
  return handlers.onRetry;
}

function queryError(error: unknown) {
  if (!error) return "";
  return presentUserError(error).message;
}

function normalModeProfileForGoal(goal: ImageCreationFormValues["goal"]) {
  return {
    商品主图: {
      name: "商品主图 Agent",
      description: "为商品生成清晰、可信并符合电商平台使用场景的商品主图。"
    },
    场景展示: {
      name: "场景展示图 Agent",
      description: "为商品生成具有真实使用氛围和生活感的场景展示图。"
    },
    营销海报: {
      name: "家居推广图 Agent",
      description: "为家居商品生成带生活场景的营销推广图。"
    },
    详情页配图: {
      name: "详情页配图 Agent",
      description: "为商品详情页生成突出卖点和使用场景的配图。"
    }
  }[goal];
}

function renderSettingsForQuality(quality: ImageCreationFormValues["quality"]) {
  return quality === "标准"
    ? ({ resolutionPreset: "1k", providerQuality: "medium" } as const)
    : ({ resolutionPreset: "2k", providerQuality: "high" } as const);
}

function qualityLabelForRenderSettings(input: {
  resolutionPreset: string;
  providerQuality: string;
}): ImageCreationFormValues["quality"] {
  return input.resolutionPreset === "1k" && input.providerQuality !== "high" ? "标准" : "高清";
}

function outputFormatValue(
  format: ImageCreationFormValues["outputFormat"]
): "png" | "jpeg" | "webp" {
  return { PNG: "png", JPG: "jpeg", WEBP: "webp" }[format] as "png" | "jpeg" | "webp";
}

function outputFormatLabel(
  format: "png" | "jpeg" | "webp"
): ImageCreationFormValues["outputFormat"] {
  return { png: "PNG", jpeg: "JPG", webp: "WEBP" }[
    format
  ] as ImageCreationFormValues["outputFormat"];
}

function watermarkPositionValue(
  position: string
): "bottom_right" | "top_left" | "top_right" | "bottom_left" | "center" {
  return (
    (
      {
        右下角: "bottom_right",
        左上角: "top_left",
        右上角: "top_right",
        左下角: "bottom_left",
        居中: "center"
      } as const
    )[position as "右下角" | "左上角" | "右上角" | "左下角" | "居中"] ?? "bottom_right"
  );
}

function watermarkPositionLabel(
  position: "bottom_right" | "top_left" | "top_right" | "bottom_left" | "center"
): "右下角" | "左上角" | "右上角" | "左下角" | "居中" {
  return (
    {
      bottom_right: "右下角",
      top_left: "左上角",
      top_right: "右上角",
      bottom_left: "左下角",
      center: "居中"
    } as const
  )[position];
}

function isWatermarkPositionLabel(
  value: string | number | boolean
): value is "右下角" | "左上角" | "右上角" | "左下角" | "居中" {
  return ["右下角", "左上角", "右上角", "左下角", "居中"].some((position) => position === value);
}

function parseUuid(value: string | null) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function getConversationIdempotency(
  sessionId: string,
  signature: string
): { key: string; signature: string } {
  const storageKey = `conversation-message-idempotency:${sessionId}`;
  const stored = sessionStorage.getItem(storageKey);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { key?: unknown; signature?: unknown };
      if (
        typeof parsed.key === "string" &&
        typeof parsed.signature === "string" &&
        parsed.signature === signature
      ) {
        return { key: parsed.key, signature };
      }
    } catch {
      sessionStorage.removeItem(storageKey);
    }
  }
  const value = { key: crypto.randomUUID(), signature };
  sessionStorage.setItem(storageKey, JSON.stringify(value));
  return value;
}

function clearConversationIdempotency(sessionId: string, key: string) {
  const storageKey = `conversation-message-idempotency:${sessionId}`;
  const stored = sessionStorage.getItem(storageKey);
  if (!stored) return;
  try {
    const parsed = JSON.parse(stored) as { key?: unknown };
    if (parsed.key === key) sessionStorage.removeItem(storageKey);
  } catch {
    sessionStorage.removeItem(storageKey);
  }
}

function createPromptOptimizationContextSignature(input: {
  agentInstruction: string;
  sessionVersion: number;
  modelId: string;
  imageCount: number;
  aspectRatio: string;
  goal: string;
  style: string;
  editBaseAssetId: string | null;
  productAssetIds: string[];
  referenceAssetIds: string[];
  referencePrompt: string;
}): string {
  return JSON.stringify(input);
}

function selectedPromptOptimizationAttachments(record: PromptOptimization) {
  const candidates = new Map(
    record.inputRevision.candidateImages.map((candidate) => [candidate.key, candidate])
  );
  const attachments = record.selectedImageKeys.flatMap((key) => {
    const candidate = candidates.get(key);
    if (!candidate) return [];
    const role = ["generated_result", "selected_result"].includes(candidate.role)
      ? ("edit_base" as const)
      : candidate.role;
    if (!["product_source", "user_reference", "edit_base"].includes(role)) return [];
    return [{ assetId: candidate.assetId, role, relation: candidate.relation }];
  });
  const unique = new Map(attachments.map((item) => [`${item.assetId}:${item.role}`, item]));
  return [...unique.values()] as Array<{
    assetId: string;
    role: "product_source" | "user_reference" | "edit_base";
    relation: string | null;
  }>;
}

function useProgressiveText(value: string) {
  const [visible, setVisible] = useState("");
  useEffect(() => {
    setVisible("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setVisible(value.slice(0, index));
      if (index >= value.length) window.clearInterval(timer);
    }, 38);
    return () => window.clearInterval(timer);
  }, [value]);
  return visible;
}
