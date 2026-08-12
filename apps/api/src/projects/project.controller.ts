import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";

import { ProjectService } from "./project.service.js";

@Controller("projects")
export class ProjectController {
  public constructor(private readonly projects: ProjectService) {}

  @Post()
  public create(@Body() body: unknown) {
    return this.projects.create(body);
  }

  @Put("current")
  public ensureDefault() {
    return this.projects.ensureDefault();
  }

  @Get()
  public list() {
    return this.projects.list();
  }

  @Get(":id")
  public findById(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.projects.findById(id);
  }
}
