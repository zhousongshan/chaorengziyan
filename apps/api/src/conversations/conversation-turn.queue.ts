export const CONVERSATION_TURN_QUEUE = Symbol("CONVERSATION_TURN_QUEUE");

export interface ConversationTurnQueue {
  enqueue(messageId: string): Promise<void>;
}
