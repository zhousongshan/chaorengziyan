import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const mediaKind = pgEnum("media_kind", ["image", "video"]);
export const mediaAssetOrigin = pgEnum("media_asset_origin", ["uploaded", "generated"]);
export const taskStatus = pgEnum("task_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
]);
export const creationRunStatus = pgEnum("creation_run_status", [
  "queued",
  "running",
  "cancelling",
  "terminal",
  "cancelled"
]);
export const subjectCheckStatus = pgEnum("subject_check_status", [
  "queued",
  "running",
  "completed",
  "source_unusable",
  "execution_failed",
  "cancelled"
]);
export const subjectCheckPhase = pgEnum("subject_check_phase", [
  "initial_inspection",
  "requirement_reconciliation",
  "repair_generation",
  "final_inspection"
]);
export const subjectCheckVerdict = pgEnum("subject_check_verdict", ["passed", "rejected"]);
export const conversationStatus = pgEnum("conversation_status", ["active", "archived"]);
export const conversationMessageRole = pgEnum("conversation_message_role", ["user", "assistant"]);
export const conversationMessageStatus = pgEnum("conversation_message_status", [
  "pending",
  "processing",
  "completed",
  "failed"
]);
export const conversationAssetRole = pgEnum("conversation_asset_role", [
  "product_source",
  "user_reference",
  "edit_base",
  "generated_result",
  "selected_result",
  "rejected_result"
]);
export const conversationMemoryStatus = pgEnum("conversation_memory_status", [
  "active",
  "superseded",
  "rejected",
  "historical"
]);
export const conversationTurnRunStatus = pgEnum("conversation_turn_run_status", [
  "queued",
  "processing",
  "completed",
  "failed"
]);
export const productEntityStatus = pgEnum("product_entity_status", ["active", "retired"]);
export const productEntityLineageStatus = pgEnum("product_entity_lineage_status", [
  "trusted",
  "legacy_unverified"
]);
export const generationOutputStatus = pgEnum("generation_output_status", [
  "candidate",
  "deliverable",
  "rejected",
  "superseded"
]);
export const promptOptimizationOperation = pgEnum("prompt_optimization_operation", [
  "optimize",
  "alternative",
  "revise"
]);
export const promptOptimizationStatus = pgEnum("prompt_optimization_status", [
  "processing",
  "succeeded",
  "failed"
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("projects_owner_default_uidx")
      .on(table.ownerUserId)
      .where(sql`${table.isDefault} = true`)
  ]
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    agentInstruction: text("agent_instruction").notNull().default(""),
    type: text("type").notNull().default("image"),
    mode: text("mode").notNull().default("intelligent"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("agents_owner_active_name_uidx")
      .on(
        table.ownerUserId,
        sql`lower(regexp_replace(btrim(${table.name}), '[[:space:]]+', ' ', 'g'))`
      )
      .where(sql`${table.ownerUserId} is not null and ${table.archivedAt} is null`),
    uniqueIndex("agents_system_active_name_uidx")
      .on(sql`lower(regexp_replace(btrim(${table.name}), '[[:space:]]+', ' ', 'g'))`)
      .where(sql`${table.ownerUserId} is null and ${table.archivedAt} is null`),
    index("agents_owner_user_id_idx").on(table.ownerUserId),
    index("agents_archived_at_idx").on(table.archivedAt),
    index("agents_created_at_idx").on(table.createdAt)
  ]
);

export const conversationSessions = pgTable(
  "conversation_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    mode: text("mode").notNull().default("image"),
    status: conversationStatus("status").notNull().default("active"),
    version: integer("version").notNull().default(0),
    processingMessageId: uuid("processing_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("conversation_sessions_user_agent_uidx")
      .on(table.userId, table.agentId)
      .where(sql`${table.agentId} is not null`),
    index("conversation_sessions_user_id_idx").on(table.userId),
    index("conversation_sessions_project_id_idx").on(table.projectId),
    index("conversation_sessions_user_agent_updated_idx").on(
      table.userId,
      table.agentId,
      table.updatedAt
    ),
    index("conversation_sessions_updated_at_idx").on(table.updatedAt)
  ]
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => conversationSessions.id, { onDelete: "cascade" }),
    turnNumber: integer("turn_number").notNull(),
    role: conversationMessageRole("role").notNull(),
    content: text("content").notNull(),
    status: conversationMessageStatus("status").notNull(),
    idempotencyKey: text("idempotency_key"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("conversation_messages_session_turn_role_uidx")
      .on(table.sessionId, table.turnNumber, table.role)
      .where(sql`${table.status} <> 'failed'`),
    uniqueIndex("conversation_messages_session_idempotency_uidx").on(
      table.sessionId,
      table.idempotencyKey
    ),
    index("conversation_messages_session_created_idx").on(table.sessionId, table.createdAt),
    index("conversation_messages_session_turn_idx").on(table.sessionId, table.turnNumber),
    index("conversation_messages_status_idx").on(table.status)
  ]
);

