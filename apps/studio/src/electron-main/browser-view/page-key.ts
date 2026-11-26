import { type PageKey } from "@/shared/page-key";
import { type Input } from "electron";

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

/**
 * What a page's key means to its window's held-modifier numbers: a modifier
 * pressed or let go, or a key pressed while one is held, which ends a hold.
 * Plain typing stays in the page.
 */
export function pageKeyOfInput(
  input: Pick<
    Input,
    "alt" | "control" | "isAutoRepeat" | "key" | "meta" | "shift" | "type"
  >,
): PageKey | undefined {
  if (input.type !== "keyDown" && input.type !== "keyUp") {
    return undefined;
  }
  const isModifier = MODIFIER_KEYS.has(input.key);
  const isChord =
    input.type === "keyDown" && (input.alt || input.control || input.meta);
  if (!isModifier && !isChord) {
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
