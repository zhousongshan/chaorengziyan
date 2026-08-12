import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query
} from "@nestjs/common";

import { AgentService } from "./agent.service.js";

@Controller("agents")
export class AgentController {
  public constructor(private readonly agents: AgentService) {}

  @Get()
  public list(@Query() query: Record<string, unknown>) {
    return this.agents.list(query);
  }

  @Post()
  @HttpCode(201)
  public create(@Body() body: unknown) {
    return this.agents.create(body);
  }

  @Get(":id")
  public findById(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.agents.findById(id);
  }

  @Post(":id/copies")
  @HttpCode(201)
  public copy(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.agents.copy(id);
  }

  @Patch(":id")
  public rename(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.agents.rename(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  public delete(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.agents.delete(id);
  }
}
