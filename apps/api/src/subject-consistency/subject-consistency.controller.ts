import { Controller, Get, Param, ParseUUIDPipe, Sse, type MessageEvent } from "@nestjs/common";
import { concat, concatMap, distinctUntilChanged, from, interval, map, of, takeWhile } from "rxjs";

import type { SubjectConsistencyWorkflowEvent } from "@chaoren/contracts";

import { SubjectConsistencyService } from "./subject-consistency.service.js";

@Controller()
export class SubjectConsistencyController {
  public constructor(private readonly service: SubjectConsistencyService) {}

  @Get("subject-consistency-checks/:id")
  public findById(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.service.findById(id);
  }

  @Get("image-generations/:id/subject-consistency-checks")
  public findByGenerationTask(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.service.findByGenerationTaskId(id);
  }

  @Sse("image-generations/:id/subject-consistency-events")
  public async events(@Param("id", new ParseUUIDPipe()) id: string) {
    const initial = await this.service.workflowEvent(id);
    const events = concat(
      of(initial),
      interval(1_500).pipe(concatMap(() => from(this.service.workflowEvent(id))))
    );
    return events.pipe(
      distinctUntilChanged(
        (previous, current) =>
          previous.status === current.status && previous.updatedAt === current.updatedAt
      ),
      takeWhile((event) => !isTerminal(event), true),
      map((event): MessageEvent => ({
        id: `${event.updatedAt}:${event.status}`,
        retry: 3_000,
        data: event
      }))
    );
  }
}

function isTerminal(event: SubjectConsistencyWorkflowEvent): boolean {
  return [
    "source_unusable",
    "passed",
    "partially_passed",
    "rejected",
    "execution_failed",
    "cancelled"
  ].includes(event.status);
}
