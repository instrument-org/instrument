/** What the address field holds between keystrokes. */
export interface OmnibarField {
  /**
   * Whether the field may finish the words ahead of the caret: only just
   * after a letter typed at the end, never after one taken away, so deleting
   * the part it wrote does not write it straight back.
   */
  canComplete: boolean;
  /** Which row the arrows have picked; the first is what Enter does with the words as they stand. */
  highlight: number;
  /** Whether the box is open for typing rather than showing the place. */
  isEditing: boolean;
  /**
   * Whether the caret is in the box: a new tab's box is editing whether or
   * not it has focus, so this is the one that says where the placeholder
   * sits.
   */
  isFocused: boolean;
  /** What the box opened with: the place, which counts as nothing typed. */
  place: string;
  /** The words in the box, without the rest the field writes in ahead of the caret. */
  query: string;
}

export type OmnibarFieldEvent =
  /** The caret leaves the box. `place` is what comes back into it; absent on a new tab, which keeps its words. */
  | { place?: string | undefined; type: "blur" }
  /** The box empties, and nothing else about it changes. */
  | { type: "clear" }
  /** The box opens for typing, with the caret already in it: a press on the field, or the chord for it. */
  | { type: "edit" }
  /**
   * The caret goes into the box. With `edits`, asked for (a press on the
   * field, the chord for it), the box opens for typing; without, the caret
   * came on its way somewhere else (Tab from the page), and the place stays
   * on show until a letter is typed. `place` is the place as it stands now,
   * when that is more than the box rested on: a page's address with where
   * the page has gone in itself.
   */
  | { edits: boolean; place?: string | undefined; type: "focus" }
  /** The arrows pick a row. */
  | { index: number; type: "highlight" }
  /** Words typed or taken away; `canComplete` says whether the edit was a letter typed at the end. */
  | { canComplete: boolean; query: string; type: "input" }
  /** Back to the words as typed: no row picked, nothing written in ahead of the caret. */
  | { type: "revert" }
  /** The words as the field shows them become the words typed, and the field goes on from there. */
  | { query: string; type: "take" };

/** The field before anything happens to it: the place in the box, editing at once on a new tab. */
export function initialOmnibarField(
  query: string,
  isEditing: boolean,
): OmnibarField {
  return {
    canComplete: false,
    highlight: 0,
    isEditing,
    isFocused: false,
    place: query,
    query,
  };
}

export function omnibarField(
  state: OmnibarField,
  event: OmnibarFieldEvent,
): OmnibarField {
  switch (event.type) {
    case "blur": {
      // The list goes with the caret, wherever the box is; a place's own
      // name comes back into the box once it is left.
      return {
        ...state,
        canComplete: false,
        highlight: 0,
        isEditing: false,
        isFocused: false,
        place: event.place ?? state.place,
        query: event.place ?? state.query,
      };
    }
    case "clear": {
      return { ...state, query: "" };
    }
    case "edit": {
      return { ...state, isEditing: true };
    }
    case "focus": {
      const isEditing = state.isEditing || event.edits;
      return event.place === undefined
        ? { ...state, isEditing, isFocused: true }
        : {
            ...state,
            isEditing,
            isFocused: true,
            place: event.place,
            query: event.place,
          };
    }
    case "highlight": {
      return { ...state, highlight: event.index };
    }
    // A letter typed opens the box for typing, wherever the caret came from.
    case "input": {
      return {
        ...state,
        canComplete: event.canComplete,
        highlight: 0,
        isEditing: true,
        query: event.query,
      };
    }
    case "revert": {
      return { ...state, canComplete: false, highlight: 0 };
    }
    case "take": {
      return { ...state, canComplete: false, highlight: 0, query: event.query };
    }
  }
}

/** What opens each field on screen for typing, by its box, while it is up. */
const editors = new WeakMap<HTMLInputElement, () => void>();

/** Has `editField` open the field with this box for typing, until the returned call takes it away. */
export function registerFieldEditor(box: HTMLInputElement, edit: () => void) {
  editors.set(box, edit);
  return () => {
    editors.delete(box);
  };
}

/**
 * Puts the caret in a field's box and opens it for typing, which is what a
 * press on the field and the chord for it ask for. The caret arriving any
 * other way leaves the place on show until a letter is typed.
 */
export function editField(box: HTMLInputElement) {
  box.focus();
  editors.get(box)?.();
}
