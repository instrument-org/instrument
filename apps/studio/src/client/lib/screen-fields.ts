/**
 * The address field of a tab that shows none until it is asked for: a chat,
 * whose field comes up over its head. Each one up in a side offers its own,
 * by an element of its own (`GroupItem`), and Open Location reaches the one
 * on the side with the keyboard.
 */
const fields = new Set<{
  element: () => HTMLElement | null;
  show: () => void;
}>();

/** Offers a tab's field until the answer is called. */
export function offerScreenField(entry: {
  element: () => HTMLElement | null;
  show: () => void;
}): () => void {
  fields.add(entry);
  return () => {
    fields.delete(entry);
  };
}

/** Shows the field of the tab up on the side with the keyboard, when it offers one; whether one did. */
export function showScreenFieldWithKeyboard(): boolean {
  for (const entry of fields) {
    if (
      entry
        .element()
        ?.closest("[data-app-tab-active] [data-group-side][data-keyboard]")
    ) {
      entry.show();
      return true;
    }
  }
  return false;
}
