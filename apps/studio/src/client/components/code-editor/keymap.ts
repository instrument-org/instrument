import {
  defaultKeymap,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { type KeyBinding } from "@codemirror/view";

/**
 * The code editor's keys: CodeMirror's own, with Tab indenting. Those the
 * window's chords share are `CODE_EDITOR_SHORTCUTS`.
 */
export const CODE_EDITOR_KEYS: readonly KeyBinding[] = [
  ...searchKeymap,
  ...defaultKeymap,
  ...historyKeymap,
  indentWithTab,
];