export const conversationTurnRuns = pgTable(
  "conversation_turn_runs",
  {
    messageId: uuid("message_id")
      .primaryKey()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => conversationSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    request: jsonb("request").notNull(),
    status: conversationTurnRunStatus("status").notNull().default("queued"),
    enqueueAttempts: integer("enqueue_attempts").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastEnqueueAttemptAt: timestamp("last_enqueue_attempt_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("conversation_turn_runs_status_updated_idx").on(table.status, table.updatedAt),
    index("conversation_turn_runs_status_lease_idx").on(table.status, table.leaseExpiresAt),
    index("conversation_turn_runs_session_id_idx").on(table.sessionId),
    index("conversation_turn_runs_user_id_idx").on(table.userId)
  ]
);

export const conversationStateSnapshots = pgTable(
  "conversation_state_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => conversationSessions.id, { onDelete: "cascade" }),
    sourceMessageId: uuid("source_message_id").references(() => conversationMessages.id, {
      onDelete: "set null"
    }),
    throughTurn: integer("through_turn").notNull(),
    version: integer("version").notNull(),
    state: jsonb("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("conversation_snapshots_session_version_uidx").on(table.sessionId, table.version),
    index("conversation_snapshots_session_turn_idx").on(table.sessionId, table.throughTurn)
  ]
);

export const conversationMemoryEntries = pgTable(
  "conversation_memory_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => conversationSessions.id, { onDelete: "cascade" }),
    sourceMessageId: uuid("source_message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    turnNumber: integer("turn_number").notNull(),
    memoryType: text("memory_type").notNull(),
    content: text("content").notNull(),
    structuredData: jsonb("structured_data").notNull().default({}),
    status: conversationMemoryStatus("status").notNull().default("active"),
    searchText: text("search_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("conversation_memory_session_turn_idx").on(table.sessionId, table.turnNumber),
    index("conversation_memory_source_message_idx").on(table.sourceMessageId),
    index("conversation_memory_status_idx").on(table.status)
  ]
);

export const requirementRuns = pgTable(
  "requirement_runs",
  {
    id: uuid("id").primaryKey(),
    parentRequirementRunId: uuid("parent_requirement_run_id").references(
      (): AnyPgColumn => requirementRuns.id
    ),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    sessionId: uuid("session_id").references(() => conversationSessions.id, {
      onDelete: "set null"
    }),
    sourceMessageId: uuid("source_message_id").references(() => conversationMessages.id, {
      onDelete: "set null"
    }),
    stateSnapshotId: uuid("state_snapshot_id").references(() => conversationStateSnapshots.id, {
      onDelete: "set null"
    }),
    request: jsonb("request").notNull(),
    result: jsonb("result").notNull(),
    executionPlan: jsonb("execution_plan"),
    executionPlanHash: text("execution_plan_hash"),
    aiModel: text("ai_model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("requirement_runs_parent_id_idx").on(table.parentRequirementRunId),
    index("requirement_runs_user_id_idx").on(table.userId),
    index("requirement_runs_project_id_idx").on(table.projectId),
    index("requirement_runs_session_id_idx").on(table.sessionId)
  ]
);

export const requirementAiAttempts = pgTable(
  "requirement_ai_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => conversationSessions.id, { onDelete: "cascade" }),
    sourceMessageId: uuid("source_message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull(),
    rawOutput: jsonb("raw_output").notNull(),
    validationIssues: jsonb("validation_issues").notNull().default([]),
    aiModel: text("ai_model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    contractVersion: text("contract_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("requirement_ai_attempts_session_id_idx").on(table.sessionId),
    index("requirement_ai_attempts_source_message_id_idx").on(table.sourceMessageId)
  ]
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    kind: mediaKind("kind").notNull(),
    origin: mediaAssetOrigin("origin").notNull().default("uploaded"),
    contentSha256: text("content_sha256"),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    originalFileName: text("original_file_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("media_assets_user_id_idx").on(table.userId),
    index("media_assets_user_kind_created_idx").on(table.userId, table.kind, table.createdAt),
    index("media_assets_project_id_idx").on(table.projectId),
    uniqueIndex("media_assets_uploaded_content_uidx")
      .on(table.userId, table.projectId, table.kind, table.contentSha256)
      .where(sql`${table.origin} = 'uploaded' and ${table.contentSha256} is not null`),
    uniqueIndex("media_assets_storage_key_uidx").on(table.storageKey)
  ]
);

export const promptOptimizations = pgTable(
  "prompt_optimizations",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => conversationSessions.id, { onDelete: "cascade" }),
    parentOptimizationId: uuid("parent_optimization_id").references(
      (): AnyPgColumn => promptOptimizations.id,
      { onDelete: "restrict" }
    ),
    operation: promptOptimizationOperation("operation").notNull(),
    status: promptOptimizationStatus("status").notNull().default("processing"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    executionToken: uuid("execution_token").notNull(),
    originalText: text("original_text").notNull(),
    optimizedText: text("optimized_text"),
    revisionInstruction: text("revision_instruction"),
    inputRevision: jsonb("input_revision").notNull(),
    aiModel: text("ai_model"),
    promptVersion: text("prompt_version"),
    errorCode: text("error_code"),
    adoptedMessageId: uuid("adopted_message_id").references(() => conversationMessages.id, {
      onDelete: "set null"
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("prompt_optimizations_user_idempotency_uidx").on(
      table.userId,
      table.idempotencyKey
    ),
    uniqueIndex("prompt_optimizations_adopted_message_uidx")
      .on(table.adoptedMessageId)
      .where(sql`${table.adoptedMessageId} is not null`),
    index("prompt_optimizations_session_created_idx").on(table.sessionId, table.createdAt),
    index("prompt_optimizations_parent_id_idx").on(table.parentOptimizationId),
    index("prompt_optimizations_status_updated_idx").on(table.status, table.updatedAt)
  ]
);

export const promptOptimizationAssets = pgTable(
  "prompt_optimization_assets",
  {
    optimizationId: uuid("optimization_id")
      .notNull()
      .references(() => promptOptimizations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    role: conversationAssetRole("role").notNull(),
    position: integer("position").notNull(),
    relation: text("relation")
  },
  (table) => [
    primaryKey({ columns: [table.optimizationId, table.position] }),
    uniqueIndex("prompt_optimization_assets_asset_role_uidx").on(
      table.optimizationId,
      table.assetId,
      table.role
    ),
    index("prompt_optimization_assets_asset_id_idx").on(table.assetId)
  ]
);

export const productEntities = pgTable(
  "product_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label"),
    status: productEntityStatus("status").notNull().default("active"),
    lineageStatus: productEntityLineageStatus("lineage_status").notNull().default("trusted"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("product_entities_user_id_idx").on(table.userId),
    index("product_entities_project_id_idx").on(table.projectId),
    index("product_entities_project_status_idx").on(table.projectId, table.status)
  ]
);

export const productEntitySources = pgTable(
  "product_entity_sources",
  {
    productEntityId: uuid("product_entity_id")
      .notNull()
      .references(() => productEntities.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    position: integer("position").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.productEntityId, table.position] }),
    uniqueIndex("product_entity_sources_entity_asset_uidx").on(
      table.productEntityId,
      table.assetId
    ),
    index("product_entity_sources_asset_id_idx").on(table.assetId)
  ]
);

export const assetFolders = pgTable(
  "asset_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("asset_folders_user_name_uidx").on(table.userId, table.name),
    index("asset_folders_user_updated_idx").on(table.userId, table.updatedAt)
  ]
);

export const mediaAssetLibraryEntries = pgTable(
  "media_asset_library_entries",
  {
    assetId: uuid("asset_id")
      .primaryKey()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    displayName: text("display_name"),
    folderId: uuid("folder_id").references(() => assetFolders.id, { onDelete: "set null" }),
    favoritedAt: timestamp("favorited_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("media_asset_library_user_idx").on(table.userId),
    index("media_asset_library_folder_idx").on(table.folderId),
    index("media_asset_library_favorited_idx").on(table.userId, table.favoritedAt),
    index("media_asset_library_hidden_idx").on(table.userId, table.hiddenAt)
  ]
);

export const conversationMessageAssets = pgTable(
  "conversation_message_assets",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id),
    role: conversationAssetRole("role").notNull(),
    position: integer("position").notNull(),
    relation: text("relation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.position] }),
    uniqueIndex("conversation_message_assets_message_asset_role_uidx").on(
      table.messageId,
      table.assetId,
      table.role
    ),
    index("conversation_message_assets_asset_id_idx").on(table.assetId)
  ]
);

export const assetVisualMemories = pgTable(
  "asset_visual_memories",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => conversationSessions.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    assetRole: conversationAssetRole("asset_role").notNull(),
    caption: text("caption").notNull(),
    ocrText: text("ocr_text"),
    productFacts: jsonb("product_facts").notNull().default({}),
    creativeFacts: jsonb("creative_facts").notNull().default({}),
    analysisModel: text("analysis_model").notNull(),
    analysisVersion: text("analysis_version").notNull(),
    status: text("status").notNull().default("ready"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.assetId] }),
    index("asset_visual_memories_asset_id_idx").on(table.assetId)
  ]
);

