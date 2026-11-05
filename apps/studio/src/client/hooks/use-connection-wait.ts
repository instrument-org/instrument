import { useNetworkStatus } from "@/client/hooks/use-network-status";
import ms from "ms";
import { useEffect, useEffectEvent, useLayoutEffect, useState } from "react";

/**
 * How recent a failed turn has to be, as the computer is seen offline, to go
 * out by itself once it's back. An older failure on screen had another cause,
 * and starting the agent over it when the Wi-Fi blips would come from nowhere.
 */
const WAIT_WINDOW = ms("10 minutes");

/** How long a run asked for gets to start before the card's Try again returns. */
const START_GRACE = ms("3 seconds");

export type ConnectionWait = "offline" | "trying-again";

/**
 * A turn that failed for want of a connection: where it stands, while the
 * computer is offline and then as it comes back, when a turn that has stopped
 * runs again once. Back includes Instrument's servers not answering, since a
 * model on the person's own account or key doesn't need them.
 *
 * Any failure another attempt could fix counts when it arrives while offline,
 * since it says whatever its provider's way of failing says. One that arrived
 * while online has to be a failed connection, or going offline later would
 * start the agent over a provider's own problem.
 */
export function useConnectionWait({
  failedAt,
  isConnectionFailure,
  isFailed: isLatestFailure,
  isRunning,
  run,
}: {
  failedAt: Date;
  isConnectionFailure: boolean;
  /** The chat's latest word is a failure another attempt could fix. */
  isFailed: boolean;
  isRunning: boolean;
  run: (() => void) | undefined;
}): ConnectionWait | undefined {
  const isOffline = useNetworkStatus()?.status === "offline";
  const [arrivedOffline] = useState(isOffline);
  const isFailed = isLatestFailure && (isConnectionFailure || arrivedOffline);
  const isFailedOffline = isOffline && isFailed;
  const [isWaiting, setIsWaiting] = useState(false);
  const failedTime = failedAt.getTime();
  // Before paint, or the card this stands in for shows for a frame.
  useLayoutEffect(() => {
    if (isFailedOffline) {
      // oxlint-disable-next-line react/set-state-in-effect -- reads the clock once, as the failure is seen offline, which rendering can't
      setIsWaiting(Date.now() - failedTime < WAIT_WINDOW);
    }
  }, [failedTime, isFailedOffline]);

  const isBack = isWaiting && !isOffline;
  const runIfStopped = useEffectEvent(() => {
    if (isFailed && !isRunning) {
      run?.();
    }
  });
  useEffect(() => {
    if (isBack) {
      runIfStopped();
    }
  }, [isBack]);
  useEffect(() => {
    if (!isBack || isRunning) {
      return;
    }
    const timer = setTimeout(() => {
      setIsWaiting(false);
    }, START_GRACE);
    return () => {
      clearTimeout(timer);
    };
  }, [isBack, isRunning]);

  if (!isWaiting || !isFailed) {
    return undefined;
  }
  return isOffline ? "offline" : "trying-again";
}
