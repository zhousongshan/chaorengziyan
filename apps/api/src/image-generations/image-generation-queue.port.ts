export const IMAGE_GENERATION_QUEUE = Symbol("IMAGE_GENERATION_QUEUE");

export interface ImageGenerationQueue {
  enqueueUnit(taskId: string, unitId: string): Promise<void>;
  enqueue(taskId: string): Promise<void>;
  cancel(taskId: string, unitIds: string[]): Promise<void>;
}
