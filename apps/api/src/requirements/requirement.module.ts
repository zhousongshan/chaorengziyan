import { Module } from "@nestjs/common";

import type { Environment } from "@chaoren/contracts";

import { AuthorizationModule } from "../authorization/authorization.module.js";
import { ENVIRONMENT } from "../environment.js";
import { ImageModelModule } from "../image-models/image-model.module.js";
import { MediaAssetModule } from "../media-assets/media-asset.module.js";
import { ProjectModule } from "../projects/project.module.js";
import { DrizzleRequirementRunRepository } from "./drizzle-requirement-run.repository.js";
import { DrizzleRequirementAiAttemptRepository } from "./drizzle-requirement-ai-attempt.repository.js";
import { REQUIREMENT_AI_ATTEMPT_REPOSITORY } from "./requirement-ai-attempt.repository.js";
import { REQUIREMENT_AI_PORT } from "./requirement-ai.port.js";
import { OpenAiCompatibleRequirementAiAdapter } from "./openai-compatible-requirement-ai.adapter.js";
import { RequirementController } from "./requirement.controller.js";
import { RequirementResultValidator } from "./requirement-result.validator.js";
import { REQUIREMENT_RUN_REPOSITORY } from "./requirement-run.repository.js";
import { RequirementService } from "./requirement.service.js";

@Module({
  imports: [AuthorizationModule, ImageModelModule, MediaAssetModule, ProjectModule],
  controllers: [RequirementController],
  providers: [
    RequirementService,
    RequirementResultValidator,
    {
      provide: REQUIREMENT_AI_PORT,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment) =>
        new OpenAiCompatibleRequirementAiAdapter(environment)
    },
    DrizzleRequirementRunRepository,
    DrizzleRequirementAiAttemptRepository,
    {
      provide: REQUIREMENT_AI_ATTEMPT_REPOSITORY,
      useExisting: DrizzleRequirementAiAttemptRepository
    },
    {
      provide: REQUIREMENT_RUN_REPOSITORY,
      useExisting: DrizzleRequirementRunRepository
    }
  ],
  exports: [RequirementService, REQUIREMENT_RUN_REPOSITORY]
})
export class RequirementModule {}
