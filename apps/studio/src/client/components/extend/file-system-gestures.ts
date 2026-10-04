import type { SelectionMode } from "./file-system-selection";

/**
 * A row pressed the way the Finder's are, as a state machine over the
 * pointer's presses and clicks.
 *
 * - A mouse selects on the way down, so a column opens a beat before the
 *   button comes up; a touch or an assistive tool selects on the click it
 *   makes.
 * - Pressed alone, a row already among several selected leaves them standing,
 *   so they can be dragged and a double-click can open them all. The click
 *   narrows them to its row only once a second click has had time not to
 *   come.
 * - A second, unhurried click on the name of the one thing selected renames
 *   it, once a double-click (which opens) has had time to claim it.
 *
 * Both waits are one state, `waiting`, since they never overlap: narrowing
 * needs several selected and renaming needs one. Anything else first (another
 * press, a double-click, a key, a scroll, the selection moving) calls the
 * wait off. A new press elsewhere lands a pending narrowing before it answers,
 * so it acts on the one row the narrowing left rather than the several before
 * it.
 *
 * `step` is pure: it returns the next state and what to do, and whoever runs
 * it owns the clock, sending `timeout` when `waitFor` says the wait is over.
 */

export type GestureState =
  | { phase: "idle" }
  /** A press answered; its click is still to come. */
  | {
      path: string;
      phase: "pressed";
      /** Whether the click is what selects, for a press that is not a mouse's. */
      selectsOnClick: boolean;
      after: "narrow" | "rename" | null;
    }
  /** A click waiting out the double-click or slow-click time before it acts. */
  | { path: string; phase: "waiting"; after: "narrow" | "rename" };

export const GESTURE_IDLE: GestureState = { phase: "idle" };

/**
 * How long a click waits to be the first of a double-click before it narrows
 * several to one, in ms: Windows' default double-click time, a little past the
 * Mac's. The page cannot read the system's own setting.
 */
export const NARROW_AFTER_MS = 500;
/**
 * How long a second click on a selected name waits before it renames, so a
 * double-click can still claim it, the way the Finder waits.
 */
export const RENAME_AFTER_MS = 600;

/** The selection as the press found it. */
type SelectionAtPress = {
  /** Whether the pressed row is selected. */
  has: boolean;
  /** How many are selected. */
  size: number;
};

export type GestureEvent =
  | {
      button: number;
      /** A Control-click on a Mac, which is the right click and selects nothing. */
      isContextClick: boolean;
      /** Whether the press landed on the row's name rather than its glyph or the rest of it. */
      isOnName: boolean;
      mode: null | SelectionMode;
      path: string;
      pointerType: string;
      /** Whether a rename can start from this row at all. */
      renames: boolean;
      selection: SelectionAtPress;
      type: "press";
    }
  | {
      /** The click count the browser gives it: 2 for a double-click's second. */
      detail: number;
      isContextClick: boolean;
      mode: null | SelectionMode;
      path: string;
      type: "click";
    }
  | { type: "double-click" }
  /** A key, a scroll, or anything else that means the pointer's wait is not wanted. */
  | { type: "interrupt" }
  /** The selection changed; the one the keyboard is on is now `lead`. */
  | { lead: null | string; type: "selection" }
  /** The wait `waitFor` named is over. */
  | { lead: null | string; selectionSize: number; type: "timeout" };

export type GestureEffect =
  /** Select the row, alone or with the modifier the press carried. */
  | { mode: null | SelectionMode; path: string; type: "select" }
  /** Several selected become this one alone. */
  | { path: string; type: "narrow" }
  | { path: string; type: "rename" };

export function step(
  state: GestureState,
  event: GestureEvent,
): { effects: GestureEffect[]; state: GestureState } {
  switch (event.type) {
    case "press": {
      const effects: GestureEffect[] = [];
      // A narrowing still waiting for another row is over: it lands first.
      const narrowedElsewhere =
        state.phase === "waiting" &&
        state.after === "narrow" &&
        state.path !== event.path;
      if (narrowedElsewhere) {
        effects.push({ path: state.path, type: "narrow" });
      }
      const rename =
        event.renames &&
        event.isOnName &&
        event.button === 0 &&
        event.mode === null &&
        !event.isContextClick &&
        event.selection.has &&
        event.selection.size === 1 &&
        !narrowedElsewhere
          ? ("rename" as const)
          : null;
      if (
        event.pointerType !== "mouse" ||
        event.button !== 0 ||
        event.isContextClick
      ) {
        return {
          effects,
          state: {
            path: event.path,
            phase: "pressed",
            selectsOnClick: true,
            after: rename,
          },
        };
      }
      const narrow =
        !narrowedElsewhere &&
        event.mode === null &&
        event.selection.size > 1 &&
        event.selection.has;
      if (!narrow) {
        effects.push({ mode: event.mode, path: event.path, type: "select" });
      }
      return {
        effects,
        state: {
          path: event.path,
          phase: "pressed",
          selectsOnClick: false,
          after: narrow ? "narrow" : rename,
        },
      };
    }
    case "click": {
      const pressed =
        state.phase === "pressed" && state.path === event.path ? state : null;
      // A click no press here began (the keyboard's, or an assistive tool's)
      // selects as itself and leaves any wait alone.
      if (!pressed) {
        return {
          effects: event.isContextClick
            ? []
            : [{ mode: event.mode, path: event.path, type: "select" }],
          state,
        };
      }
      const effects: GestureEffect[] =
        pressed.selectsOnClick && !event.isContextClick
          ? [{ mode: event.mode, path: event.path, type: "select" }]
          : [];
      // The second click of a double-click waits for nothing: the
      // double-click is what answers it.
      if (pressed.after === null || event.detail >= 2) {
        return { effects, state: GESTURE_IDLE };
      }
      return {
        effects,
        state: { path: event.path, phase: "waiting", after: pressed.after },
      };
    }
    case "double-click":
    case "interrupt":
      return {
        effects: [],
        state:
          // A scroll or a key is no reason not to narrow; only a rename is
          // called off by them. A double-click calls off both.
          event.type === "interrupt" &&
          state.phase === "waiting" &&
          state.after === "narrow"
            ? state
            : GESTURE_IDLE,
      };
    case "selection":
      // Narrowing stands on the several it found, so any change to them
      // (an arrow, ⌘A, the caller selecting what it just made) calls it off;
      // a rename only of the row moving away.
      return {
        effects: [],
        state:
          state.phase !== "idle" &&
          (state.after === "narrow" ||
            (state.after === "rename" && state.path !== event.lead))
            ? GESTURE_IDLE
            : state,
      };
    case "timeout": {
      if (state.phase !== "waiting") return { effects: [], state };
      if (state.after === "narrow") {
        return {
          effects: [{ path: state.path, type: "narrow" }],
          state: GESTURE_IDLE,
        };
      }
      // A rename only of what is still the one thing selected.
      return {
        effects:
          event.lead === state.path && event.selectionSize === 1
            ? [{ path: state.path, type: "rename" }]
            : [],
        state: GESTURE_IDLE,
      };
    }
  }
}

/** How long the state waits before `timeout`, or null for a state that waits for nothing. */
export function waitFor(state: GestureState) {
  if (state.phase !== "waiting") return null;
  return state.after === "narrow" ? NARROW_AFTER_MS : RENAME_AFTER_MS;
}
