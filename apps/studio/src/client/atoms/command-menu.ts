import { atom, getDefaultStore } from "jotai";

/**
 * Whether the command menu (Cmd+K) is open. Renderer-owned view state, so the
 * native menu's chord reaches it through the window's command stream.
 */
export const commandMenuOpenAtom = atom(false);

export function toggleCommandMenu() {
  const store = getDefaultStore();
  store.set(commandMenuOpenAtom, !store.get(commandMenuOpenAtom));
}
