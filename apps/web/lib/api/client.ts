import {
  assetFolderListResponseSchema,
  assetFolderSchema,
  agentListResponseSchema,
  agentSchema,
  conversationHistoryResponseSchema,
  currentConversationResponseSchema,
  conversationMessagesPageResponseSchema,
  conversationSessionSchema,
  createConversationMessageResponseSchema,
  createImageGenerationResponseSchema,
  imageGenerationCancellationSchema,
  activeImageGenerationResponseSchema,
  imageGenerationTaskSchema,
  imageGenerationTaskListResponseSchema,
  imageModelListResponseSchema,
  mediaAssetCalendarResponseSchema,
  mediaAssetListResponseSchema,
  mediaAssetResponseSchema,
  promptOptimizationSchema,
  projectSchema,
  readinessResponseSchema,
  regenerateImageGenerationOutputResponseSchema,
  resolveRequirementResponseSchema,
  subjectConsistencyCheckSchema,
  type CreateAgentRequest,
  type CreateAssetFolderRequest,
  type CreateConversationMessageRequest,
  type CreateConversationRequest,
  type CreateImageGenerationRequest,
  type CreatePromptOptimizationRequest,
  type RegenerateImageGenerationOutputRequest,
  type RenameAgentRequest,
  type RenameAssetFolderRequest,
  type RenameMediaAssetRequest
} from "@chaoren/contracts";
import { z } from "zod";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api/v1";

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    public readonly code = "API_REQUEST_FAILED",
    public readonly details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseJson<TSchema extends z.ZodType>(response: Response, schema: TSchema) {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      code?: string;
      message?: string;
      [key: string]: unknown;
    } | null;
    throw new ApiError(
      response.status,
      payload?.message ?? `请求失败（${response.status}）`,
      payload?.code,
      payload
    );
  }

  return schema.parse(await response.json());
}

async function jsonRequest<TSchema extends z.ZodType>(
  path: string,
  init: RequestInit,
  schema: TSchema
) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers
    }
  });
  return parseJson(response, schema);
}

async function voidRequest(path: string, init: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) await parseJson(response, z.never());
}

