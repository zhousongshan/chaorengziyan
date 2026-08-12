import { Module } from "@nestjs/common";

import { AgentController } from "./agent.controller.js";
import { AGENT_REPOSITORY } from "./agent.repository.js";
import { AgentService } from "./agent.service.js";
import { DrizzleAgentRepository } from "./drizzle-agent.repository.js";

@Module({
  controllers: [AgentController],
  providers: [
    AgentService,
    DrizzleAgentRepository,
    { provide: AGENT_REPOSITORY, useExisting: DrizzleAgentRepository }
  ],
  exports: [AgentService, AGENT_REPOSITORY]
})
export class AgentModule {}
