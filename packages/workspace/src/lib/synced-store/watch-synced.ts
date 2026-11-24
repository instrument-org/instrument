import ms from "ms";

import { lookWhileInFront } from "../in-front";
import { type SyncedDomain } from "./domains";
import { isSyncedFileName } from "./synced-record";
import { watchDevices } from "./watch-devices";

const SETTLE_MS = ms("250 milliseconds");

/**
 * Calls `look` whenever any device's file of the domain may have changed,
 * until the stop it answers is called: after a burst of watch events, and by
 * the rule of `in-front.ts` for a change the watch missed. The one way a
 * synced store is watched, whether it is held open (`openSyncedStore`) or
 * read from its files (`watchSyncedFiles`); `look` finds out what changed,
 * if anything did.
 */
export function watchSynced({
  devicesDir,
  domain,
  look,
  onError = () => undefined,
  platform = process.platform,
  settleMs = SETTLE_MS,
}: {
  devicesDir: string;
  domain: SyncedDomain;
  look: () => void;
  onError?: (error: unknown) => void;
  platform?: NodeJS.Platform;
  settleMs?: number;
}): () => void {
  let settleTimer: NodeJS.Timeout | undefined;
  const stopWatch = watchDevices({
    devicesDir,
    isOurs: (name) => isSyncedFileName(name, domain),
    onChange: () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(look, settleMs);
    },
    onError,
    persistent: false,
    platform,
  });
  const stopLooking = lookWhileInFront(look);
  return () => {
    clearTimeout(settleTimer);
    stopWatch();
    stopLooking();
  };
}
