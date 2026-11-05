import { useNetworkStatus } from "@/client/hooks/use-network-status";
import ms from "ms";
import { useEffect, useEffectEvent, useLayoutEffect, useState } from "react";

/**
 * How recent a failed turn has to be, as the computer is seen offline, to run
 * again by itself once it's back. An older failure on screen had another cause,
 * and starting the agent over it when the Wi-Fi blips would come from nowhere.
 */
const MAX_FAILURE_AGE = ms("10 minutes");

/** How long a requested run gets to start before the card's Try again returns. */
const RUN_START_TIMEOUT = ms("3 seconds");

export type OnlineRetry = "offline" | "trying-again";

/**
 * Runs a turn that failed for want of a connection once more when the computer
 * is back online, and says where that stands: `offline` while it waits, then
 * `trying-again`, and undefined when there's nothing to retry. Back includes
 * Instrument's servers not answering, since a model on the person's own account
 * or key doesn't need them.
 *
 * Any failure another attempt could fix counts when first seen offline, since
 * each provider words it differently. One first seen online has to be a failed
 * connection, or going offline later would start the agent over a provider's
 * own problem.
 */
export function useRetryWhenOnline({
  failedAt,
  isConnectionFailure,
  isRetryable,
  isRunning,
  run,
}: {
  failedAt: Date;
  isConnectionFailure: boolean;
  /** The chat's latest message is a failure another attempt could fix. */
  isRetryable: boolean;
  isRunning: boolean;
  run: (() => void) | undefined;
}): OnlineRetry | undefined {
  const isOffline = useNetworkStatus()?.status === "offline";
  const [firstSeenOffline] = useState(isOffline);
  const canRetry = isRetryable && (isConnectionFailure || firstSeenOffline);
  const shouldWait = isOffline && canRetry;
  const [isWaiting, setIsWaiting] = useState(false);
  const failedTime = failedAt.getTime();
  // Before paint, or the card this stands in for shows for a frame.
  useLayoutEffect(() => {
    if (shouldWait) {
      // oxlint-disable-next-line react/set-state-in-effect -- reads the clock once, as the failure is seen offline, which rendering can't
      setIsWaiting(Date.now() - failedTime < MAX_FAILURE_AGE);
    }
  }, [failedTime, shouldWait]);

  const isBackOnline = isWaiting && !isOffline;
  const runIfStopped = useEffectEvent(() => {
    if (canRetry && !isRunning) {
      run?.();
    }
  });
  useEffect(() => {
    if (isBackOnline) {
      runIfStopped();
    }
  }, [isBackOnline]);
  useEffect(() => {
    if (!isBackOnline || isRunning) {
      return;
    }
    const timer = setTimeout(() => {
      setIsWaiting(false);
    }, RUN_START_TIMEOUT);
    return () => {
      clearTimeout(timer);
    };
  }, [isBackOnline, isRunning]);

  if (!isWaiting || !canRetry) {
    return undefined;
  }
  return isOffline ? "offline" : "trying-again";
}
