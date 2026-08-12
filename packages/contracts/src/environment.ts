import { z } from "zod";

export const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().url().default("http://127.0.0.1:3000"),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  OUTBOUND_HTTP_PROXY_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url().optional()
  ),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  TASK_QUEUE_NAME: z.string().min(1).default("media-generation"),
  CONVERSATION_QUEUE_NAME: z.string().min(1).default("conversation-turns"),
  CONVERSATION_DISPATCH_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  CONVERSATION_TURN_STALE_MS: z.coerce.number().int().positive().default(180_000),
  CONVERSATION_TURN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),
  SUBJECT_INSPECTION_QUEUE_NAME: z.string().min(1).default("subject-consistency"),
  STORAGE_DRIVER: z.literal("local").default("local"),
  LOCAL_STORAGE_ROOT: z.string().min(1).default("./.local-data/media"),
  AUTHORIZATION_DRIVER: z.literal("development").default("development"),
  LOCAL_USER_ID: z.uuid().default("00000000-0000-4000-8000-000000000001"),
  REQUIREMENT_AI_BASE_URL: z.url().default("https://jennyapi.site/v1"),
  REQUIREMENT_AI_API_KEY: z.string().optional(),
  REQUIREMENT_AI_MODEL: z.string().min(1).default("gpt-5.6-sol"),
  REQUIREMENT_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  PROMPT_OPTIMIZATION_AI_BASE_URL: z.url().optional(),
  PROMPT_OPTIMIZATION_AI_API_KEY: z.string().optional(),
  PROMPT_OPTIMIZATION_AI_MODEL: z.string().min(1).optional(),
  PROMPT_OPTIMIZATION_AI_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  SUBJECT_INSPECTION_AI_BASE_URL: z.url().default("https://jennyapi.site/v1"),
  SUBJECT_INSPECTION_AI_API_KEY: z.string().optional(),
  SUBJECT_INSPECTION_AI_MODEL: z.string().min(1).default("gpt-5.6-sol"),
  SUBJECT_INSPECTION_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  SUBJECT_INSPECTION_WORKER_CONCURRENCY: z.coerce.number().int().positive().max(32).default(2),
  SUBJECT_INSPECTION_JOB_ATTEMPTS: z.coerce.number().int().positive().max(10).default(2),
  SUBJECT_INSPECTION_JOB_BACKOFF_MS: z.coerce.number().int().positive().default(2_000),
  CONVERSATION_RECENT_FULL_TURNS: z.coerce.number().int().min(20).max(100).default(20),
  CONVERSATION_MAX_CONTEXT_CHARACTERS: z.coerce.number().int().positive().default(240_000),
  CONVERSATION_MAX_CONTEXT_TOKENS: z.coerce.number().int().positive().default(120_000),
  CONVERSATION_IMAGE_TOKEN_ESTIMATE: z.coerce.number().int().positive().default(4_000),
  OPENAI_IMAGE_BASE_URL: z.url().default("https://api.openai.com/v1"),
  OPENAI_IMAGE_API_KEY: z.string().optional(),
  OPENAI_IMAGE_MODEL: z.string().min(1).default("gpt-image-2"),
  OPENAI_IMAGE_API_MODE: z.enum(["official", "async-relay"]).default("official"),
  BYTEDANCE_IMAGE_BASE_URL: z.url().default("https://ark.cn-beijing.volces.com/api/v3"),
  BYTEDANCE_IMAGE_API_KEY: z.string().optional(),
  BYTEDANCE_IMAGE_MODEL: z.string().optional(),
  IMAGE_GENERATION_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  IMAGE_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  IMAGE_WORKER_CONCURRENCY: z.coerce.number().int().positive().max(32).default(2),
  // Applies only to legacy whole-task jobs. Independent output units use the product constant.
  IMAGE_JOB_ATTEMPTS: z.coerce.number().int().positive().max(10).default(3),
  IMAGE_JOB_BACKOFF_MS: z.coerce.number().int().positive().default(2_000),
  IMAGE_DOWNLOAD_ALLOWED_HOSTS: z.string().default(""),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(20 * 1024 * 1024),
  MAX_GENERATED_IMAGE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 1024 * 1024),
  MAX_UPLOAD_IMAGE_PIXELS: z.coerce.number().int().positive().default(40_000_000),
  MAX_IMAGE_COUNT: z.coerce.number().int().positive().default(8),
  ALLOWED_ASPECT_RATIOS: z.string().min(1).default("1:1,3:4,4:3,9:16,16:9"),
  ENABLED_IMAGE_MODELS: z.string().min(1).default("bytedance-image,openai-image"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

export type Environment = z.infer<typeof environmentSchema>;
