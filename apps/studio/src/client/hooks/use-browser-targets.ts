import {
  getAttachedTargetsSnapshot,
  getNavigatedTargetsSnapshot,
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
 * The set of browser target ids that have started loading a real page. Narrower
 * than {@link useBrowserTargets}: use this to decide whether to put a browser in
 * front of the user, since a target can attach without anything ever asking for
 * a page to be shown.
 */
export function useNavigatedBrowserTargets(): ReadonlySet<BrowserTargetId> {
  return useSyncExternalStore(
    subscribeAttachedTargets,
    getNavigatedTargetsSnapshot,
  );
}
