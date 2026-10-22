import { type ConnectProvider } from "@/shared/connect-outcome";
import { type AIProviderConfigId } from "@instrument-org/shared";

/** The way in setup's ways connected: a sign-in, or a key by its config. */
export type ConnectedWay =
  | { kind: "key"; providerConfigId: AIProviderConfigId }
  | { kind: "sign-in"; provider: ConnectProvider };

/**
 * The last way in this window's setup connected, so the model step lists
 * that connection's models. Kept in memory only: a relaunch mid-setup
 * forgets it, and the model step then lists every connection's.
 */
let connected: ConnectedWay | undefined;

export function noteConnectedWay(way: ConnectedWay): void {
  connected = way;
}

export function connectedWay(): ConnectedWay | undefined {
  return connected;
}
