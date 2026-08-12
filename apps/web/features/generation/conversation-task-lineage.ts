import type { ConversationHistoryResponse } from "@chaoren/contracts";

export function findGenerationTurnNumber(
  history: Pick<ConversationHistoryResponse, "messages" | "requirementRuns"> | undefined,
  requirementRunId: string | undefined
): number | null {
  if (!history || !requirementRunId) return null;
  const sourceMessageId = history.requirementRuns.find(
    (run) => run.requirementRunId === requirementRunId
  )?.sourceMessageId;
  if (!sourceMessageId) return null;
  return history.messages.find((message) => message.id === sourceMessageId)?.turnNumber ?? null;
}
