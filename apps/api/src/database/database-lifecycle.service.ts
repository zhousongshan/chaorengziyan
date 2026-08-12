import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";

import type { DatabaseConnection } from "@chaoren/database";

import { DATABASE_CONNECTION } from "./database.constants.js";

@Injectable()
export class DatabaseLifecycleService implements OnApplicationShutdown {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}
