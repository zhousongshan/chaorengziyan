import { Module } from "@nestjs/common";

import { AgentModule } from "../agents/agent.module.js";
import { MediaAssetModule } from "../media-assets/media-asset.module.js";
import { ProjectModule } from "../projects/project.module.js";
import { ProductEntityModule } from "../product-entities/product-entity.module.js";
import { RequirementModule } from "../requirements/requirement.module.js";
import { BullMqConversationTurnQueue } from "./bullmq-conversation-turn.queue.js";
import { ConversationController } from "./conversation.controller.js";
import { CONVERSATION_REPOSITORY } from "./conversation.repository.js";
import { ConversationService } from "./conversation.service.js";
import { CONVERSATION_TURN_QUEUE } from "./conversation-turn.queue.js";
import { ConversationVisualMemoryService } from "./conversation-visual-memory.service.js";
import { DrizzleConversationRepository } from "./drizzle-conversation.repository.js";

@Module({
  imports: [AgentModule, ProjectModule, ProductEntityModule, MediaAssetModule, RequirementModule],
  controllers: [ConversationController],
  providers: [
    ConversationService,
    ConversationVisualMemoryService,
    DrizzleConversationRepository,
    BullMqConversationTurnQueue,
    { provide: CONVERSATION_REPOSITORY, useExisting: DrizzleConversationRepository },
    { provide: CONVERSATION_TURN_QUEUE, useExisting: BullMqConversationTurnQueue }
  ],
  exports: [ConversationService, CONVERSATION_REPOSITORY]
})
export class ConversationModule {}
