import { Module } from "@nestjs/common";

import { DrizzleProjectRepository } from "./drizzle-project.repository.js";
import { ProjectController } from "./project.controller.js";
import { PROJECT_REPOSITORY } from "./project.repository.js";
import { ProjectService } from "./project.service.js";

@Module({
  controllers: [ProjectController],
  providers: [
    ProjectService,
    DrizzleProjectRepository,
    { provide: PROJECT_REPOSITORY, useExisting: DrizzleProjectRepository }
  ],
  exports: [ProjectService, PROJECT_REPOSITORY]
})
export class ProjectModule {}
