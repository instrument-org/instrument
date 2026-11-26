import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { currentOs } from "@/client/lib/utils";
import { type PageKey } from "@/shared/page-key";
import { atom, useSetAtom } from "jotai";
import { useEffect } from "react";

/**
 * Which numbers a held modifier puts up: the tab group's tabs while the tab
 * chord's modifier is held alone (⌘ on a Mac, Ctrl elsewhere), the sidebar's
 * groups while the group chord's is (⌃ on a Mac, Alt elsewhere, where Ctrl is
 * the tab key).
 */
export type HeldHint = "groups" | "tabs";

export const heldHintAtom = atom<HeldHint | undefined>(undefined);

/**
 * The sidebar's rows of groups in the order it shows them, for the group
 * chords to pick by place; undefined while no sidebar shows them.
 */
export const sidebarRowOrderAtom = atom<readonly string[] | undefined>(
  undefined,
);

/** How long a modifier is held alone before its numbers show, so a quick chord never flashes them. */
const HOLD_DELAY_MS = 500;

/** The hint a lone modifier key stands for on this system, if any. */
function hintOfKey(key: string, isMac: boolean): HeldHint | undefined {
  if (key === (isMac ? "Meta" : "Control")) {
    return "tabs";
  }
  if (key === (isMac ? "Control" : "Alt")) {
    return "groups";
  }
  return undefined;
}

type HoldKey = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "repeat" | "shiftKey"
>;

/** Whether the event's modifiers are its own key alone, with nothing joining it. */
function isAlone(event: HoldKey): boolean {
  const held = [
    event.altKey || event.key === "Alt",
    event.ctrlKey || event.key === "Control",
    event.metaKey || event.key === "Meta",
    event.shiftKey || event.key === "Shift",
  ].filter(Boolean).length;
  return held === 1;
}

/**
 * The hold's timing, apart from the DOM: a lone modifier pressed starts the
 * delay, and its hint shows once the delay runs out. Any other key, a second
 * modifier, any key let go, or the window's blur cancels the delay and takes
 * the hint down.
 */
export function createModifierHold({
  delayMs = HOLD_DELAY_MS,
  isMac,
  onChange,
  // Called through, never as `timers.set`: the browser's own refuses a
  // `this` other than the window.
  timers = {
    clear: (handle) => {
      clearTimeout(handle);
    },
    set: (run, ms) => setTimeout(run, ms),
  },
}: {
  delayMs?: number;
  isMac: boolean;
  onChange: (hint: HeldHint | undefined) => void;
  timers?: {
    clear: (handle: ReturnType<typeof setTimeout>) => void;
    set: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  };
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held: { hint: HeldHint; key: string } | undefined;
  let shown: HeldHint | undefined;
  const reset = () => {
    if (timer !== undefined) {
      timers.clear(timer);
      timer = undefined;
    }
    held = undefined;
    if (shown !== undefined) {
      shown = undefined;
      onChange(undefined);
    }
  };
  return {
    blur: reset,
    keydown: (event: HoldKey) => {
      // The modifier's own repeat while it is still held alone.
      if (event.repeat && held?.key === event.key) {
        return;
      }
      reset();
      const hint = hintOfKey(event.key, isMac);
      if (hint === undefined || !isAlone(event)) {
        return;
      }
      held = { hint, key: event.key };
      timer = timers.set(() => {
        timer = undefined;
        if (held) {
          shown = held.hint;
          onChange(shown);
        }
      }, delayMs);
    },
    keyup: reset,
  };
}

/**
 * The tab chords' numbers by tab: each of the first nine by place, with 9
 * only on a ninth tab that is also the last, since 9 picks the last tab
 * wherever it is (`tabAtChord`).
 */
export function tabChordNumbers(ids: readonly string[]): Map<string, number> {
  const numbers = new Map<string, number>();
  ids.slice(0, 9).forEach((id, index) => {
    if (index < 8 || ids.length === 9) {
      numbers.set(id, index + 1);
    }
  });
  return numbers;
}

/** The tab a tab chord's number picks: 1 to 8 by place, 9 the last. */
export function tabAtChord<T>(
  tabs: readonly T[],
  index: number,
): T | undefined {
  return index === 9 ? tabs.at(-1) : tabs[index - 1];
}

/** The group chords' numbers by group, the first nine rows by place. */
export function groupChordNumbers(
  groups: readonly string[],
): Map<string, number> {
  return new Map(groups.slice(0, 9).map((group, index) => [group, index + 1]));
}

/** A tab chord's keys as this system writes them: ⌘1, Ctrl+1. */
export function tabChordLabel(number: number): string {
  return formatAcceleratorText(`CmdOrCtrl+${number}`);
}

/** A group chord's keys as this system writes them: ⌃1, Alt+1. */
export function groupChordLabel(number: number): string {
  return formatAcceleratorText({
    darwin: `Control+${number}`,
    default: `Alt+${number}`,
  });
}

/** The window's hold, while one is listening, for keys only the main process saw. */
let windowHold: ReturnType<typeof createModifierHold> | undefined;

/**
 * Cancels the hold for a chord the main process answered before the window
 * saw its key (Cmd+T, Cmd+1), which counts as another key pressed.
 */
export function interruptHeldHints() {
  windowHold?.blur();
}

/** Hands the window's hold a key a browser page had the keyboard for (`PageKey`). */
export function holdPageKey(key: PageKey) {
  if (key.type === "blur") {
    windowHold?.blur();
  } else if (key.type === "keyDown") {
    windowHold?.keydown(key);
  } else {
    windowHold?.keyup();
  }
}

/** Puts the held modifier's numbers up and down as the window's keys go (`heldHintAtom`). */
export function useHeldChordHints() {
  const setHint = useSetAtom(heldHintAtom);
  useEffect(() => {
    const hold = createModifierHold({
      isMac: currentOs() === "mac",
      onChange: setHint,
    });
    windowHold = hold;
    const onBlur = () => {
      hold.blur();
    };
    window.addEventListener("keydown", hold.keydown, { capture: true });
    window.addEventListener("keyup", hold.keyup, { capture: true });
    window.addEventListener("blur", onBlur);
    // A press of the pointer is another key joining, as a ⌘-click is.
    window.addEventListener("pointerdown", onBlur, { capture: true });
    return () => {
      window.removeEventListener("keydown", hold.keydown, { capture: true });
      window.removeEventListener("keyup", hold.keyup, { capture: true });
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onBlur, { capture: true });
      hold.blur();
      if (windowHold === hold) {
        windowHold = undefined;
      }
    };
  }, [setHint]);
}
