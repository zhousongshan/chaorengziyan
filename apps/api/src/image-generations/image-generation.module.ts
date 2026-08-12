import { Module } from "@nestjs/common";

import { AuthorizationModule } from "../authorization/authorization.module.js";
import { ImageModelModule } from "../image-models/image-model.module.js";
import { MediaAssetModule } from "../media-assets/media-asset.module.js";
import { RequirementModule } from "../requirements/requirement.module.js";
import { ProductEntityModule } from "../product-entities/product-entity.module.js";
import { BullMqImageGenerationQueue } from "./bullmq-image-generation.queue.js";
import { DrizzleImageGenerationTaskRepository } from "./drizzle-image-generation-task.repository.js";
import { ImageGenerationController } from "./image-generation.controller.js";
import { IMAGE_GENERATION_QUEUE } from "./image-generation-queue.port.js";
import { ImageGenerationService } from "./image-generation.service.js";
import { IMAGE_GENERATION_TASK_REPOSITORY } from "./image-generation-task.repository.js";

@Module({
  imports: [
    AuthorizationModule,
    ImageModelModule,
    MediaAssetModule,
    ProductEntityModule,
    RequirementModule
  ],
  controllers: [ImageGenerationController],
  providers: [
    ImageGenerationService,
    BullMqImageGenerationQueue,
    DrizzleImageGenerationTaskRepository,
    {
      provide: IMAGE_GENERATION_TASK_REPOSITORY,
      useExisting: DrizzleImageGenerationTaskRepository
    },
    {
      provide: IMAGE_GENERATION_QUEUE,
      useExisting: BullMqImageGenerationQueue
    }
  ],
  exports: [IMAGE_GENERATION_TASK_REPOSITORY]
})
export class ImageGenerationModule {}
