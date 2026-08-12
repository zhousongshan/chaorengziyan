import { Controller, Get } from "@nestjs/common";

import type { ImageModelListResponse } from "@chaoren/contracts";

import { ImageModelCatalog } from "./image-model.catalog.js";

@Controller("image-models")
export class ImageModelController {
  public constructor(private readonly catalog: ImageModelCatalog) {}

  @Get()
  public list(): ImageModelListResponse {
    return { models: this.catalog.listEnabled() };
  }
}
