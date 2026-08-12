import { Module } from "@nestjs/common";

import { AgentModule } from "./agents/agent.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { ConversationModule } from "./conversations/conversation.module.js";
import { EnvironmentModule } from "./environment.module.js";
import { HealthModule } from "./health/health.module.js";
import { ImageGenerationModule } from "./image-generations/image-generation.module.js";
import { ImageModelModule } from "./image-models/image-model.module.js";
import { MediaAssetModule } from "./media-assets/media-asset.module.js";
import { ProjectModule } from "./projects/project.module.js";
import { ProductEntityModule } from "./product-entities/product-entity.module.js";
import { PromptOptimizationModule } from "./prompt-optimizations/prompt-optimization.module.js";
import { RequirementModule } from "./requirements/requirement.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { SubjectConsistencyModule } from "./subject-consistency/subject-consistency.module.js";

@Module({
  imports: [
    EnvironmentModule,
    DatabaseModule,
    AgentModule,
    HealthModule,
    StorageModule,
    MediaAssetModule,
    ImageModelModule,
    ProjectModule,
    ProductEntityModule,
    PromptOptimizationModule,
    RequirementModule,
    ConversationModule,
    ImageGenerationModule,
    SubjectConsistencyModule
  ]
})
export class AppModule {}
