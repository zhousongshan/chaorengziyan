import { Module } from "@nestjs/common";

import { AuthorizationModule } from "../authorization/authorization.module.js";
import { ProjectModule } from "../projects/project.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { AssetFolderController } from "./asset-folder.controller.js";
import { ASSET_LIBRARY_REPOSITORY } from "./asset-library.repository.js";
import { DrizzleAssetLibraryRepository } from "./drizzle-asset-library.repository.js";
import { DrizzleMediaAssetRepository } from "./drizzle-media-asset.repository.js";
import { MediaAssetController } from "./media-asset.controller.js";
import { MEDIA_ASSET_REPOSITORY } from "./media-asset.repository.js";
import { MediaAssetService } from "./media-asset.service.js";

@Module({
  imports: [AuthorizationModule, StorageModule, ProjectModule],
  controllers: [MediaAssetController, AssetFolderController],
  providers: [
    MediaAssetService,
    DrizzleAssetLibraryRepository,
    DrizzleMediaAssetRepository,
    {
      provide: MEDIA_ASSET_REPOSITORY,
      useExisting: DrizzleMediaAssetRepository
    },
    {
      provide: ASSET_LIBRARY_REPOSITORY,
      useExisting: DrizzleAssetLibraryRepository
    }
  ],
  exports: [MediaAssetService, MEDIA_ASSET_REPOSITORY]
})
export class MediaAssetModule {}
