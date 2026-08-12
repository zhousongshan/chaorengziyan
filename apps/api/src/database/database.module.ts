import { Global, Module } from "@nestjs/common";

import { createDatabase, type DatabaseConnection } from "@chaoren/database";
import type { Environment } from "@chaoren/contracts";

import { ENVIRONMENT } from "../environment.js";
import { DATABASE_CONNECTION } from "./database.constants.js";
import { DatabaseLifecycleService } from "./database-lifecycle.service.js";

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): DatabaseConnection =>
        createDatabase(environment.DATABASE_URL)
    },
    DatabaseLifecycleService
  ],
  exports: [DATABASE_CONNECTION]
})
export class DatabaseModule {}
