import { sidebarOpenAtom } from "@/client/atoms/sidebar";
import { captureTelemetryEvent } from "@/client/lib/telemetry";
import { getDefaultStore, useAtomValue } from "jotai";

const store = getDefaultStore();

/**
 * Set the sidebar open state and record the change. Module-level (not a hook) so
 * menus/shortcuts can call it with a stable identity, and so telemetry fires
 * once here instead of in a main-process RPC handler.
 */
export function setSidebarOpen(open: boolean) {
  if (store.get(sidebarOpenAtom) === open) {
    return;
  }
  store.set(sidebarOpenAtom, open);
  captureTelemetryEvent(open ? "app.sidebar_opened" : "app.sidebar_closed");
}

export function toggleSidebar() {
  setSidebarOpen(!store.get(sidebarOpenAtom));
}

export function useSidebarOpen() {
  return useAtomValue(sidebarOpenAtom);
}
