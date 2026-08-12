import type { ImageGenerationTask } from "@chaoren/contracts";

type GenerationOutput = NonNullable<ImageGenerationTask["outputs"]>[number];

export type HistoricalGenerationResult = {
  taskId: string;
  modelId: string;
  regenerated: boolean;
  output: GenerationOutput;
};

type HistoricalGenerationTask = Pick<
  ImageGenerationTask,
  "taskId" | "modelId" | "outputs" | "regeneratedFrom"
>;

export function indexHistoricalGenerationResults(
  tasks: HistoricalGenerationTask[]
): Map<string, HistoricalGenerationResult> {
  const indexed = new Map<string, HistoricalGenerationResult>();
  const ambiguousAssetIds = new Set<string>();

  for (const task of tasks) {
    for (const output of task.outputs ?? []) {
      const assetId = output.deliverableAsset?.id;
      if (!assetId || ambiguousAssetIds.has(assetId)) continue;

      const result = {
        taskId: task.taskId,
        modelId: task.modelId,
        regenerated: Boolean(task.regeneratedFrom),
        output
      };
      const existing = indexed.get(assetId);
      if (!existing) {
        indexed.set(assetId, result);
        continue;
      }

      if (existing.taskId !== result.taskId || existing.output.unitId !== result.output.unitId) {
        indexed.delete(assetId);
        ambiguousAssetIds.add(assetId);
      }
    }
  }

  return indexed;
}
