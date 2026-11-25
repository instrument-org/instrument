// A chord as a script writes it ("Meta+Shift+t", "Escape", "cmd+,") turned
// into what Electron's sendInputEvent takes and what a menu accelerator is
// matched against. Pure (keys.test.mjs).

const MODIFIERS = {
  alt: "alt",
  cmd: "meta",
  command: "meta",
  control: "control",
  ctrl: "control",
  meta: "meta",
  option: "alt",
  shift: "shift",
};

/** Named keys: what sendInputEvent calls each, and its DOM `key` and `code`. */
const NAMED = {
  arrowdown: ["Down", "ArrowDown", "ArrowDown"],
  arrowleft: ["Left", "ArrowLeft", "ArrowLeft"],
  arrowright: ["Right", "ArrowRight", "ArrowRight"],
  arrowup: ["Up", "ArrowUp", "ArrowUp"],
  backspace: ["Backspace", "Backspace", "Backspace"],
  delete: ["Delete", "Delete", "Delete"],
  down: ["Down", "ArrowDown", "ArrowDown"],
  end: ["End", "End", "End"],
  enter: ["Enter", "Enter", "Enter"],
  esc: ["Escape", "Escape", "Escape"],
  escape: ["Escape", "Escape", "Escape"],
  home: ["Home", "Home", "Home"],
  left: ["Left", "ArrowLeft", "ArrowLeft"],
  pagedown: ["PageDown", "PageDown", "PageDown"],
  pageup: ["PageUp", "PageUp", "PageUp"],
  return: ["Enter", "Enter", "Enter"],
  right: ["Right", "ArrowRight", "ArrowRight"],
  space: ["Space", " ", "Space"],
  tab: ["Tab", "Tab", "Tab"],
  up: ["Up", "ArrowUp", "ArrowUp"],
};

const PUNCTUATION_CODES = {
  "'": "Quote",
  ",": "Comma",
  "-": "Minus",
  ".": "Period",
  "/": "Slash",
  ";": "Semicolon",
  "=": "Equal",
  "[": "BracketLeft",
  "\\": "Backslash",
  "]": "BracketRight",
  "`": "Backquote",
};

/**
 * Parses a chord. Throws on a modifier it does not know, naming the ones it
 * does, rather than sending a different chord than the one written.
 */
export function parseChord(chord) {
  const text = String(chord);
  // A trailing `+` after another is the plus key: "Meta++".
  const isPlus = text === "+" || text.endsWith("++");
  const parts = isPlus ? text.slice(0, -2).split("+").filter(Boolean) : text.split("+");
  const last = isPlus ? "+" : parts.pop();
  const modifiers = [];
  for (const part of parts) {
    const modifier = MODIFIERS[part.trim().toLowerCase()];
    if (!modifier) {
      throw new Error(
        `Unknown modifier ${JSON.stringify(part)} in ${JSON.stringify(chord)}: use meta (cmd), control (ctrl), alt (option) or shift.`,
      );
    }
    if (!modifiers.includes(modifier)) {
      modifiers.push(modifier);
    }
  }
  const named = NAMED[last.toLowerCase()];
  let keyCode;
  let key;
  let code;
  if (named) {
    [keyCode, key, code] = named;
  } else if (/^f\d{1,2}$/i.test(last)) {
    keyCode = last.toUpperCase();
    key = keyCode;
    code = keyCode;
  } else if (Array.from(last).length === 1) {
    keyCode = last;
    key = modifiers.includes("shift") ? last.toUpperCase() : last.toLowerCase();
    code = /[a-z]/i.test(last)
      ? `Key${last.toUpperCase()}`
      : /\d/.test(last)
        ? `Digit${last}`
        : (PUNCTUATION_CODES[last] ?? last);
  } else {
    throw new Error(
      `Unknown key ${JSON.stringify(last)} in ${JSON.stringify(chord)}: a single character, F1 to F12, or one of ${Object.keys(NAMED).join(", ")}.`,
    );
  }
  return {
    code,
    key,
    keyCode,
    modifiers,
    /** What a menu accelerator is matched against. */
    input: {
      alt: modifiers.includes("alt"),
      code,
      control: modifiers.includes("control"),
      key,
      meta: modifiers.includes("meta"),
      shift: modifiers.includes("shift"),
    },
  };
}
