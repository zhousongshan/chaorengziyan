import { Module } from "@nestjs/common";

import { ImageModelCatalog } from "./image-model.catalog.js";
import { ImageModelController } from "./image-model.controller.js";

@Module({
  controllers: [ImageModelController],
  providers: [ImageModelCatalog],
  exports: [ImageModelCatalog]
})
export class ImageModelModule {}
