import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";

import { RequirementService } from "./requirement.service.js";

@Controller("requirements")
export class RequirementController {
  public constructor(private readonly requirementService: RequirementService) {}

  @Get(":id")
  public findById(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.requirementService.findById(id);
  }
}
