import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";

import { PromptOptimizationService } from "./prompt-optimization.service.js";

@Controller("conversations/:sessionId/prompt-optimizations")
export class PromptOptimizationController {
  public constructor(private readonly optimizations: PromptOptimizationService) {}

  @Post()
  public optimize(
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string,
    @Body() body: unknown
  ) {
    return this.optimizations.optimize(sessionId, body);
  }

  @Get(":optimizationId")
  public get(
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string,
    @Param("optimizationId", new ParseUUIDPipe()) optimizationId: string
  ) {
    return this.optimizations.get(sessionId, optimizationId);
  }
}
