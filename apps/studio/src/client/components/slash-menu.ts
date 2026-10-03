import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from "prosemirror-state";

/** The slash being typed: where it starts, where the caret is, and what follows the slash. */
interface SlashMenuRange {
  from: number;
  query: string;
  to: number;
}

export interface SlashMenuState {
  /** Which row is marked. */
  index: number;
  menu: null | SlashMenuRange;
  /**
   * Whether the list should bring the marked row into view. Only the keyboard
   * and typing drag the list to it; doing it on hover too would scroll a
   * partly visible row under a stationary cursor, which lands the cursor on the
   * next row and scrolls again.
   */
  scroll: boolean;
}

type SlashMenuMeta =
  | { count: number; direction: -1 | 1; type: "move" }
  | { index: number; type: "hover" }
  | { type: "close" };

const CLOSED: SlashMenuState = { index: 0, menu: null, scroll: false };

const slashMenuKey = new PluginKey<SlashMenuState>("slashMenu");

/**
 * The menu a typed slash opens, held in the editor's state so every
 * transaction decides it: an edit or a caret move reads it again from the
 * text before the caret, and the menu's own moves (the arrows, a hover, a
 * close) arrive as metadata on a transaction of their own.
 */
export function slashMenuPlugin() {
  return new Plugin<SlashMenuState>({
    key: slashMenuKey,
    state: {
      apply: (transaction, value, _previous, next) =>
        nextSlashMenu(value, transaction, next),
      // Closed until the first transaction, so a draft picked back up with a
      // slash at its end does not open the menu before anyone types.
      init: () => CLOSED,
    },
  });
}

/** The menu as a state stands; closed for a state without the plugin. */
export function slashMenuOf(state: EditorState): SlashMenuState {
  return slashMenuKey.getState(state) ?? CLOSED;
}

export const closeSlashMenu = (state: EditorState) =>
  withMeta(state, { type: "close" });

export const hoverSlashMenu = (state: EditorState, index: number) =>
  withMeta(state, { index, type: "hover" });

/** Moves the mark one row through a list of `count`, wrapping at either end. */
export const moveSlashMenu = (
  state: EditorState,
  direction: -1 | 1,
  count: number,
) => withMeta(state, { count, direction, type: "move" });

function isSlashMenuMeta(value: unknown): value is SlashMenuMeta {
  return typeof value === "object" && value !== null && "type" in value;
}

function nextSlashMenu(
  value: SlashMenuState,
  transaction: Transaction,
  next: EditorState,
): SlashMenuState {
  const meta: unknown = transaction.getMeta(slashMenuKey);
  if (!isSlashMenuMeta(meta)) {
    return { index: 0, menu: slashRangeAt(next), scroll: true };
  }
  if (meta.type === "close") {
    return CLOSED;
  }
  if (value.menu === null) {
    return value;
  }
  if (meta.type === "hover") {
    return { ...value, index: meta.index, scroll: false };
  }
  return {
    ...value,
    index: (value.index + meta.direction + meta.count) % meta.count,
    scroll: true,
  };
}

/** The slash the caret is in, if it is in one. */
function slashRangeAt(state: EditorState): null | SlashMenuRange {
  const { empty, from } = state.selection;
  if (!empty) {
    return null;
  }
  const before = state.doc.textBetween(0, from, "\n", "\uFFFC");
  // The colon belongs to the name: a skill several sources ship is addressed
  // as `claude:pdf`, and stopping the query at the colon would close the menu
  // exactly when the user is disambiguating.
  const match = /(?:^|\s)\/([\w:-]*)$/.exec(before);
  return match
    ? {
        from: from - (match[1]?.length ?? 0) - 1,
        query: match[1] ?? "",
        to: from,
      }
    : null;
}

function withMeta(state: EditorState, meta: SlashMenuMeta) {
  return state.tr.setMeta(slashMenuKey, meta);
}
