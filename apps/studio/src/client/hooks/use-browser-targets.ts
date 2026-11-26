import {
  getAttachedTargetsSnapshot,
  getGuest,
  type GuestHandle,
  isGuestShown,
  subscribeAttachedTargets,
  subscribeGuestShown,
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
  // The guest alone, so another page's guest coming or going draws nothing here.
  return useSyncExternalStore(subscribeAttachedTargets, () =>
    targetId && getAttachedTargetsSnapshot().has(targetId)
      ? getGuest(targetId)
      : null,
  );
}

/** Whether a target's guest has attached, read for that target alone. */
export function useIsAttached(
  targetId: BrowserTargetId | null | undefined,
): boolean {
  return useSyncExternalStore(
    subscribeAttachedTargets,
    () => !!targetId && getAttachedTargetsSnapshot().has(targetId),
  );
}

/** Whether a slot shows a target's guest, read for that target alone. */
export function useGuestShown(targetId: BrowserTargetId): boolean {
  return useSyncExternalStore(subscribeGuestShown, () =>
    isGuestShown(targetId),
  );
}
