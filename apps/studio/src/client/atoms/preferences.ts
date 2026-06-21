import { atomWithoutSuspense } from "@/client/lib/atom-without-suspense";
import { logger } from "@/client/lib/logger";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { atomWithRefresh } from "jotai/utils";

type Preferences = RPCOutput["preferences"]["get"];

const defaultPreferences: Preferences = {
  developerMode: false,
  enableUsageMetrics: false,
  lastUpdateCheck: undefined,
  preferApiKeyOverAccount: false,
  releaseChannel: undefined,
  theme: "system",
};

async function listen(setAtom: () => void) {
  const iterator = await rpcClient.preferences.live.get.call();
  for await (const _payload of iterator) {
    setAtom();
  }
}

const basePreferencesAtom = atomWithRefresh(async () => {
  try {
    return await rpcClient.preferences.get.call();
  } catch (error) {
    logger.error("Error fetching preferences", error);
    return defaultPreferences;
  }
});

basePreferencesAtom.onMount = (setAtom) => {
  listen(setAtom).catch((error: unknown) => {
    logger.error("Error listening to preferences updates", error);
  });
};

/**
 * Avoids many subscriptions to the preferences live endpoint.
 * Starts with default values to avoid loading state.
 */
export const preferencesAtom = atomWithoutSuspense(
  basePreferencesAtom,
  defaultPreferences,
);
