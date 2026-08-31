/**
 * Matches an Electron-shaped accelerator against a raw key event, so the main
 * process can run the app's own chords before the focused page sees them.
 *
 * A character key is decided on `key`, the character the layout produced, not on
 * `code`, the physical position. The native menu decides on the character too --
 * an accelerator becomes an `NSMenuItem` key equivalent that Cocoa matches
 * against what the key types, and a layout-mapped VKEY elsewhere -- so anything
 * position-based disagrees with the menu on every non-QWERTY layout. On AZERTY
 * the Z key sits where QWERTY keeps W, so a position-based `CmdOrCtrl+W` would
 * fire on Cmd+Z and swallow the user's undo.
 *
 * `code` is kept for the keys whose character can't decide them: the numpad,
 * whose `+` reports the same character as a shifted `=`, and the named keys that
 * produce no character at all.
 *
 * Alt is the exception, because it rewrites the character a key types: on macOS
 * `key` is the composed character, so Option+A arrives as `å`. A chord holding
 * Alt is therefore decided on `code`, and only for the keys whose position this
 * can name -- letters, digits, and the keys that were already positional.
 * Anything else under Alt is refused rather than matched against a character
 * that never arrives. The cost is the disagreement described above, in the one
 * place it is unavoidable: a positional chord follows the physical key across
 * layouts while its menu item follows the character, so the two land on the
 * same key only where that key sits where QWERTY keeps it.
 */

import { type Input } from "electron";

/** An accelerator as the modifiers and the key event it stands for. */
export interface Chord {
  alt: boolean;
  /** Whether Shift is compared -- see `ignoresShift` on `KeyDefinition`. */
  comparesShift: boolean;
  control: boolean;
  meta: boolean;
  /** Which part of the event `value` is matched against. */
  on: "code" | "key";
  shift: boolean;
  /** The expected `code`, or the expected `key` in lower case. */
  value: string;
}

/** What one key code from an accelerator expects of a key event. */
interface KeyDefinition {
  /**
   * The token already names a character that Shift produces (`Plus`, `?`), so
   * Shift is not compared: whether it takes Shift to type is the layout's
   * business. Electron leaves Shift off those accelerators for the same reason.
   */
  ignoresShift?: boolean;
  on: "code" | "key";
  /** The character the same key produces with Shift, where it differs. */
  shifted?: string;
  value: string;
}

/** The parts of a key event a chord is decided by. */
type KeyInput = Pick<
  Input,
  "alt" | "code" | "control" | "key" | "meta" | "shift"
>;

// The characters the digit row produces with Shift held, indexed by digit.
const DIGIT_SHIFTED = [")", "!", "@", "#", "$", "%", "^", "&", "*", "("];

// Every key code that names no character, as the `code` it arrives as. Function
// keys and numpad digits are derived in `keyDefinition` rather than listed.
const NAMED_CODES: Record<string, string> = {
  backspace: "Backspace",
  capslock: "CapsLock",
  delete: "Delete",
  down: "ArrowDown",
  end: "End",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  home: "Home",
  insert: "Insert",
  left: "ArrowLeft",
  medianexttrack: "MediaTrackNext",
  mediaplaypause: "MediaPlayPause",
  mediaprevioustrack: "MediaTrackPrevious",
  mediastop: "MediaStop",
  numadd: "NumpadAdd",
  numdec: "NumpadDecimal",
  numdiv: "NumpadDivide",
  numlock: "NumLock",
  nummult: "NumpadMultiply",
  numsub: "NumpadSubtract",
  pagedown: "PageDown",
  pageup: "PageUp",
  printscreen: "PrintScreen",
  return: "Enter",
  right: "ArrowRight",
  scrolllock: "ScrollLock",
  space: "Space",
  tab: "Tab",
  up: "ArrowUp",
  volumedown: "AudioVolumeDown",
  volumemute: "AudioVolumeMute",
  volumeup: "AudioVolumeUp",
};

// Punctuation, as the character its key makes and the one it makes with Shift.
// US positions, which is the layout Electron's own accelerator table assumes.
const PUNCTUATION: Record<string, string> = {
  "'": '"',
  ",": "<",
  "-": "_",
  ".": ">",
  "/": "?",
  ";": ":",
  "=": "+",
  "[": "{",
  "\\": "|",
  "]": "}",
  "`": "~",
};

