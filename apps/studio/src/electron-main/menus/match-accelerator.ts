/**
 * Matches an Electron-shaped accelerator against a raw key event, so the main
 * process can run the app's own chords before the focused page sees them.
 *
 * Matching is on `code` -- the physical key -- rather than `key`, because the
 * character a key produces depends on what is held down with it: `CmdOrCtrl+Plus`
 * is the `=` key with Shift on a US layout, and a letter reports uppercase the
 * moment Shift joins the chord. Electron resolves menu accelerators to physical
 * keys too, so both consumers of an entry mean the same key by it.
 */

import { type Input } from "electron";

/** An accelerator as the modifiers and physical key it stands for. */
export interface Chord {
  alt: boolean;
  code: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
}

/** A key code from an accelerator, as the key event it stands for. */
interface KeyDefinition {
  code: string;
  /**
   * Set for a key named by its shifted face. `Plus` and `?` are the `=` and `/`
   * keys with Shift held, so they carry a modifier the accelerator never spells
   * out. Positions are the US layout, which is the layout Electron resolves
   * accelerators against for the native menu.
   */
  shift?: boolean;
}

/** The parts of a key event a chord is decided by. */
type KeyInput = Pick<Input, "alt" | "code" | "control" | "meta" | "shift">;

// Every key code Electron's accelerator vocabulary names, as the key event it
// arrives as (docs/tutorial/keyboard-shortcuts.md). Letters, digits, function
// keys, and numpad digits are derived in `keyDefinition` rather than listed.
const KEYS: Record<string, KeyDefinition> = {
  "!": { code: "Digit1", shift: true },
  '"': { code: "Quote", shift: true },
  "#": { code: "Digit3", shift: true },
  $: { code: "Digit4", shift: true },
  "%": { code: "Digit5", shift: true },
  "&": { code: "Digit7", shift: true },
  "'": { code: "Quote" },
  "(": { code: "Digit9", shift: true },
  ")": { code: "Digit0", shift: true },
  "*": { code: "Digit8", shift: true },
  "+": { code: "Equal", shift: true },
  ",": { code: "Comma" },
  "-": { code: "Minus" },
  ".": { code: "Period" },
  "/": { code: "Slash" },
  ":": { code: "Semicolon", shift: true },
  ";": { code: "Semicolon" },
  "<": { code: "Comma", shift: true },
  "=": { code: "Equal" },
  ">": { code: "Period", shift: true },
  "?": { code: "Slash", shift: true },
  "@": { code: "Digit2", shift: true },
  "[": { code: "BracketLeft" },
  "\\": { code: "Backslash" },
  "]": { code: "BracketRight" },
  "^": { code: "Digit6", shift: true },
  _: { code: "Minus", shift: true },
  "`": { code: "Backquote" },
  backspace: { code: "Backspace" },
  capslock: { code: "CapsLock" },
  delete: { code: "Delete" },
  down: { code: "ArrowDown" },
  end: { code: "End" },
  enter: { code: "Enter" },
  esc: { code: "Escape" },
  escape: { code: "Escape" },
  home: { code: "Home" },
  insert: { code: "Insert" },
  left: { code: "ArrowLeft" },
  "{": { code: "BracketLeft", shift: true },
  "|": { code: "Backslash", shift: true },
  "}": { code: "BracketRight", shift: true },
  "~": { code: "Backquote", shift: true },
  // cspell:ignore medianexttrack mediaplaypause mediaprevioustrack mediastop
  medianexttrack: { code: "MediaTrackNext" },
  mediaplaypause: { code: "MediaPlayPause" },
  mediaprevioustrack: { code: "MediaTrackPrevious" },
  mediastop: { code: "MediaStop" },
  // cspell:ignore numadd numdec numdiv numlock nummult numsub
  numadd: { code: "NumpadAdd" },
  numdec: { code: "NumpadDecimal" },
  numdiv: { code: "NumpadDivide" },
  numlock: { code: "NumLock" },
  nummult: { code: "NumpadMultiply" },
  numsub: { code: "NumpadSubtract" },
  pagedown: { code: "PageDown" },
  pageup: { code: "PageUp" },
  plus: { code: "Equal", shift: true },
  printscreen: { code: "PrintScreen" },
  return: { code: "Enter" },
  right: { code: "ArrowRight" },
  // cspell:ignore scrolllock
  scrolllock: { code: "ScrollLock" },
  space: { code: "Space" },
  tab: { code: "Tab" },
  up: { code: "ArrowUp" },
  volumedown: { code: "AudioVolumeDown" },
  volumemute: { code: "AudioVolumeMute" },
  volumeup: { code: "AudioVolumeUp" },
};

export function matchesAccelerator(
  input: KeyInput,
  accelerator: string,
  { isMac }: { isMac: boolean },
): boolean {
  const chord = parseAccelerator(accelerator, { isMac });
  if (!chord) {
    return false;
  }
  return (
    input.alt === chord.alt &&
    input.code === chord.code &&
    input.control === chord.control &&
    input.meta === chord.meta &&
    input.shift === chord.shift
  );
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

  const chord: Chord = {
    alt: false,
    code: "",
    control: false,
    meta: false,
    shift: false,
  };

  for (const part of parts) {
    switch (part.toLowerCase()) {
      case "alt":
      case "option": {
        chord.alt = true;
        break;
      }
      case "cmd":
      case "command":
      case "meta":
      case "super": {
        chord.meta = true;
        break;
      }
      // cspell:ignore cmdorctrl commandorcontrol
      case "cmdorctrl":
      case "commandorcontrol": {
        if (isMac) {
          chord.meta = true;
        } else {
          chord.control = true;
        }
        break;
      }
      case "control":
      case "ctrl": {
        chord.control = true;
        break;
      }
      case "shift": {
        chord.shift = true;
        break;
      }
      default: {
        return null;
      }
    }
  }

  const definition = keyDefinition(key);
  if (!definition) {
    return null;
  }
  chord.code = definition.code;
  chord.shift ||= definition.shift ?? false;
  return chord;
}

function keyDefinition(key: string): KeyDefinition | null {
  const token = key.toLowerCase();
  if (/^[a-z]$/.test(token)) {
    return { code: `Key${token.toUpperCase()}` };
  }
  if (/^\d$/.test(token)) {
    return { code: `Digit${token}` };
  }
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(token)) {
    return { code: token.toUpperCase() };
  }
  if (/^num\d$/.test(token)) {
    return { code: `Numpad${token.slice(3)}` };
  }
  return KEYS[token] ?? null;
}
