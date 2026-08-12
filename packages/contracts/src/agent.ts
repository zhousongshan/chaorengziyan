import { z } from "zod";

export const agentTypeSchema = z.enum(["image", "video"]);
export const agentModeSchema = z.enum(["normal", "intelligent"]);
export const agentOriginSchema = z.enum(["system", "custom"]);
export const agentTimeRangeSchema = z.enum(["all", "today", "7d", "30d"]);

export const agentSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().max(120),
    agentInstruction: z.string().trim().max(1_000),
    type: agentTypeSchema,
    mode: agentModeSchema,
    origin: agentOriginSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict();

export const createAgentRequestSchema = z
  .object({
    name: z.string().trim().min(1, "请填写 Agent 名称").max(40),
    description: z.string().trim().max(120).default(""),
    agentInstruction: z.string().trim().max(1_000).default(""),
    type: z.literal("image")
  })
  .strict();

export const renameAgentRequestSchema = z
  .object({
    name: z.string().trim().min(1, "请填写 Agent 名称").max(40)
  })
  .strict();

export const agentListQuerySchema = z
  .object({
    keyword: z.string().trim().max(120).default(""),
    type: z.enum(["all", "image", "video"]).default("all"),
    timeRange: agentTimeRangeSchema.default("all"),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10)
  })
  .strict();

export const agentListResponseSchema = z
  .object({
    items: z.array(agentSchema),
    pagination: z
      .object({
        page: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        total: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();

export type Agent = z.infer<typeof agentSchema>;
export type AgentListQuery = z.infer<typeof agentListQuerySchema>;
export type AgentListResponse = z.infer<typeof agentListResponseSchema>;
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;
export type RenameAgentRequest = z.infer<typeof renameAgentRequestSchema>;
