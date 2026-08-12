import type {
  GenerationOutputLayout,
  GenerationSourceUsage,
  ResolvedGenerationPlan,
  ImageGenerationError,
  ImageGenerationStatus,
  MediaAssetResponse,
  SubjectConsistencyPhase,
  SubjectConsistencyStatus
} from "@chaoren/contracts";

import type { RequirementRunRecord } from "../requirements/requirement-run.repository.js";

export const IMAGE_GENERATION_TASK_REPOSITORY = Symbol("IMAGE_GENERATION_TASK_REPOSITORY");

export interface ImageGenerationUnitRecord {
  unitId: string;
  position: number;
  groupPosition: number;
  variantPosition: number;
  outputLayout: GenerationOutputLayout;
  instruction: string | null;
  status?: ImageGenerationStatus;
  attemptCount?: number;
  stageStartedAt?: string;
  completedAt?: string | null;
  qualitySourceAssetIds: string[];
  subjectEntities?: Array<{
    entityKey: string;
    label: string | null;
    productEntityId: string | null;
    lineageKind: "new_product_source" | "inherited_product_entity" | "legacy_unverified";
    inheritedFromAssetId: string | null;
    sourceAssetIds: string[];
  }>;
  generatedAsset?: MediaAssetResponse | null;
  deliverableAsset?: MediaAssetResponse | null;
  subjectConsistencyStatus?: SubjectConsistencyStatus | null;
  subjectConsistencyPhase?: SubjectConsistencyPhase | null;
  error?: ImageGenerationError | null;
  sources: Array<{
    assetId: string;
    sourceRole: ResolvedGenerationPlan["groups"][number]["sourceImages"][number]["sourceRole"];
    usage: GenerationSourceUsage;
    position: number;
  }>;
}

export interface ImageGenerationTaskRecord {
  taskId: string;
  userId: string;
  requirementRunId: string;
  sessionId?: string | null;
  stateSnapshotId?: string | null;
  idempotencyKey: string;
  projectId: string;
  modelId: string;
  instruction: string;
  instructionVersion: string;
  status: ImageGenerationStatus;
  lifecycleStatus?: "queued" | "running" | "cancelling" | "terminal" | "cancelled";
  lifecycleUpdatedAt?: string;
  resultAssets: MediaAssetResponse[];
  error: ImageGenerationError | null;
  createdAt: string;
  updatedAt: string;
  units?: ImageGenerationUnitRecord[];
  requestedOutputCount?: number;
  unitFailures?: Array<{ position: number; code: string; message: string }>;
  regeneratedFrom?: {
    taskId: string;
    unitId: string;
    assetId: string;
  } | null;
}

export interface ImageGenerationRegenerationRecord {
  requirementRun: RequirementRunRecord;
  task: ImageGenerationTaskRecord & {
    regeneratedFrom: NonNullable<ImageGenerationTaskRecord["regeneratedFrom"]>;
  };
}

export interface ImageGenerationTaskRepository {
  createOrFind(record: ImageGenerationTaskRecord): Promise<{
    record: ImageGenerationTaskRecord;
    created: boolean;
  }>;
  createRegenerationOrFind(record: ImageGenerationRegenerationRecord): Promise<{
    record: ImageGenerationTaskRecord;
    created: boolean;
  }>;
  findById(id: string): Promise<ImageGenerationTaskRecord | undefined>;
  findByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<ImageGenerationTaskRecord | undefined>;
  findBySessionId(
    sessionId: string,
    userId: string,
    requirementRunIds: string[]
  ): Promise<ImageGenerationTaskRecord[]>;
  findActiveBySessionId(
    sessionId: string,
    userId: string
  ): Promise<ImageGenerationTaskRecord | undefined>;
  findRecoverableUnits(): Promise<Array<{ taskId: string; unitId: string }>>;
  findRecoverableLegacyTaskIds(): Promise<string[]>;
  cancel(
    id: string,
    userId: string
  ): Promise<{
    cancelled: boolean;
    unitIds: string[];
    relatedTasks: Array<{ taskId: string; unitIds: string[] }>;
    hadRunningAttempt: boolean;
  }>;
  markUnitFailed(unitId: string, error: ImageGenerationError): Promise<void>;
  markFailed(id: string, error: ImageGenerationError): Promise<void>;
  claimPendingDispatches?(
    limit: number
  ): Promise<Array<{ eventId: string; eventType: string; taskId: string; unitId?: string }>>;
  markDispatchPublished?(eventId: string): Promise<void>;
  markDispatchFailed?(eventId: string, error: string): Promise<void>;
}

export class InvalidQualityEntityLineageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidQualityEntityLineageError";
  }
}

export class ActiveImageGenerationExistsError extends Error {
  public constructor() {
    super("当前会话已有图片任务正在执行");
    this.name = "ActiveImageGenerationExistsError";
  }
}

export class ImageGenerationIdempotencyConflictError extends Error {
  public constructor() {
    super("同一个幂等键不能用于不同的生图请求");
    this.name = "ImageGenerationIdempotencyConflictError";
  }
}

export class ImageGenerationRegenerationSourceNotFoundError extends Error {
  public constructor() {
    super("再次生成的来源任务或执行单元不存在");
    this.name = "ImageGenerationRegenerationSourceNotFoundError";
  }
}

export class ImageGenerationRegenerationSourceNotReadyError extends Error {
  public constructor() {
    super("再次生成的来源结果尚未完成");
    this.name = "ImageGenerationRegenerationSourceNotReadyError";
  }
}

export class ImageGenerationRegenerationSourceChangedError extends Error {
  public constructor() {
    super("再次生成的来源成品已经发生变化");
    this.name = "ImageGenerationRegenerationSourceChangedError";
  }
}

export class InvalidImageGenerationTaskTransitionError extends Error {
  public constructor(taskId: string) {
    super(`生图任务状态不允许本次更新: ${taskId}`);
    this.name = "InvalidImageGenerationTaskTransitionError";
  }
}
