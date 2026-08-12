import { Module } from "@nestjs/common";

import { AUTHORIZATION_PORT } from "./authorization.port.js";
import { DevelopmentAuthorizationAdapter } from "./development-authorization.adapter.js";

@Module({
  providers: [
    DevelopmentAuthorizationAdapter,
    { provide: AUTHORIZATION_PORT, useExisting: DevelopmentAuthorizationAdapter }
  ],
  exports: [AUTHORIZATION_PORT]
})
export class AuthorizationModule {}
