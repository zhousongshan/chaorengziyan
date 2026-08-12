import { Module } from "@nestjs/common";

import { ImageGenerationModule } from "../image-generations/image-generation.module.js";

import { BullMqSubjectConsistencyQueue } from "./bullmq-subject-consistency.queue.js";
import { DrizzleSubjectConsistencyRepository } from "./drizzle-subject-consistency.repository.js";
import { SubjectConsistencyController } from "./subject-consistency.controller.js";
import { SUBJECT_CONSISTENCY_QUEUE } from "./subject-consistency-queue.port.js";
import { SUBJECT_CONSISTENCY_REPOSITORY } from "./subject-consistency.repository.js";
import { SubjectConsistencyService } from "./subject-consistency.service.js";

@Module({
  imports: [ImageGenerationModule],
  controllers: [SubjectConsistencyController],
  providers: [
    SubjectConsistencyService,
    BullMqSubjectConsistencyQueue,
    DrizzleSubjectConsistencyRepository,
    { provide: SUBJECT_CONSISTENCY_QUEUE, useExisting: BullMqSubjectConsistencyQueue },
    { provide: SUBJECT_CONSISTENCY_REPOSITORY, useExisting: DrizzleSubjectConsistencyRepository }
  ]
})
export class SubjectConsistencyModule {}
