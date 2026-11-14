/**
 * Reload for a tab that is not a page: a chat, its transcript read anew, or
 * a built-in page, drawn again. Each one up in a side offers its own, by an
 * element of its own (`GroupItem`), and the window's Reload reaches the one
 * on the side with the keyboard.
 */
const reloads = new Set<{
  element: () => HTMLElement | null;
  reload: () => void;
}>();

/** Offers a tab's Reload until the answer is called. */
export function offerScreenReload(entry: {
  element: () => HTMLElement | null;
  reload: () => void;
}): () => void {
  reloads.add(entry);
  return () => {
    reloads.delete(entry);
  };
}

/** Reloads the tab up on the side with the keyboard, when it offers to; whether one did. */
export function reloadScreenWithKeyboard(): boolean {
  for (const entry of reloads) {
    if (
      entry
        .element()
        ?.closest("[data-app-tab-active] [data-group-side][data-keyboard]")
    ) {
      entry.reload();
      return true;
    }
  }
  return false;
}
