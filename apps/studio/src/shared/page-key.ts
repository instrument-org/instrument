/**
 * A key a browser page had the keyboard for, which its window never sees,
 * passed on for the numbers a held modifier shows (`useHeldChordHints`):
 * a modifier pressed or let go, a key pressed with one held, or `blur` when
 * the window loses the keyboard to another app.
 */
export type PageKey =
  | { type: "blur" }
  | {
      altKey: boolean;
      ctrlKey: boolean;
      key: string;
      metaKey: boolean;
      repeat: boolean;
      shiftKey: boolean;
      type: "keyDown" | "keyUp";
    };
