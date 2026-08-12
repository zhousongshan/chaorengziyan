import type { ConversationHistoryResponse, ConversationMessage } from "@chaoren/contracts";

type RecoveryMessage = Pick<ConversationMessage, "id" | "role" | "status" | "turnNumber">;

export function recoverLatestCompletedTurnRequirement(input: {
  sessionVersion: number;
  processingMessageId: string | null;
  messages: RecoveryMessage[];
  latestRequirementRun: ConversationHistoryResponse["latestRequirementRun"];
}): ConversationHistoryResponse["latestRequirementRun"] {
  if (input.processingMessageId || !input.latestRequirementRun) return null;
  const latestUserMessage = input.messages.find(
    (message) =>
      message.role === "user" &&
      message.status === "completed" &&
      message.turnNumber === input.sessionVersion
  );
  return input.latestRequirementRun.sourceMessageId === latestUserMessage?.id
    ? input.latestRequirementRun
    : null;
}
