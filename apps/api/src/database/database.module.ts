import { Global, Module } from "@nestjs/common";

import {
  assertDatabaseMigrationCurrent,
  createDatabase,
  type DatabaseConnection
} from "@chaoren/database";
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
      useFactory: async (environment: Environment): Promise<DatabaseConnection> => {
        const connection = createDatabase(environment.DATABASE_URL);
        try {
          await assertDatabaseMigrationCurrent(connection.db);
          return connection;
        } catch (error) {
          await connection.close();
          throw error;
        }
      }
    },
    DatabaseLifecycleService
  ],
  exports: [DATABASE_CONNECTION]
})
export class DatabaseModule {}