export const creationRuns = pgTable(
  "creation_runs",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    sessionId: uuid("session_id").references(() => conversationSessions.id, {
      onDelete: "set null"
    }),
    requirementRunId: uuid("requirement_run_id")
      .notNull()
      .references(() => requirementRuns.id),
    status: creationRunStatus("status").notNull().default("queued"),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelRequestedBy: uuid("cancel_requested_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("creation_runs_user_id_idx").on(table.userId),
    index("creation_runs_project_id_idx").on(table.projectId),
    index("creation_runs_session_id_idx").on(table.sessionId),
    index("creation_runs_status_idx").on(table.status)
  ]
);

export const workflowEvents = pgTable(
  "workflow_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => creationRuns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    attemptNumber: integer("attempt_number"),
    payload: jsonb("payload").notNull().default({}),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishAttempts: integer("publish_attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("workflow_events_run_sequence_uidx").on(table.runId, table.sequence),
    index("workflow_events_pending_idx").on(table.publishedAt, table.availableAt),
    index("workflow_events_entity_idx").on(table.entityType, table.entityId)
  ]
);

export const generationTasks = pgTable(
  "generation_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creationRunId: uuid("creation_run_id")
      .notNull()
      .references(() => creationRuns.id),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    requirementRunId: uuid("requirement_run_id")
      .notNull()
      .references(() => requirementRuns.id),
    sessionId: uuid("session_id").references(() => conversationSessions.id, {
      onDelete: "set null"
    }),
    stateSnapshotId: uuid("state_snapshot_id").references(() => conversationStateSnapshots.id, {
      onDelete: "set null"
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    kind: mediaKind("kind").notNull(),
    modelId: text("model_id").notNull(),
    instruction: text("instruction").notNull(),
    instructionVersion: text("instruction_version").notNull(),
    status: taskStatus("status").notNull().default("queued"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("generation_tasks_user_id_idx").on(table.userId),
    index("generation_tasks_creation_run_id_idx").on(table.creationRunId),
    index("generation_tasks_project_id_idx").on(table.projectId),
    index("generation_tasks_requirement_run_id_idx").on(table.requirementRunId),
    index("generation_tasks_session_id_idx").on(table.sessionId),
    index("generation_tasks_status_idx").on(table.status),
    uniqueIndex("generation_tasks_user_idempotency_uidx").on(table.userId, table.idempotencyKey)
  ]
);

export const generationTaskUnits = pgTable(
  "generation_task_units",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => generationTasks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    groupPosition: integer("group_position").notNull(),
    variantPosition: integer("variant_position").notNull(),
    outputLayout: text("output_layout").notNull(),
    instruction: text("instruction"),
    status: taskStatus("status").notNull().default("queued"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("generation_task_units_task_position_uidx").on(table.taskId, table.position),
    index("generation_task_units_task_id_idx").on(table.taskId),
    index("generation_task_units_status_idx").on(table.status)
  ]
);

export const generationTaskRegenerations = pgTable(
  "generation_task_regenerations",
  {
    taskId: uuid("task_id")
      .primaryKey()
      .references(() => generationTasks.id, { onDelete: "cascade" }),
    sourceTaskId: uuid("source_task_id")
      .notNull()
      .references(() => generationTasks.id),
    sourceUnitId: uuid("source_unit_id")
      .notNull()
      .references(() => generationTaskUnits.id),
    sourceAssetId: uuid("source_asset_id")
      .notNull()
      .references(() => mediaAssets.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("generation_regenerations_source_task_idx").on(table.sourceTaskId),
    index("generation_regenerations_source_unit_idx").on(table.sourceUnitId),
    index("generation_regenerations_source_asset_idx").on(table.sourceAssetId)
  ]
);

export const generationTaskOutputs = pgTable(
  "generation_task_outputs",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => generationTasks.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id),
    unitId: uuid("unit_id").references(() => generationTaskUnits.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    status: generationOutputStatus("status").notNull().default("candidate"),
    deliverableAssetId: uuid("deliverable_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null"
    }),
    supersededByAssetId: uuid("superseded_by_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null"
    }),
    rejectionCode: text("rejection_code"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.position] }),
    uniqueIndex("generation_task_outputs_task_asset_uidx").on(table.taskId, table.assetId),
    uniqueIndex("generation_task_outputs_unit_id_uidx").on(table.unitId),
    index("generation_task_outputs_asset_id_idx").on(table.assetId),
    index("generation_task_outputs_deliverable_asset_id_idx").on(table.deliverableAssetId),
    index("generation_task_outputs_status_idx").on(table.status)
  ]
);

