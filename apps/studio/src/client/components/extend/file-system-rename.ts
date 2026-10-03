/**
 * A name typed over where it sits, as a state machine: asked for, typed,
 * saved, and put away. One rename at a time, and each one ends exactly once,
 * however many of Return, a press elsewhere and the field losing the keyboard
 * arrive to end it.
 *
 * - `waiting`: asked for before its row is listed, as a folder just made is
 *   named before the re-read that lists it; the field opens when the row
 *   arrives, and anything the person does first calls it off.
 * - `editing`: the field is open on the row.
 * - `saving`: the name was accepted and is being written; the field holds it,
 *   read only, so a second accept has nothing to accept. A write that fails
 *   goes back to `editing` with what was typed, rather than throwing it away.
 *
 * `renameStep` is pure; the component runs its effects.
 */

export type RenameState =
  | { phase: "idle" }
  | { path: string; phase: "waiting" }
  | {
      /** How many times the field has opened on this rename, so a field reopened after a failed save starts fresh. */
      attempt: number;
      /** What the field opens holding: the name, or what was typed before a save failed. */
      draft: string;
      name: string;
      path: string;
      phase: "editing";
    }
  | {
      attempt: number;
      draft: string;
      name: string;
      path: string;
      phase: "saving";
    };

export const RENAME_IDLE: RenameState = { phase: "idle" };

export type RenameEvent =
  /** Rename this row; `name` is its name when it is listed, and null while it is not yet. */
  | { name: null | string; path: string; type: "start" }
  /** The rows were listed again; `nameOf` says what a path is called, or null when it is not listed. */
  | { nameOf: (path: string) => null | string; type: "listed" }
  /** Return, a press elsewhere, or the field losing the keyboard, with what the field holds. */
  | { text: string; type: "accept" }
  /** Escape. */
  | { type: "cancel" }
  /** The person did something else first: pressed, typed, went to another folder. */
  | { type: "interrupt" }
  | { type: "saved" }
  | { type: "save-failed" };

export type RenameEffect =
  /** Write the new name. Answer with `saved` or `save-failed`. */
  | { name: string; path: string; type: "save" }
  /** The field is gone: the keyboard needs somewhere to be. */
  | { type: "ended" };

export function renameStep(
  state: RenameState,
  event: RenameEvent,
): { effects: RenameEffect[]; state: RenameState } {
  const stay = { effects: [], state };
  switch (event.type) {
    case "start":
      // A save in flight finishes first; a second rename waits for it.
      if (state.phase === "saving") return stay;
      return {
        effects: [],
        state:
          event.name === null
            ? { path: event.path, phase: "waiting" }
            : {
                attempt: 0,
                draft: event.name,
                name: event.name,
                path: event.path,
                phase: "editing",
              },
      };
    case "listed": {
      if (state.phase === "waiting") {
        const name = event.nameOf(state.path);
        return name === null
          ? stay
          : {
              effects: [],
              state: {
                attempt: 0,
                draft: name,
                name,
                path: state.path,
                phase: "editing",
              },
            };
      }
      // The row went out from under the field (trashed, renamed elsewhere):
      // there is nothing left to name.
      if (state.phase === "editing" && event.nameOf(state.path) === null) {
        return { effects: [{ type: "ended" }], state: RENAME_IDLE };
      }
      return stay;
    }
    case "accept": {
      if (state.phase !== "editing") return stay;
      const name = event.text.trim();
      // An empty or unchanged name is no rename.
      if (!name || name === state.name) {
        return { effects: [{ type: "ended" }], state: RENAME_IDLE };
      }
      return {
        effects: [{ name, path: state.path, type: "save" }],
        state: { ...state, draft: event.text, phase: "saving" },
      };
    }
    case "cancel":
      if (state.phase !== "editing" && state.phase !== "waiting") return stay;
      return {
        effects: state.phase === "editing" ? [{ type: "ended" }] : [],
        state: RENAME_IDLE,
      };
    case "interrupt":
      return state.phase === "waiting"
        ? { effects: [], state: RENAME_IDLE }
        : stay;
    case "saved":
      return state.phase === "saving"
        ? { effects: [{ type: "ended" }], state: RENAME_IDLE }
        : stay;
    case "save-failed":
      return state.phase === "saving"
        ? {
            effects: [],
            state: { ...state, attempt: state.attempt + 1, phase: "editing" },
          }
        : stay;
  }
}

/** The row whose name is being typed over or saved, if any. */
export function renamingPathOf(state: RenameState) {
  return state.phase === "editing" || state.phase === "saving"
    ? state.path
    : null;
}
