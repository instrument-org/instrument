import {
  getAttachedTargetsSnapshot,
  subscribeAttachedTargets,
} from "@/client/lib/agent-browser-pool";
import { useSyncExternalStore } from "react";

/**
 * The set of agent-browser target ids whose guest has attached ("live"). Fed by
 * the single desired-targets stream the pool already subscribes to, so the UI
 * reads live-ness without a second polled endpoint.
 */
export function useAgentBrowserTargets(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeAttachedTargets,
    getAttachedTargetsSnapshot,
  );
}
