import { captureClientEvent } from "@/client/lib/capture-client-event";
import { atom, getDefaultStore } from "jotai";

const store = getDefaultStore();

/**
 * Whether the command menu (Cmd+K) is open. Renderer-owned view state so the
 * native menu item can drive it through the shell command bus rather than owning
 * the state itself (mirrors the sidebar/zoom atoms).
 */
export const commandMenuOpenAtom = atom(false);

export function toggleCommandMenu() {
  const next = !store.get(commandMenuOpenAtom);
  store.set(commandMenuOpenAtom, next);
  if (next) {
    captureClientEvent("command_menu.opened");
  }
}
