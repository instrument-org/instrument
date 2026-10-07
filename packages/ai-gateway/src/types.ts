import { type CaptureExceptionFunction } from "@instrument-org/shared";

import { type AIGatewayProviderConfig } from "./schemas/provider-config";

export interface AIGatewayEnv {
  Variables: {
    captureException: CaptureExceptionFunction;
    clientInfo: ClientInfo;
    getAIProviderConfigs: GetProviderConfigs;
    /**
     * Replace the named config's credential if it has already expired,
     * resolving once the replacement is in or the wait gave up. Awaited
     * before the configs are read, so a request made before a refresh timer
     * fires carries a credential the provider accepts.
     */
    refreshExpiredCredentials?: (providerConfigId: string) => Promise<void>;
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