export const generationTaskUnitSources = pgTable(
  "generation_task_unit_sources",
  {
    unitId: uuid("unit_id")
      .notNull()
      .references(() => generationTaskUnits.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id),
    position: integer("position").notNull(),
    sourceRole: text("source_role").notNull(),
    usage: text("usage").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.unitId, table.position] }),
    index("generation_task_unit_sources_asset_id_idx").on(table.assetId)
  ]
);

export const generationTaskUnitQualitySources = pgTable(
  "generation_task_unit_quality_sources",
  {
    unitId: uuid("unit_id")
      .notNull()
      .references(() => generationTaskUnits.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id),
    position: integer("position").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.unitId, table.position] }),
    uniqueIndex("generation_task_unit_quality_sources_unit_asset_uidx").on(
      table.unitId,
      table.assetId
    ),
    index("generation_task_unit_quality_sources_asset_id_idx").on(table.assetId)
  ]
);

export const generationUnitSubjectEntities = pgTable(
  "generation_unit_subject_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productEntityId: uuid("product_entity_id").references(() => productEntities.id, {
      onDelete: "restrict"
    }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => generationTaskUnits.id, { onDelete: "cascade" }),
    entityKey: text("entity_key").notNull(),
    label: text("label"),
    position: integer("position").notNull()
  },
  (table) => [
    uniqueIndex("generation_unit_subject_entities_unit_key_uidx").on(table.unitId, table.entityKey),
    uniqueIndex("generation_unit_subject_entities_unit_product_uidx").on(
      table.unitId,
      table.productEntityId
    ),
    uniqueIndex("generation_unit_subject_entities_unit_position_uidx").on(
      table.unitId,
      table.position
    )
  ]
);

