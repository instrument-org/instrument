import {
  getAttachedTargetsSnapshot,
  getGuest,
  type GuestHandle,
  subscribeAttachedTargets,
} from "@/client/lib/browser-pool";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { useSyncExternalStore } from "react";

/**
 * The set of browser target ids whose guest has attached ("live"). Fed by the
 * single desired-targets stream the pool already subscribes to, so the UI reads
 * live-ness without a second polled endpoint.
 */
export function useBrowserTargets(): ReadonlySet<BrowserTargetId> {
  return useSyncExternalStore(
    subscribeAttachedTargets,
    getAttachedTargetsSnapshot,
  );
}

/**
 * A target's guest, once it is ready to be driven, and again whenever that
 * changes: null until then, once it is gone, and for no target.
 */
export function useGuest(
  targetId: BrowserTargetId | null | undefined,
): GuestHandle | null {
  const attached = useBrowserTargets();
  return targetId && attached.has(targetId) ? getGuest(targetId) : null;
}
