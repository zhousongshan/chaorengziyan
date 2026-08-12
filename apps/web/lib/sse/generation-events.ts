import {
  imageGenerationEventSchema,
  subjectConsistencyWorkflowEventSchema,
  type ImageGenerationEvent,
  type SubjectConsistencyWorkflowEvent
} from "@chaoren/contracts";
import type { z } from "zod";

export function openGenerationEventStream(
  url: string,
  onEvent: (event: ImageGenerationEvent) => void,
  onConnectionError: () => void
) {
  return openValidatedEventStream(url, imageGenerationEventSchema, onEvent, onConnectionError);
}

export function openSubjectConsistencyEventStream(
  url: string,
  onEvent: (event: SubjectConsistencyWorkflowEvent) => void,
  onConnectionError: () => void
) {
  return openValidatedEventStream(
    url,
    subjectConsistencyWorkflowEventSchema,
    onEvent,
    onConnectionError
  );
}

function openValidatedEventStream<T>(
  url: string,
  schema: z.ZodType<T>,
  onEvent: (event: T) => void,
  onConnectionError: () => void
) {
  const source = new EventSource(url);
  source.onmessage = (message) => {
    try {
      const raw: unknown = JSON.parse(String(message.data));
      const result = schema.safeParse(raw);
      if (result.success) onEvent(result.data);
    } catch {
      onConnectionError();
    }
  };
  source.onerror = onConnectionError;
  return () => source.close();
}