// The shifted faces of the keys above, plus the digit row's. A token naming one
// of these is asking for that character however the layout types it.
const SHIFTED_CHARACTERS = new Set([
  ...DIGIT_SHIFTED,
  ...Object.values(PUNCTUATION),
]);

export function matchesAccelerator(
  input: KeyInput,
  accelerator: string,
  { isMac }: { isMac: boolean },
): boolean {
  const chord = parseAccelerator(accelerator, { isMac });
  if (!chord) {
    return false;
  }
  if (
    input.alt !== chord.alt ||
    input.control !== chord.control ||
    input.meta !== chord.meta
  ) {
    return false;
  }
  if (chord.comparesShift && input.shift !== chord.shift) {
    return false;
  }
  return chord.on === "code"
    ? input.code === chord.value
    : input.key.toLowerCase() === chord.value;
}

/**
 * The chord an accelerator stands for, or `null` if it names something outside
 * the vocabulary above. Refusing is deliberate: an accelerator this can't read
 * never fires at all, rather than firing on an approximation of itself.
 */
export function parseAccelerator(
  accelerator: string,
  { isMac }: { isMac: boolean },
): Chord | null {
  const parts = accelerator.split("+");
  const key = parts.pop();
  if (!key) {
    return null;
  }

  let alt = false;
  let control = false;
  let meta = false;
  let shift = false;

  for (const part of parts) {
    switch (part.toLowerCase()) {
      case "alt":
      case "option": {
        alt = true;
        break;
      }
      case "cmd":
      case "command":
      case "meta":
      case "super": {
        meta = true;
        break;
      }
      case "cmdorctrl":
      case "commandorcontrol": {
        if (isMac) {
          meta = true;
        } else {
          control = true;
        }
        break;
      }
      case "control":
      case "ctrl": {
        control = true;
        break;
      }
      case "shift": {
        shift = true;
        break;
      }
      default: {
        return null;
      }
    }
  }

  const definition = keyDefinition(key, { alt });
  if (!definition) {
    return null;
  }
  return {
    alt,
    comparesShift: !definition.ignoresShift,
    control,
    meta,
    on: definition.on,
    shift,
    // Spelling Shift out asks for the character the key makes with it held:
    // `Shift+[` is typed, and reported, as `{`.
    value: shift && definition.shifted ? definition.shifted : definition.value,
  };
}

function keyDefinition(
  key: string,
  { alt }: { alt: boolean },
): KeyDefinition | null {
  const token = key.toLowerCase();
  // Held Alt puts a different character on the event than the key is named
  // for, so the letters and digits are read as the positions they sit at and
  // the keys that carry a character no position can name are refused. See the
  // note at the top of the file.
  if (alt) {
    if (/^[a-z]$/.test(token)) {
      return { on: "code", value: `Key${token.toUpperCase()}` };
    }
    if (/^\d$/.test(token)) {
      return { on: "code", value: `Digit${token}` };
    }
    return positionalDefinition(token);
  }
  // A letter's shifted face is its upper case, which the comparison folds away.
  if (/^[a-z]$/.test(token)) {
    return { on: "key", value: token };
  }
  if (/^\d$/.test(token)) {
    return { on: "key", shifted: DIGIT_SHIFTED[Number(token)], value: token };
  }
  if (token === "plus") {
    return { ignoresShift: true, on: "key", value: "+" };
  }
  const shifted = PUNCTUATION[token];
  if (shifted) {
    return { on: "key", shifted, value: token };
  }
  if (SHIFTED_CHARACTERS.has(token)) {
    return { ignoresShift: true, on: "key", value: token };
  }
  return positionalDefinition(token);
}

/**
 * The keys that name a position rather than a character: the function row, the
 * numpad, and the named keys that type nothing at all. They are decided on
 * `code` whatever is held, so Alt leaves them alone.
 */
function positionalDefinition(token: string): KeyDefinition | null {
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(token)) {
    return { on: "code", value: token.toUpperCase() };
  }
  if (/^num\d$/.test(token)) {
    return { on: "code", value: `Numpad${token.slice(3)}` };
  }
  const code = NAMED_CODES[token];
  return code ? { on: "code", value: code } : null;
}
