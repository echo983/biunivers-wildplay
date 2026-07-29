export const RESOURCE_SESSION_PROTOCOL = "biunivers.resource-session/1";

export interface ResourceMetadata {
  name: string;
  size: number;
  mtimeMs: number;
  mediaType: string;
  contentVersion: string;
}

export interface ResourceSession {
  sessionId: string;
  access: "read" | "edit";
  expiresAt: string;
  metadata: ResourceMetadata;
  content: {
    url: string;
    sessionHeader: "Biunivers-Resource-Session";
    authorization: "Biunivers-Instance";
    instanceToken: string;
  };
}

export interface ResourceLaunch {
  action: "open" | "edit";
  resource: ResourceSession;
}

export interface ResourceCapabilities {
  protocol: typeof RESOURCE_SESSION_PROTOCOL;
  renewAfterSeconds: number;
  expiresAfterSeconds: number;
  fullRead: boolean;
  singleRangeRead: boolean;
  fullWrite: boolean;
}

export interface ResourceRenewalResult {
  renewed: Array<{ sessionId: string; expiresAt: string }>;
  rejected: Array<{ sessionId: string; code: string }>;
}

export class ResourceSessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ResourceSessionError";
  }
}