export const generationUnitSubjectEntitySources = pgTable(
  "generation_unit_subject_entity_sources",
  {
    entityId: uuid("entity_id")
      .notNull()
      .references(() => generationUnitSubjectEntities.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id),
    position: integer("position").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.entityId, table.position] }),
    uniqueIndex("generation_unit_subject_entity_sources_entity_asset_uidx").on(
      table.entityId,
      table.assetId
    ),
    index("generation_unit_subject_entity_sources_asset_id_idx").on(table.assetId)
  ]
);

export const generationUnitAttempts = pgTable(
  "generation_unit_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => generationTaskUnits.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull(),
    providerRequestId: text("provider_request_id"),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    providerCancellationStatus: text("provider_cancellation_status"),
    lateResultDiscardedAt: timestamp("late_result_discarded_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    failureStage: text("failure_stage"),
    errorDetails: jsonb("error_details").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("generation_unit_attempts_unit_number_uidx").on(table.unitId, table.attemptNumber),
    index("generation_unit_attempts_unit_id_idx").on(table.unitId),
    index("generation_unit_attempts_status_idx").on(table.status)
  ]
);

export const subjectConsistencyChecks = pgTable(
  "subject_consistency_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    generationTaskId: uuid("generation_task_id")
      .notNull()
      .references(() => generationTasks.id, { onDelete: "cascade" }),
    generationUnitId: uuid("generation_unit_id").references(() => generationTaskUnits.id, {
      onDelete: "set null"
    }),
    requirementRunId: uuid("requirement_run_id")
      .notNull()
      .references(() => requirementRuns.id),
    generatedAssetId: uuid("generated_asset_id")
      .notNull()
      .references(() => mediaAssets.id),
    deliverableAssetId: uuid("deliverable_asset_id").references(() => mediaAssets.id),
    status: subjectCheckStatus("status").notNull().default("queued"),
    phase: subjectCheckPhase("phase").notNull().default("initial_inspection"),
    verdict: subjectCheckVerdict("verdict"),
    reconciliation: jsonb("reconciliation"),
    userMessage: text("user_message"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    inspectionModel: text("inspection_model").notNull(),
    requirementModel: text("requirement_model").notNull(),
    workflowVersion: text("workflow_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("subject_checks_output_workflow_uidx").on(
      table.generationTaskId,
      table.generatedAssetId,
      table.workflowVersion
    ),
    index("subject_checks_user_id_idx").on(table.userId),
    index("subject_checks_project_id_idx").on(table.projectId),
    index("subject_checks_generation_task_id_idx").on(table.generationTaskId),
    index("subject_checks_generation_unit_id_idx").on(table.generationUnitId),
    index("subject_checks_generated_asset_id_idx").on(table.generatedAssetId),
    index("subject_checks_deliverable_asset_id_idx").on(table.deliverableAssetId),
    index("subject_checks_status_idx").on(table.status)
  ]
);

