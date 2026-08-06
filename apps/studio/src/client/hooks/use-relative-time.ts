import {
  clockSubscriber,
  formatRelativeTime,
  getSharedNow,
  relativeTickMs,
} from "@/client/lib/relative-time";
import { useSyncExternalStore } from "react";

/**
 * An instant rendered the way the app renders instants, kept current as it
 * sits on screen. Re-renders only when this instant's own rendering can have
 * changed; a date old enough to render as a date subscribes to nothing.
 *
 * `RelativeTime` is the usual way to reach this. Call the hook directly where
 * the string is joined into a larger one rather than rendered on its own.
 */
export function useRelativeTime(date: Date) {
  const intervalMs = relativeTickMs(getSharedNow() - date.getTime());

  const now = useSyncExternalStore(
    intervalMs === null ? noopSubscribe : clockSubscriber(intervalMs),
    getSharedNow,
  );

  return formatRelativeTime(date, now);
}

function noopSubscribe() {
  return unsubscribeNothing;
}

function unsubscribeNothing() {
  // A snapshot that can never change has no timer behind it to tear down.
}
