import type { SelectionMode } from "./file-system-selection";

/**
 * A row pressed the way the Finder's are, as a state machine over the
 * pointer's presses and clicks.
 *
 * - A row not yet selected is selected by the click, not the press, so a
 *   press that turns into a drag carries the row away without selecting it,
 *   and whatever the selection has open stays open, the way the Finder drags
 *   a file it has not selected. A mouse press with ⌘ or Shift, or on a row
 *   already selected, selects on the way down.
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
 * Beside an open file, a plain click on a folder goes into it, the way a plain
 * click on a file there shows it.
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

/** Where a pointer event landed, in the event's own client coordinates. */
export type GesturePoint = { x: number; y: number };

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
/** How long a press on the spot of a click still counts as its double, in ms. */
const SECOND_CLICK_WITHIN_MS = NARROW_AFTER_MS;
/** How far apart two clicks of one double-click can land, in px. */
const SECOND_CLICK_WITHIN_PX = 4;

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
      point: GesturePoint;
      type: "click";
      /** Whether a plain click on this row goes into it: a folder, beside an open file. */
      walks: boolean;
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
  | { path: string; type: "rename" }
  /** Go into this folder, by a click at `point`. */
  | { path: string; point: GesturePoint; type: "walk" };

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
      const selectsOnClick = event.mode === null && !event.selection.has;
      if (!narrow && !selectsOnClick) {
        effects.push({ mode: event.mode, path: event.path, type: "select" });
      }
      return {
        effects,
        state: {
          path: event.path,
          phase: "pressed",
          selectsOnClick,
          after: narrow ? "narrow" : rename,
        },
      };
    }
    case "click": {
      const pressed =
        state.phase === "pressed" && state.path === event.path ? state : null;
      if (
        event.walks &&
        event.mode === null &&
        !event.isContextClick &&
        event.detail < 2 &&
        // One of several is left to narrow or to open with the rest.
        pressed?.after !== "narrow"
      ) {
        return {
          effects: [{ path: event.path, point: event.point, type: "walk" }],
          state: GESTURE_IDLE,
        };
      }
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

/**
 * Going into a folder by one click moves everything under the pointer, so the
 * rest of a double-click from habit would land on whatever is there now: a row
 * to open, the back row, a column's header. A press on the same spot straight
 * after the click, and the click and double-click it makes, reach nothing.
 */
export function swallowSecondClick(point: GesturePoint) {
  let isClaimed = false;
  const types = [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
    "dblclick",
  ] as const;
  const stop = () => {
    window.clearTimeout(timer);
    for (const type of types) {
      window.removeEventListener(type, onEvent, true);
    }
  };
  const onEvent = (event: MouseEvent) => {
    if (!isClaimed) {
      isClaimed =
        event.type === "pointerdown" &&
        event.button === 0 &&
        Math.abs(event.clientX - point.x) <= SECOND_CLICK_WITHIN_PX &&
        Math.abs(event.clientY - point.y) <= SECOND_CLICK_WITHIN_PX;
      if (!isClaimed) {
        stop();
        return;
      }
    }
    event.stopPropagation();
    // A second click too slow to be a double-click has no double-click coming.
    if (
      event.type === "dblclick" ||
      (event.type === "click" && event.detail < 2)
    ) {
      stop();
    }
  };
  // Past the time a second press can start in. One already down gets a little
  // longer for its click, which a drag away never makes.
  let timer = window.setTimeout(() => {
    if (isClaimed) {
      timer = window.setTimeout(stop, SECOND_CLICK_WITHIN_MS);
    } else {
      stop();
    }
  }, SECOND_CLICK_WITHIN_MS);
  for (const type of types) {
    window.addEventListener(type, onEvent, true);
  }
}
