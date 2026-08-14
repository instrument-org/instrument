import {
  clockSubscriber,
  formatRelativeTime,
  getSharedNow,
  relativeTickMs,
} from "@/client/lib/relative-time";
import { useState, useSyncExternalStore } from "react";

/**
 * An instant rendered the way the app renders instants, kept current as it
 * sits on screen. Re-renders only when this instant's own rendering can have
 * changed; a date old enough to render as a date subscribes to nothing.
 *
 * `RelativeTime` is the usual way to reach this. Call the hook directly where
 * the string is joined into a larger one rather than rendered on its own.
 */
export function useRelativeTime(
  date: Date,
  { compact = false }: { compact?: boolean } = {},
) {
  // The cadence is state rather than something read off the clock as the
  // instance renders: the age it follows from goes on changing after the first
  // render, and a rendering that reads the clock directly is free to be cached
  // at the first age it ever saw and never move off it again.
  const [intervalMs, setIntervalMs] = useState(() =>
    relativeTickMs(getSharedNow() - date.getTime()),
  );

  const now = useSyncExternalStore(
    intervalMs === null ? noopSubscribe : clockSubscriber(intervalMs),
    getSharedNow,
  );

  // Crossing into another unit is exactly when this instance should move to
  // another timer, and it is a tick of the current one that carries it across.
  // Re-rendering from here rather than from an effect keeps the subscription
  // and the age it was chosen for from disagreeing for a frame.
  const nextIntervalMs = relativeTickMs(now - date.getTime());
  if (nextIntervalMs !== intervalMs) {
    setIntervalMs(nextIntervalMs);
  }

  return formatRelativeTime(date, now, { compact });
}

function noopSubscribe() {
  return unsubscribeNothing;
}

function unsubscribeNothing() {
  // A snapshot that can never change has no timer behind it to tear down.
}
