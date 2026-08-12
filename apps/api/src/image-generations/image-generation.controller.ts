import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
  type MessageEvent
} from "@nestjs/common";
import { concat, concatMap, distinctUntilChanged, from, interval, map, of, takeWhile } from "rxjs";

import type { ImageGenerationTask } from "@chaoren/contracts";

import { ImageGenerationService } from "./image-generation.service.js";

@Controller("image-generations")
export class ImageGenerationController {
  public constructor(private readonly imageGenerations: ImageGenerationService) {}

  @Post()
  @HttpCode(202)
  public create(@Body() body: unknown) {
    return this.imageGenerations.create(body);
  }

  @Get()
  public listBySession(@Query() query: unknown) {
    return this.imageGenerations.listBySessionId(query);
  }

  @Get("active")
  public findActiveBySession(@Query("sessionId", new ParseUUIDPipe()) sessionId: string) {
    return this.imageGenerations.findActiveBySessionId(sessionId);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  public cancel(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.imageGenerations.cancel(id);
  }

  @Post(":id/outputs/:unitId/regenerate")
  @HttpCode(202)
  public regenerateOutput(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("unitId", new ParseUUIDPipe()) unitId: string,
    @Body() body: unknown
  ) {
    return this.imageGenerations.regenerateOutput(id, unitId, body);
  }

  @Get(":id")
  public findById(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.imageGenerations.findById(id);
  }

  @Sse(":id/events")
  public async events(@Param("id", new ParseUUIDPipe()) id: string) {
    const initial = await this.imageGenerations.findById(id);
    const tasks = concat(
      of(initial),
      interval(1_500).pipe(concatMap(() => from(this.imageGenerations.findById(id))))
    );

    return tasks.pipe(
      distinctUntilChanged(
        (previous, current) =>
          previous.workflowStatus === current.workflowStatus &&
          JSON.stringify(previous.outputs) === JSON.stringify(current.outputs)
      ),
      takeWhile((task) => !isTerminal(task), true),
      map((task): MessageEvent => ({
        id: `${task.updatedAt}:${task.status}`,
        retry: 3_000,
        data: {
          schemaVersion: "1.0",
          taskId: task.taskId,
          status: task.status,
          workflowStatus: task.workflowStatus,
          outputs: task.outputs,
          updatedAt: task.updatedAt
        }
      }))
    );
  }
}

function isTerminal(task: ImageGenerationTask): boolean {
  return ["succeeded", "partially_succeeded", "failed", "cancelled"].includes(
    task.workflowStatus ?? task.status
  );
}
