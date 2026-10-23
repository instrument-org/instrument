import { type ConnectProvider } from "@/shared/connect-outcome";
import { type AIProviderConfigId } from "@instrument-org/shared";

/** What setup connected: a sign-in, or a key by its config. */
export type LastConnection =
  | { kind: "key"; providerConfigId: AIProviderConfigId }
  | { kind: "sign-in"; provider: ConnectProvider };

/**
 * The last connection this window.s setup made, so the model step lists
 * that connection's models. Kept in memory only: a relaunch mid-setup
 * forgets it, and the model step then lists every connection's.
 */
let connected: LastConnection | undefined;

export function noteConnection(connection: LastConnection): void {
  connected = connection;
}

export function lastConnection(): LastConnection | undefined {
  return connected;
}
