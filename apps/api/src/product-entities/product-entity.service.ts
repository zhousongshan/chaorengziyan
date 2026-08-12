import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  generationTaskOutputs,
  generationUnitSubjectEntities,
  productEntities,
  productEntitySources,
  type DatabaseConnection
} from "@chaoren/database";

import { DATABASE_CONNECTION } from "../database/database.constants.js";

export interface ProductEntityCandidate {
  id: string;
  label: string | null;
  sourceAssetIds: string[];
}

@Injectable()
export class ProductEntityService {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async findInheritableByAssetIds(
    assetIds: string[],
    projectId: string,
    userId: string
  ): Promise<Map<string, ProductEntityCandidate[]>> {
    const result = new Map<string, ProductEntityCandidate[]>();
    if (assetIds.length === 0) return result;
    const rows = await this.connection.db
      .select({
        outputAssetId: generationTaskOutputs.assetId,
        deliverableAssetId: generationTaskOutputs.deliverableAssetId,
        productEntityId: productEntities.id,
        label: productEntities.label,
        productSourceAssetId: productEntitySources.assetId
      })
      .from(generationTaskOutputs)
      .innerJoin(
        generationUnitSubjectEntities,
        eq(generationUnitSubjectEntities.unitId, generationTaskOutputs.unitId)
      )
      .innerJoin(
        productEntities,
        eq(productEntities.id, generationUnitSubjectEntities.productEntityId)
      )
      .innerJoin(productEntitySources, eq(productEntitySources.productEntityId, productEntities.id))
      .where(
        and(
          eq(generationTaskOutputs.status, "deliverable"),
          eq(productEntities.projectId, projectId),
          eq(productEntities.userId, userId),
          eq(productEntities.status, "active"),
          eq(productEntities.lineageStatus, "trusted"),
          inArray(generationTaskOutputs.deliverableAssetId, assetIds)
        )
      )
      .orderBy(asc(generationUnitSubjectEntities.position), asc(productEntitySources.position));
    for (const row of rows) {
      if (!row.deliverableAssetId) continue;
      const current = result.get(row.deliverableAssetId) ?? [];
      const existing = current.find((candidate) => candidate.id === row.productEntityId);
      if (existing) {
        if (!existing.sourceAssetIds.includes(row.productSourceAssetId)) {
          existing.sourceAssetIds.push(row.productSourceAssetId);
        }
      } else {
        current.push({
          id: row.productEntityId,
          label: row.label,
          sourceAssetIds: [row.productSourceAssetId]
        });
      }
      result.set(row.deliverableAssetId, current);
    }
    return result;
  }
}
