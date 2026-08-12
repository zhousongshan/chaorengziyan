import type {
  ConversationHistoryResponse,
  ConversationMessage,
  ConversationMessagePageInfo,
  ConversationMessagesPageResponse,
  ConversationRequirementRun
} from "@chaoren/contracts";

export interface LoadedConversationHistory {
  sessionId: string;
  messages: ConversationMessage[];
  requirementRuns: ConversationRequirementRun[];
  messagePage: ConversationMessagePageInfo;
  olderPageLoaded: boolean;
}

export function mergeLatestConversationHistory(
  current: LoadedConversationHistory | null,
  latest: ConversationHistoryResponse
): LoadedConversationHistory {
  if (!current || current.sessionId !== latest.session.id) {
    return {
      sessionId: latest.session.id,
      messages: latest.messages,
      requirementRuns: latest.requirementRuns,
      messagePage: latest.messagePage,
      olderPageLoaded: false
    };
  }
  return {
    ...current,
    messages: mergeMessages(current.messages, latest.messages),
    requirementRuns: mergeRequirementRuns(current.requirementRuns, latest.requirementRuns),
    messagePage: current.olderPageLoaded ? current.messagePage : latest.messagePage
  };
}

export function mergeOlderConversationHistory(
  current: LoadedConversationHistory,
  older: ConversationMessagesPageResponse
): LoadedConversationHistory {
  return {
    ...current,
    messages: mergeMessages(current.messages, older.messages),
    requirementRuns: mergeRequirementRuns(current.requirementRuns, older.requirementRuns),
    messagePage: older.messagePage,
    olderPageLoaded: true
  };
}

function mergeMessages(current: ConversationMessage[], incoming: ConversationMessage[]) {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort(
    (left, right) =>
      left.turnNumber - right.turnNumber || left.createdAt.localeCompare(right.createdAt)
  );
}

function mergeRequirementRuns(
  current: ConversationRequirementRun[],
  incoming: ConversationRequirementRun[]
) {
  const runs = new Map(current.map((run) => [run.requirementRunId, run]));
  for (const run of incoming) runs.set(run.requirementRunId, run);
  return [...runs.values()];
}
