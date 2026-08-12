import type {
  ConversationHistoryResponse,
  CreateConversationMessageResponse
} from "@chaoren/contracts";

export function mergeAcceptedConversationTurn(
  history: ConversationHistoryResponse | undefined,
  response: CreateConversationMessageResponse
): ConversationHistoryResponse | undefined {
  if (!history || history.session.id !== response.session.id) return history;
  const alreadyPresent = history.messages.some((message) => message.id === response.userMessage.id);
  return {
    ...history,
    session: response.session,
    messages: alreadyPresent ? history.messages : [...history.messages, response.userMessage]
  };
}
