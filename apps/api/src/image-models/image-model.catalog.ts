import { BadRequestException, Inject, Injectable } from "@nestjs/common";

import type { Environment, ImageModelDefinition } from "@chaoren/contracts";
import {
  createImageModelDefinitions,
  getEnabledImageModel,
  ImageModelNotAvailableError
} from "@chaoren/image-generation";

import { ENVIRONMENT } from "../environment.js";

@Injectable()
export class ImageModelCatalog {
  private readonly models: ImageModelDefinition[];
  private readonly environment: Environment;

  public constructor(@Inject(ENVIRONMENT) environment: Environment) {
    this.environment = environment;
    this.models = createImageModelDefinitions(environment);
  }

  public listEnabled(): ImageModelDefinition[] {
    return this.models.filter((model) => model.enabled).map((model) => structuredClone(model));
  }

  public getEnabled(modelId: string): ImageModelDefinition {
    try {
      return getEnabledImageModel(this.environment, modelId);
    } catch (error) {
      if (!(error instanceof ImageModelNotAvailableError)) throw error;
      throw new BadRequestException({
        code: "IMAGE_MODEL_NOT_AVAILABLE",
        message: `生图模型不可用: ${modelId}`
      });
    }
  }
}
