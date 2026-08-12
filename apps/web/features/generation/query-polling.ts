import type { ImageGenerationTask } from "@chaoren/contracts";

export function readinessPollingInterval(status: "ready" | "not_ready" | undefined) {
  return status === "ready" ? 30_000 : 5_000;
}

export function conversationPollingInterval(processingMessageId: string | null | undefined) {
  return processingMessageId ? 1_500 : false;
}

export function activeGenerationPollingInterval(
  task: Pick<ImageGenerationTask, "status" | "workflowStatus"> | null | undefined
) {
  // The active endpoint is authoritative about creation-run activity. Its task can already
  // serialize as terminal during the short window before the creation run itself is finalized.
  return task ? 3_000 : false;
}
