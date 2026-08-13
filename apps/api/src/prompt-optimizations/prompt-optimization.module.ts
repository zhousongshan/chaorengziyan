import { Module } from "@nestjs/common";

import type { Environment } from "@chaoren/contracts";

import { AgentModule } from "../agents/agent.module.js";
import { ConversationModule } from "../conversations/conversation.module.js";
import { ENVIRONMENT } from "../environment.js";
import { ImageModelModule } from "../image-models/image-model.module.js";
import { MediaAssetModule } from "../media-assets/media-asset.module.js";
import { DrizzlePromptOptimizationRepository } from "./drizzle-prompt-optimization.repository.js";
import { OpenAiCompatiblePromptOptimizationAiAdapter } from "./openai-compatible-prompt-optimization-ai.adapter.js";
import { PROMPT_OPTIMIZATION_AI_PORT } from "./prompt-optimization-ai.port.js";
import { PromptOptimizationController } from "./prompt-optimization.controller.js";
import { PROMPT_OPTIMIZATION_REPOSITORY } from "./prompt-optimization.repository.js";
import { PromptOptimizationService } from "./prompt-optimization.service.js";

@Module({
  imports: [AgentModule, ConversationModule, ImageModelModule, MediaAssetModule],
  controllers: [PromptOptimizationController],
  providers: [
    PromptOptimizationService,
    DrizzlePromptOptimizationRepository,
    {
      provide: PROMPT_OPTIMIZATION_AI_PORT,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment) =>
        new OpenAiCompatiblePromptOptimizationAiAdapter(environment)
    },
    {
      provide: PROMPT_OPTIMIZATION_REPOSITORY,
      useExisting: DrizzlePromptOptimizationRepository
    }
  ],
  exports: [PromptOptimizationService, PROMPT_OPTIMIZATION_REPOSITORY]
})
export class PromptOptimizationModule {}
