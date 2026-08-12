import { and, eq, exists, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { generationTaskOutputs, mediaAssets, type Database } from "@chaoren/database";

export function generatedAssetIsDeliverable(database: Database, assetId: SQLWrapper): SQL<boolean> {
  const deliverableOutput = database
    .select({ value: sql`1` })
    .from(generationTaskOutputs)
    .where(
      and(
        eq(generationTaskOutputs.status, "deliverable"),
        eq(generationTaskOutputs.deliverableAssetId, assetId)
      )
    );
  return sql<boolean>`${exists(deliverableOutput)}`;
}

export function assetIsProductAvailable(database: Database, assetId: SQLWrapper): SQL<boolean> {
  const uploadedMediaAssets = alias(mediaAssets, "uploaded_media_assets");
  const uploadedAsset = database
    .select({ value: sql`1` })
    .from(uploadedMediaAssets)
    .where(and(eq(uploadedMediaAssets.id, assetId), eq(uploadedMediaAssets.origin, "uploaded")));
  return sql<boolean>`${or(exists(uploadedAsset), generatedAssetIsDeliverable(database, assetId))}`;
}
