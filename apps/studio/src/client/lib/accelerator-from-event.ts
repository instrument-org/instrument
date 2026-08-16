/**
 * Turns a recorded keypress into an Electron accelerator.
 *
 * Reads `event.code` rather than `event.key` for the non-modifier key: `key`
 * carries what the modifiers produced (Option+S is `ß` on a US Mac layout),
 * which is not what the chord should be named after.
 */

type Recorded =
  | { accelerator: string; kind: "ok" }
  | { kind: "incomplete" }
  | { kind: "unsupported"; reason: string };

// Held alone these are not a chord yet, so recording keeps waiting rather than
// rejecting what the user is still in the middle of pressing.
const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

// Codes whose Electron name is not just the code with its prefix removed.
const NAMED_KEYS: Record<string, string | undefined> = {
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Enter: "Return",
  Equal: "=",
  Minus: "-",
  NumpadEnter: "Return",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
};

// Codes that are already their own Electron name.
const PASS_THROUGH_KEYS = new Set([
  "Backspace",
  "Delete",
  "End",
  "Escape",
  "Home",
  "Insert",
  "PageDown",
  "PageUp",
  "Space",
  "Tab",
]);

export function acceleratorFromEvent(
  event: Pick<
    KeyboardEvent,
    "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey"
  >,
  { isMac }: { isMac: boolean },
): Recorded {
  if (MODIFIER_CODES.has(event.code)) {
    return { kind: "incomplete" };
  }

  const key = electronKeyName(event.code);
  if (!key) {
    return {
      kind: "unsupported",
      reason: "That key can't be part of a shortcut.",
    };
  }

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push(isMac ? "Command" : "Super");

  // A global chord with no modifier would swallow that key from every app on
  // the machine.
  if (modifiers.length === 0) {
    return {
      kind: "unsupported",
      reason: "Use at least one modifier, like ⌘ or ⌥.",
    };
  }

  return { accelerator: [...modifiers, key].join("+"), kind: "ok" };
}

function electronKeyName(code: string): null | string {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit\d$/.test(code)) {
    return code.slice(5);
  }
  if (/^Numpad\d$/.test(code)) {
    return code.slice(6);
  }
  if (/^F\d{1,2}$/.test(code)) {
    return code;
  }
  if (PASS_THROUGH_KEYS.has(code)) {
    return code;
  }
  return NAMED_KEYS[code] ?? null;
}
