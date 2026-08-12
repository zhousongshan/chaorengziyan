import { Module } from "@nestjs/common";
import { LocalStorageAdapter, resolveWorkspacePath } from "@chaoren/storage";

import { ENVIRONMENT, type readEnvironment } from "../environment.js";
import { STORAGE } from "./storage.constants.js";

@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [ENVIRONMENT],
      useFactory: async (environment: ReturnType<typeof readEnvironment>) =>
        new LocalStorageAdapter(await resolveWorkspacePath(environment.LOCAL_STORAGE_ROOT))
    }
  ],
  exports: [STORAGE]
})
export class StorageModule {}
