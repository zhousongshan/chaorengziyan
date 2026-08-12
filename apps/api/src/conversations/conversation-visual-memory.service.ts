import { and, eq, inArray } from "drizzle-orm";
import { Inject, Injectable } from "@nestjs/common";

import type { ConversationMessageAsset, ConversationRequirementAiOutput } from "@chaoren/contracts";
import { assetVisualMemories, type DatabaseConnection } from "@chaoren/database";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import type { ConversationAssetMemory } from "./conversation-context.js";

const VISUAL_MEMORY_VERSION = "multimodal-requirement-v2";

@Injectable()
export class ConversationVisualMemoryService {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async findMany(sessionId: string, assetIds: string[]): Promise<ConversationAssetMemory[]> {
    if (assetIds.length === 0) return [];
    const rows = await this.connection.db
      .select()
      .from(assetVisualMemories)
      .where(
        and(
          eq(assetVisualMemories.sessionId, sessionId),
          inArray(assetVisualMemories.assetId, [...new Set(assetIds)])
        )
      );
    return rows.map((row) => ({
      assetId: row.assetId,
      role: row.assetRole,
      caption: row.caption,
      ocrText: row.ocrText,
      productFacts: asRecord(row.productFacts),
      creativeFacts: asRecord(row.creativeFacts)
    }));
  }

  public async saveMany(input: {
    sessionId: string;
    analysisModel: string;
    memories: Array<{
      assetId: string;
      role: ConversationMessageAsset["role"];
      memory: ConversationRequirementAiOutput["assetMemories"][number];
    }>;
  }): Promise<void> {
    if (input.memories.length === 0) return;
    for (const item of input.memories) {
      const productFacts = item.role === "product_source" ? item.memory.productFacts : {};
      await this.connection.db
        .insert(assetVisualMemories)
        .values({
          sessionId: input.sessionId,
          assetId: item.assetId,
          assetRole: item.role,
          caption: item.memory.caption,
          ocrText: item.memory.ocrText,
          productFacts,
          creativeFacts: item.memory.creativeFacts,
          analysisModel: input.analysisModel,
          analysisVersion: VISUAL_MEMORY_VERSION,
          status: "ready",
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [assetVisualMemories.sessionId, assetVisualMemories.assetId],
          set: {
            assetRole: item.role,
            caption: item.memory.caption,
            ocrText: item.memory.ocrText,
            productFacts,
            creativeFacts: item.memory.creativeFacts,
            analysisModel: input.analysisModel,
            analysisVersion: VISUAL_MEMORY_VERSION,
            status: "ready",
            updatedAt: new Date()
          }
        });
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
