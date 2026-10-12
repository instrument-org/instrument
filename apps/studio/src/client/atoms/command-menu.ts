import { atom, getDefaultStore } from "jotai";

/**
 * Whether the command menu (Cmd+K) is open. Renderer-owned view state, so the
 * native menu's chord reaches it through the window's command stream.
 */
export const commandMenuOpenAtom = atom(false);

/** The menu already drawn on the screen up, which Cmd+K puts the caret in rather than opening a second one over it. */
let inPage: (() => void) | null = null;

/** Names the menu drawn on the screen up, while it is up; returns its removal. */
export function registerInPageCommandMenu(focus: () => void): () => void {
  inPage = focus;
  return () => {
    if (inPage === focus) {
      inPage = null;
    }
  };
}

export function toggleCommandMenu() {
  const store = getDefaultStore();
  const isOpen = store.get(commandMenuOpenAtom);
  if (!isOpen && inPage) {
    inPage();
    return;
  }
  store.set(commandMenuOpenAtom, !isOpen);
}