export const subjectConsistencyCheckSources = pgTable(
  "subject_consistency_check_sources",
  {
    checkId: uuid("check_id")
      .notNull()
      .references(() => subjectConsistencyChecks.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id),
    position: integer("position").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.checkId, table.position] }),
    uniqueIndex("subject_check_sources_check_asset_uidx").on(table.checkId, table.assetId),
    index("subject_check_sources_asset_id_idx").on(table.assetId)
  ]
);

export const subjectConsistencyAttempts = pgTable(
  "subject_consistency_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => subjectConsistencyChecks.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    generationTaskId: uuid("generation_task_id").references(() => generationTasks.id, {
      onDelete: "set null"
    }),
    generatedAssetId: uuid("generated_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null"
    }),
    requirementSnapshot: jsonb("requirement_snapshot").notNull(),
    result: jsonb("result").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("subject_attempts_check_round_uidx").on(table.checkId, table.round),
    index("subject_attempts_check_id_idx").on(table.checkId)
  ]
);

export const subjectConsistencyRepairs = pgTable(
  "subject_consistency_repairs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => subjectConsistencyChecks.id, { onDelete: "cascade" }),
    requirementRunId: uuid("requirement_run_id")
      .notNull()
      .references(() => requirementRuns.id),
    generationTaskId: uuid("generation_task_id")
      .notNull()
      .references(() => generationTasks.id, { onDelete: "cascade" }),
    generatedAssetId: uuid("generated_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null"
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("subject_repairs_check_id_uidx").on(table.checkId),
    uniqueIndex("subject_repairs_generation_task_id_uidx").on(table.generationTaskId),
    index("subject_repairs_generated_asset_id_idx").on(table.generatedAssetId)
  ]
);
