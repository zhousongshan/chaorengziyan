export const AUTHORIZATION_PORT = Symbol("AUTHORIZATION_PORT");

export interface AuthorizationRequest {
  userId: string;
  projectId: string;
  assetIds: string[];
}

export interface AuthorizationPort {
  assertAccess(request: AuthorizationRequest): Promise<void>;
}