export const apiClient = {
  async getReadiness() {
    const response = await fetch(`${API_BASE_URL}/health/ready`, { method: "GET" });
    return readinessResponseSchema.parse(await response.json());
  },

  getAgents(query: {
    keyword?: string;
    type?: "all" | "image" | "video";
    timeRange?: "all" | "today" | "7d" | "30d";
    page?: number;
    pageSize?: number;
  }) {
    const search = new URLSearchParams();
    if (query.keyword) search.set("keyword", query.keyword);
    if (query.type) search.set("type", query.type);
    if (query.timeRange) search.set("timeRange", query.timeRange);
    if (query.page) search.set("page", String(query.page));
    if (query.pageSize) search.set("pageSize", String(query.pageSize));
    return jsonRequest(`/agents?${search.toString()}`, { method: "GET" }, agentListResponseSchema);
  },

  getAgent(agentId: string) {
    return jsonRequest(`/agents/${agentId}`, { method: "GET" }, agentSchema);
  },

  createAgent(input: CreateAgentRequest) {
    return jsonRequest("/agents", { method: "POST", body: JSON.stringify(input) }, agentSchema);
  },

  copyAgent(agentId: string) {
    return jsonRequest(`/agents/${agentId}/copies`, { method: "POST" }, agentSchema);
  },

  renameAgent(agentId: string, input: RenameAgentRequest) {
    return jsonRequest(
      `/agents/${agentId}`,
      { method: "PATCH", body: JSON.stringify(input) },
      agentSchema
    );
  },

  deleteAgent(agentId: string) {
    return voidRequest(`/agents/${agentId}`, { method: "DELETE" });
  },

  ensureCurrentConversation(input: CreateConversationRequest) {
    return jsonRequest(
      "/conversations/current",
      { method: "PUT", body: JSON.stringify(input) },
      conversationSessionSchema
    );
  },

  getCurrentConversation(agentId: string) {
    return jsonRequest(
      `/conversations/current?agentId=${encodeURIComponent(agentId)}`,
      { method: "GET" },
      currentConversationResponseSchema
    );
  },

  getConversation(sessionId: string, agentId: string) {
    return jsonRequest(
      `/conversations/${sessionId}?agentId=${encodeURIComponent(agentId)}&limit=20`,
      { method: "GET" },
      conversationHistoryResponseSchema
    );
  },

  getConversationMessages(sessionId: string, agentId: string, beforeTurn: number) {
    return jsonRequest(
      `/conversations/${sessionId}/messages?agentId=${encodeURIComponent(agentId)}&beforeTurn=${beforeTurn}&limit=20`,
      { method: "GET" },
      conversationMessagesPageResponseSchema
    );
  },

  sendConversationMessage(
    sessionId: string,
    agentId: string,
    input: CreateConversationMessageRequest
  ) {
    return jsonRequest(
      `/conversations/${sessionId}/messages?agentId=${encodeURIComponent(agentId)}`,
      { method: "POST", body: JSON.stringify(input) },
      createConversationMessageResponseSchema
    );
  },

  createPromptOptimization(sessionId: string, input: CreatePromptOptimizationRequest) {
    return jsonRequest(
      `/conversations/${sessionId}/prompt-optimizations`,
      { method: "POST", body: JSON.stringify(input) },
      promptOptimizationSchema
    );
  },

  getPromptOptimization(sessionId: string, optimizationId: string) {
    return jsonRequest(
      `/conversations/${sessionId}/prompt-optimizations/${optimizationId}`,
      { method: "GET" },
      promptOptimizationSchema
    );
  },

  retryConversationMessage(sessionId: string, messageId: string, agentId: string) {
    return jsonRequest(
      `/conversations/${sessionId}/messages/${messageId}/retry?agentId=${encodeURIComponent(agentId)}`,
      { method: "POST" },
      createConversationMessageResponseSchema
    );
  },

  ensureCurrentProject() {
    return jsonRequest("/projects/current", { method: "PUT" }, projectSchema);
  },

  getImageModels() {
    return jsonRequest("/image-models", { method: "GET" }, imageModelListResponseSchema);
  },

  async uploadImage(projectId: string, file: File) {
    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("file", file);
    const response = await fetch(`${API_BASE_URL}/media-assets/images`, {
      method: "POST",
      body: formData
    });
    return parseJson(response, mediaAssetResponseSchema);
  },

  getMediaAssets(query: {
    keyword?: string;
    scope?: "all" | "favorites";
    folderId?: string;
    projectId?: string;
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    source?: "all" | "uploaded" | "generated";
    sort?: "newest" | "oldest";
    page?: number;
    pageSize?: number;
  }) {
    const search = new URLSearchParams();
    if (query.keyword) search.set("keyword", query.keyword);
    if (query.scope) search.set("scope", query.scope);
    if (query.folderId) search.set("folderId", query.folderId);
    if (query.projectId) search.set("projectId", query.projectId);
    if (query.date) search.set("date", query.date);
    if (query.dateFrom) search.set("dateFrom", query.dateFrom);
    if (query.dateTo) search.set("dateTo", query.dateTo);
    if (query.source) search.set("source", query.source);
    if (query.sort) search.set("sort", query.sort);
    if (query.page) search.set("page", String(query.page));
    if (query.pageSize) search.set("pageSize", String(query.pageSize));
    return jsonRequest(
      `/media-assets?${search.toString()}`,
      { method: "GET" },
      mediaAssetListResponseSchema
    );
  },

  getMediaAssetCalendar(query: {
    month: string;
    keyword?: string;
    scope?: "all" | "favorites";
    folderId?: string;
    projectId?: string;
    source?: "all" | "uploaded" | "generated";
  }) {
    const search = new URLSearchParams({ month: query.month });
    if (query.keyword) search.set("keyword", query.keyword);
    if (query.scope) search.set("scope", query.scope);
    if (query.folderId) search.set("folderId", query.folderId);
    if (query.projectId) search.set("projectId", query.projectId);
    if (query.source) search.set("source", query.source);
    return jsonRequest(
      `/media-assets/calendar?${search.toString()}`,
      { method: "GET" },
      mediaAssetCalendarResponseSchema
    );
  },

  renameMediaAsset(assetId: string, input: RenameMediaAssetRequest) {
    return voidRequest(`/media-assets/${assetId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" }
    });
  },

  favoriteMediaAsset(assetId: string, folderId: string | null) {
    return voidRequest(`/media-assets/${assetId}/favorite`, {
      method: "PUT",
      body: JSON.stringify({ folderId }),
      headers: { "content-type": "application/json" }
    });
  },

  unfavoriteMediaAsset(assetId: string) {
    return voidRequest(`/media-assets/${assetId}/favorite`, { method: "DELETE" });
  },

  deleteMediaAsset(assetId: string) {
    return voidRequest(`/media-assets/${assetId}`, { method: "DELETE" });
  },

  getAssetFolders() {
    return jsonRequest("/asset-folders", { method: "GET" }, assetFolderListResponseSchema);
  },

  createAssetFolder(input: CreateAssetFolderRequest) {
    return jsonRequest(
      "/asset-folders",
      { method: "POST", body: JSON.stringify(input) },
      assetFolderSchema
    );
  },

  renameAssetFolder(folderId: string, input: RenameAssetFolderRequest) {
    return jsonRequest(
      `/asset-folders/${folderId}`,
      { method: "PATCH", body: JSON.stringify(input) },
      assetFolderSchema
    );
  },

  deleteAssetFolder(folderId: string) {
    return voidRequest(`/asset-folders/${folderId}`, { method: "DELETE" });
  },

  getRequirement(requirementRunId: string) {
    return jsonRequest(
      `/requirements/${requirementRunId}`,
      { method: "GET" },
      resolveRequirementResponseSchema
    );
  },

  createImageGeneration(input: CreateImageGenerationRequest) {
    return jsonRequest(
      "/image-generations",
      { method: "POST", body: JSON.stringify(input) },
      createImageGenerationResponseSchema
    );
  },

  regenerateImageGenerationOutput(
    taskId: string,
    unitId: string,
    input: RegenerateImageGenerationOutputRequest
  ) {
    return jsonRequest(
      `/image-generations/${taskId}/outputs/${unitId}/regenerate`,
      { method: "POST", body: JSON.stringify(input) },
      regenerateImageGenerationOutputResponseSchema
    );
  },

  getImageGeneration(taskId: string) {
    return jsonRequest(
      `/image-generations/${taskId}`,
      { method: "GET" },
      imageGenerationTaskSchema
    );
  },

  cancelImageGeneration(taskId: string) {
    return jsonRequest(
      `/image-generations/${taskId}/cancel`,
      { method: "POST" },
      imageGenerationCancellationSchema
    );
  },

  getImageGenerationsForSession(sessionId: string, requirementRunIds: string[]) {
    const query = new URLSearchParams({
      sessionId,
      requirementRunIds: requirementRunIds.join(",")
    });
    return jsonRequest(
      `/image-generations?${query.toString()}`,
      { method: "GET" },
      imageGenerationTaskListResponseSchema
    );
  },

  getActiveImageGenerationForSession(sessionId: string) {
    return jsonRequest(
      `/image-generations/active?sessionId=${encodeURIComponent(sessionId)}`,
      { method: "GET" },
      activeImageGenerationResponseSchema
    );
  },

  imageGenerationEventsUrl(taskId: string) {
    return `${API_BASE_URL}/image-generations/${taskId}/events`;
  },

  getSubjectConsistencyChecks(taskId: string) {
    return jsonRequest(
      `/image-generations/${taskId}/subject-consistency-checks`,
      { method: "GET" },
      subjectConsistencyCheckSchema.array()
    );
  },

  getSubjectConsistencyCheck(checkId: string) {
    return jsonRequest(
      `/subject-consistency-checks/${checkId}`,
      { method: "GET" },
      subjectConsistencyCheckSchema
    );
  },

  subjectConsistencyEventsUrl(taskId: string) {
    return `${API_BASE_URL}/image-generations/${taskId}/subject-consistency-events`;
  },

  mediaContentUrl(assetId: string) {
    return `/api/media-assets/${encodeURIComponent(assetId)}/content`;
  }
};
