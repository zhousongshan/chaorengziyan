import { apiClient } from "./client";
import { queryKeys } from "./query-keys";

export const activeProjectQueryOptions = {
  queryKey: queryKeys.activeProject,
  queryFn: () => apiClient.ensureCurrentProject(),
  staleTime: 5 * 60_000
} as const;
