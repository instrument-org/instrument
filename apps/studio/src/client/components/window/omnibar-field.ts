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
  /** The words in the box, without the rest the field writes in ahead of the caret. */
  query: string;
}

export type OmnibarFieldEvent =
  /** The caret leaves the box. `place` is what comes back into it; absent on a new tab, which keeps its words. */
  | { place?: string | undefined; type: "blur" }
  /** The box empties, and nothing else about it changes. */
  | { type: "clear" }
  /** The caret goes into the box, which opens for typing. */
  | { type: "focus" }
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
        query: event.place ?? state.query,
      };
    }
    case "clear": {
      return { ...state, query: "" };
    }
    case "focus": {
      return { ...state, isEditing: true, isFocused: true };
    }
    case "highlight": {
      return { ...state, highlight: event.index };
    }
    case "input": {
      return {
        ...state,
        canComplete: event.canComplete,
        highlight: 0,
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
