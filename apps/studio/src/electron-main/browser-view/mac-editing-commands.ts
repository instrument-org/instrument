import type { Protocol } from "devtools-protocol";

// Input.dispatchKeyEvent modifier bits.
const ALT = 1;
const CONTROL = 2;
const META = 4;
const SHIFT = 8;

// macOS resolves Command chords through the application menu rather than in the
// renderer's own key bindings, and a CDP-injected key event never reaches a
// menu. Chromium's editing layer instead takes the command to run from the
// event's own `commands` field, so a chord that arrives without one is just a
// bare keystroke: `press Meta+A` reports success and selects nothing, and the
// text typed after it appends instead of replacing.
//
// Keyed on the physical `code` in the same modifier order the mapping is
// written in (Shift, Alt, Meta), with values as Chromium editing command names.
//
// Only Command chords are listed, for two reasons. Unmodified and Control-based
// editing keys are handled by the renderer itself, so attaching commands to
// those would change a path that already works. And the clipboard chords
// (Meta+C/X/V) are deliberately absent: routing them through this trusted path
// would hand a page the user's clipboard, which is a containment decision of
// its own rather than a keyboard-routing fix. Chromium blocks untrusted paste
// for the same reason.
const MAC_COMMAND_CHORDS = new Map<string, string>([
  ["Meta+ArrowDown", "moveToEndOfDocument"],
  ["Meta+ArrowLeft", "moveToLeftEndOfLine"],
  ["Meta+ArrowRight", "moveToRightEndOfLine"],
  ["Meta+ArrowUp", "moveToBeginningOfDocument"],
  ["Meta+Backspace", "deleteToBeginningOfLine"],
  ["Meta+KeyA", "selectAll"],
  ["Meta+KeyZ", "undo"],
  ["Shift+Meta+ArrowDown", "moveToEndOfDocumentAndModifySelection"],
  ["Shift+Meta+ArrowLeft", "moveToLeftEndOfLineAndModifySelection"],
  ["Shift+Meta+ArrowRight", "moveToRightEndOfLineAndModifySelection"],
  ["Shift+Meta+ArrowUp", "moveToBeginningOfDocumentAndModifySelection"],
  ["Shift+Meta+Backspace", "deleteToBeginningOfLine"],
  ["Shift+Meta+KeyZ", "redo"],
]);

// Only the key-down half of a chord carries an editing command; the key-up
// would run it a second time.
const COMMAND_BEARING_TYPES = new Set(["keyDown", "rawKeyDown"]);

/**
 * Fill in the `commands` an editing chord needs to reach the guest's editor on
 * macOS. Returns the params unchanged on other platforms, for other commands,
 * and whenever the caller set `commands` itself.
 */
export function withMacEditingCommands(
  method: string,
  params: unknown,
): unknown {
  if (method !== "Input.dispatchKeyEvent" || process.platform !== "darwin") {
    return params;
  }

  // Cast: params crosses a string-keyed bridge from the out-of-process
  // agent-browser client, so it arrives as unknown like every other command's.
  const event = (params ?? {}) as Protocol.Input.DispatchKeyEventRequest;
  if (!COMMAND_BEARING_TYPES.has(event.type) || event.commands?.length) {
    return params;
  }

  const modifiers = event.modifiers ?? 0;
  // Control appears in editing chords of its own on macOS, none of which
  // combine with Command, so its presence means this is not a chord we map.
  if (!(modifiers & META) || modifiers & CONTROL || modifiers & ALT) {
    return params;
  }

  const chord = `${modifiers & SHIFT ? "Shift+" : ""}Meta+${event.code ?? ""}`;
  const command = MAC_COMMAND_CHORDS.get(chord);
  return command ? { ...event, commands: [command] } : params;
}
