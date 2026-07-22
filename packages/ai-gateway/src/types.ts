import { type CaptureExceptionFunction } from "@instrument-org/shared";

import { type AIGatewayProviderConfig } from "./schemas/provider-config";

export interface AIGatewayEnv {
  Variables: {
    captureException: CaptureExceptionFunction;
    clientInfo: ClientInfo;
    getAIProviderConfigs: GetProviderConfigs;
  };
}

// Non-identifying desktop-client metadata the host injects at mount time. Only
// forwarded to our own provider (see set-client-headers), never to third-party
// providers reached with a user-supplied key.
export interface ClientInfo {
  clientArch: string;
  clientName: string;
  clientPlatform: string;
  clientVersion: string;
}

export type GetProviderConfigs = () => AIGatewayProviderConfig.Type[];
