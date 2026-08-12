import { Injectable } from "@nestjs/common";

import type { AuthorizationPort } from "./authorization.port.js";

@Injectable()
export class DevelopmentAuthorizationAdapter implements AuthorizationPort {
  public assertAccess(): Promise<void> {
    return Promise.resolve();
  }
}
