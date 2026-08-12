import { Global, Module } from "@nestjs/common";

import { ENVIRONMENT, readEnvironment } from "./environment.js";

@Global()
@Module({
  providers: [{ provide: ENVIRONMENT, useFactory: readEnvironment }],
  exports: [ENVIRONMENT]
})
export class EnvironmentModule {}
