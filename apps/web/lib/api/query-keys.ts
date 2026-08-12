export const queryKeys = {
  agents: (query: {
    keyword: string;
    type: string;
    timeRange: string;
    page: number;
    pageSize: number;
  }) => ["agents", query] as const,
  agent: (agentId: string) => ["agents", agentId] as const,
  readiness: ["health", "ready"] as const,
  imageModels: ["image-models"] as const,
  projects: ["projects"] as const,
  activeProject: ["projects", "active"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  mediaAssets: (query: {
    keyword: string;
    scope: string;
    folderId?: string;
    projectId?: string;
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    source: string;
    sort: string;
    page: number;
    pageSize: number;
  }) => ["media-assets", query] as const,
  mediaAssetCalendar: (query: {
    month: string;
    keyword: string;
    scope: string;
    folderId?: string;
    projectId?: string;
    source: string;
  }) => ["media-assets", "calendar", query] as const,
  assetFolders: ["asset-folders"] as const,
  currentConversation: (agentId: string) => ["conversations", "current", agentId] as const,
  conversation: (sessionId: string, agentId: string) =>
    ["conversations", sessionId, "agent", agentId] as const,
  requirement: (requirementRunId: string) => ["requirements", requirementRunId] as const,
  promptOptimization: (sessionId: string, optimizationId: string) =>
    ["prompt-optimizations", sessionId, optimizationId] as const,
  generation: (taskId: string) => ["image-generations", taskId] as const,
  sessionGenerations: (sessionId: string, requirementRunIds: string[]) =>
    ["image-generations", "session", sessionId, { requirementRunIds }] as const,
  sessionGenerationsRoot: (sessionId: string) =>
    ["image-generations", "session", sessionId] as const,
  activeSessionGeneration: (sessionId: string) =>
    ["image-generations", "session", sessionId, "active"] as const,
  subjectChecks: (taskId: string) =>
    ["image-generations", taskId, "subject-consistency-checks"] as const
};
