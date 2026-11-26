import { type PageKey } from "@/shared/page-key";
import { type Input } from "electron";

// AltGr arrives as Control and then AltGraph, with Ctrl and Alt both held.
const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift"]);

/** The modifiers whose hold puts numbers up (`useHeldChordHints`): ⌘ and ⌃ on a Mac, Ctrl and Alt elsewhere. */
function holdKeys(isMac: boolean): readonly string[] {
  return isMac ? ["Meta", "Control"] : ["Control", "Alt"];
}

/**
 * What a page's key means to its window's held-modifier numbers: a hold
 * modifier pressed or let go, or another key pressed or let go while one is
 * held, which ends a hold. Plain typing stays in the page, capitals and
 * Option's characters on a Mac and AltGr's (Ctrl and Alt together)
 * elsewhere included.
 */
export function pageKeyOfInput(
  input: Pick<
    Input,
    "alt" | "control" | "isAutoRepeat" | "key" | "meta" | "shift" | "type"
  >,
  isMac = process.platform === "darwin",
): PageKey | undefined {
  if (input.type !== "keyDown" && input.type !== "keyUp") {
    return undefined;
  }
  const anyHoldHeld = isMac
    ? input.meta || input.control
    : input.control || input.alt;
  if (holdKeys(isMac).includes(input.key)) {
    // A hold key itself, pressed or let go.
  } else if (MODIFIER_KEYS.has(input.key)) {
    if (!anyHoldHeld) {
      return undefined;
    }
  } else if (
    input.type !== "keyDown" ||
    !anyHoldHeld ||
    (!isMac && input.control && input.alt)
  ) {
    return undefined;
  }
  return {
    altKey: input.alt,
    ctrlKey: input.control,
    key: input.key,
    metaKey: input.meta,
    repeat: input.isAutoRepeat,
    shiftKey: input.shift,
    type: input.type,
  };
}
