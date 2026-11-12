import type { Protocol } from "devtools-protocol";
import type { KeyboardInputEvent, WebContents } from "electron";

import { CdpCommandTimeoutError } from "@instrument-org/workspace/electron";

import type { BrowserEntry } from "./entry";

import { log } from "./log";

// Agent typing that leaves the window's keyboard focus where it is.
//
// A guest is an inner WebContents of the Studio window, so CDP keyboard input
// sent on its debugger goes to whichever widget holds the window's focus, and
// typing into a guest the person is not in means taking their caret first
// (docs/findings/cdp-keyboard-input-follows-window-focus.md). Two Electron
// calls are addressed to the guest itself instead: `insertText` commits text
// through the guest renderer's own input method, the commit CDP
// `Input.insertText` makes, and `sendInputEvent` hands a key to the guest's own
// widget. The page sees the same trusted events either way. Neither reaches a
// frame in a process of its own, and `insertText` crashes the guest's renderer
// when nothing in the page holds focus, so both go through a check of where
// typing would land first. A frame in a process of its own is typed into on
// its own debugger session instead, where CDP input goes to the frame rather
// than to the window's focus. Anything none of these can carry falls back to
// the caller's focus-taking path.

/** The isolated world the check and its listeners run in, unseen by the page. */
const TYPING_WORLD = 1078;
// How many frames in processes of their own, one inside the next, focus is
// followed through.
const MAX_FRAME_DEPTH = 4;

// One page round trip; a page that does not answer this fast is not typed into
// blind.
const PROBE_TIMEOUT_MS = 1000;
// What the commit itself gets, the budget every other keyboard command has.
const COMMIT_TIMEOUT_MS = 5000;
// How long a key waits for the page to have handled it. A page that swallows
// the event at the window before our listener sees it costs this much and no
// more.
const KEY_HANDLED_TIMEOUT_MS = 1000;
// After a key's keydown, how long to wait for the keypress its character
// brings. A page that prevents the keydown suppresses the keypress, so none
// may come.
const KEYPRESS_GRACE_MS = 50;

// Input.dispatchKeyEvent modifier bits.
const ALT = 1;
const CONTROL = 2;
const META = 4;
const SHIFT = 8;

/**
 * The keys with a name, as CDP's `key` gives them, mapped to Electron's key
 * code and the character a `char` event carries for them, when they type one.
 * Only these and single printable ASCII characters are carried: anything else
 * (a modifier on its own, a media key, a character beyond US layout) keeps the
 * focus-taking path, which sends the event exactly as it came.
 */
const NAMED_KEYS: Record<string, { char?: string; keyCode: string }> = {
  " ": { char: " ", keyCode: "Space" },
  ArrowDown: { keyCode: "Down" },
  ArrowLeft: { keyCode: "Left" },
  ArrowRight: { keyCode: "Right" },
  ArrowUp: { keyCode: "Up" },
  Backspace: { keyCode: "Backspace" },
  Delete: { keyCode: "Delete" },
  End: { keyCode: "End" },
  Enter: { char: "\r", keyCode: "Enter" },
  Escape: { keyCode: "Escape" },
  Home: { keyCode: "Home" },
  Insert: { keyCode: "Insert" },
  PageDown: { keyCode: "PageDown" },
  PageUp: { keyCode: "PageUp" },
  Tab: { char: "\t", keyCode: "Tab" },
  ...Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => [
      `F${i + 1}`,
      { keyCode: `F${i + 1}` },
    ]),
  ),
};

const PRINTABLE_ASCII = /^[\x21-\x7e]$/u;

/**
 * The Electron input events that carry one CDP key event to a guest without
 * its focus, or undefined when there is no faithful translation: a chord with
 * Control, Alt or Meta (editing commands and menus ride on those, and macOS
 * needs the `commands` field only CDP has), an event carrying its own
 * `commands`, a key outside the table, or text the key would not type.
 */
export function electronKeyEvents(
  params: Protocol.Input.DispatchKeyEventRequest,
): KeyboardInputEvent[] | undefined {
  const bits = params.modifiers ?? 0;
  if (bits & (ALT | CONTROL | META) || params.commands?.length) {
    return undefined;
  }
  const named = params.key === undefined ? undefined : NAMED_KEYS[params.key];
  const key =
    named ??
    (params.key !== undefined && PRINTABLE_ASCII.test(params.key)
      ? { char: params.key, keyCode: params.key }
      : undefined);
  if (!key) {
    return undefined;
  }
  // Electron reads a capital's key code as its lowercase key, so Shift is what
  // makes the page see "A"; a shifted symbol ("!") gets Shift from Electron.
  const modifiers: KeyboardInputEvent["modifiers"] =
    bits & SHIFT || /^[A-Z]$/u.test(params.key ?? "") ? ["shift"] : [];
  const text = params.text ?? "";
  if (text !== "" && text !== key.char) {
    return undefined;
  }
  const event = (
    type: KeyboardInputEvent["type"],
    keyCode: string,
  ): KeyboardInputEvent => ({ keyCode, modifiers, type });
  switch (params.type) {
    case "char":
      return key.char && text ? [event("char", key.char)] : undefined;
    case "keyDown":
      return key.char && text
        ? [event("keyDown", key.keyCode), event("char", key.char)]
        : [event("keyDown", key.keyCode)];
    case "keyUp":
      return [event("keyUp", key.keyCode)];
    case "rawKeyDown":
      return [event("keyDown", key.keyCode)];
  }
  return undefined;
}

/**
 * The last DOM event a key event produces, which the page has handled once it
 * fires: a character's keypress (Enter's included), otherwise the keydown or
 * keyup itself. Tab types a character Chromium never fires a keypress for.
 */
export function lastKeyEvent(
  params: Protocol.Input.DispatchKeyEventRequest,
): "keydown" | "keypress" | "keyup" {
  if (params.type === "keyUp") {
    return "keyup";
  }
  const text = params.text ?? "";
  const typesCharacter =
    params.type !== "rawKeyDown" &&
    (text === "\r" || (text.length > 0 && text !== "\t"));
  return typesCharacter ? "keypress" : "keydown";
}

/**
 * Runs in the guest's main frame, in the typing world: finds where typing goes
 * (through open shadow roots and same-origin frames) and, when it can be
 * carried there, starts listening on that document's window for what the
 * caller is about to send. Answers "frame" when focus is in a frame this world
 * cannot reach, which is one in a process of its own; "none" when text has no
 * field to go into; "armed" once listening.
 */
const ARM_SOURCE = `(mode, last, grace, limit) => {
  const TEXT_TYPES = ["", "email", "number", "password", "search", "tel", "text", "url"];
  let doc = document;
  let el = doc.activeElement;
  for (;;) {
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el || (el.localName !== "iframe" && el.localName !== "frame")) break;
    let inner = null;
    try { inner = el.contentDocument; } catch {}
    if (!inner) return "frame";
    doc = inner;
    el = inner.activeElement;
  }
  const field = !!el && (el.isContentEditable ||
    ((el.localName === "textarea" || (el.localName === "input" && TEXT_TYPES.includes(el.type))) && !el.readOnly && !el.disabled));
  if (mode === "text" && !field) return "none";
  const win = doc.defaultView;
  if (globalThis.__instrumentTyping) globalThis.__instrumentTyping.stop();
  const types = mode === "text" ? ["beforeinput", "input"] : ["keydown", "keypress", "keyup"];
  let seen = 0;
  let settle;
  let timer;
  const handled = new Promise((resolve) => { settle = resolve; });
  const finish = (how) => {
    clearTimeout(timer);
    // Answered after the task the event is in, so its default action has run.
    setTimeout(() => settle(how), 0);
  };
  const on = (event) => {
    if (!event.isTrusted) return;
    seen += 1;
    if (mode !== "key") return;
    if (event.type === last) finish(event.type);
    else if (event.type === "keydown" && last === "keypress") {
      clearTimeout(timer);
      timer = setTimeout(() => finish("keydown"), grace);
    }
  };
  for (const type of types) win.addEventListener(type, on, true);
  const stop = () => {
    clearTimeout(timer);
    for (const type of types) win.removeEventListener(type, on, true);
    if (globalThis.__instrumentTyping === state) globalThis.__instrumentTyping = undefined;
  };
  const state = {
    stop,
    seen: () => { stop(); return seen; },
    handled: () => {
      timer = setTimeout(() => finish("timeout"), limit);
      return handled.then((how) => { stop(); return how; });
    },
  };
  globalThis.__instrumentTyping = state;
  return "armed";
}`;

/** Why a command took the focus-taking path; logged with it. */
export type FocusFreeMiss =
  | "focus in a frame of its own"
  | "no text field has focus"
  | "no key translation"
  | "page did not answer"
  | "page fired no input event";

/** Where a command for a field in a frame of its own process goes: that frame's session. */
export type FrameRoute = { frameSession: string };

/**
 * Sends one keyboard command to the guest without taking the window's focus.
 * Answers `true` once the page has it; the frame session to send it on when
 * focus is in a frame of its own process; or the reason it could not be
 * carried, in which case nothing was sent and the caller sends it the
 * focus-taking way. A commit that never answers throws, since it may have
 * landed.
 */
export async function typeWithoutFocus(
  entry: BrowserEntry,
  method: string,
  params: unknown,
): Promise<FocusFreeMiss | FrameRoute | true> {
  const wc = entry.webContents;
  if (!wc || wc.isDestroyed()) {
    return "page did not answer";
  }
  if (method === "Input.insertText") {
    // Cast: params crosses the string-keyed bridge from agent-browser.
    const { text } = (params ?? {}) as Protocol.Input.InsertTextRequest;
    return await insertText(entry, wc, text);
  }
  if (method === "Input.dispatchKeyEvent") {
    const event = (params ?? {}) as Protocol.Input.DispatchKeyEventRequest;
    return await sendKey(entry, wc, event);
  }
  return "no key translation";
}

async function insertText(
  entry: BrowserEntry,
  wc: WebContents,
  text: string,
): Promise<FocusFreeMiss | FrameRoute | true> {
  // Nothing to commit, and a commit of nothing fires no event to confirm it.
  if (text === "") {
    return true;
  }
  const armed = await arm(wc, "text");
  if (armed === "focus in a frame of its own") {
    return (await frameRoute(entry, wc, "text")) ?? armed;
  }
  if (armed !== true) {
    return armed;
  }
  await withinTimeout(
    wc.insertText(text),
    COMMIT_TIMEOUT_MS,
    () =>
      new CdpCommandTimeoutError(
        "Input.insertText",
        "CDP command timed out: Input.insertText. The page did not take the text within 5s; it may be unresponsive. Take a snapshot to see whether the text landed before typing it again.",
      ),
  );
  // The page fires beforeinput and input for a commit that reached its field,
  // even one it then cancels; none means the text went nowhere.
  const seen = await inTypingWorld(
    wc,
    "globalThis.__instrumentTyping?.seen() ?? 0",
  );
  if (typeof seen !== "number" || seen === 0) {
    return "page fired no input event";
  }
  tally(entry, "text");
  return true;
}

async function sendKey(
  entry: BrowserEntry,
  wc: WebContents,
  params: Protocol.Input.DispatchKeyEventRequest,
): Promise<FocusFreeMiss | FrameRoute | true> {
  const events = electronKeyEvents(params);
  if (!events) {
    // CDP carries what Electron's key events cannot (a chord's editing
    // commands) to a frame of its own on the frame's session.
    return (await frameRoute(entry, wc, "keys")) ?? "no key translation";
  }
  const armed = await arm(wc, "key", lastKeyEvent(params));
  if (armed === "focus in a frame of its own") {
    return (await frameRoute(entry, wc, "keys")) ?? armed;
  }
  if (armed !== true) {
    return armed;
  }
  for (const event of events) {
    wc.sendInputEvent(event);
  }
  // CDP answers a key once the page has handled it, and agent-browser's next
  // command (a snapshot, the key's release) assumes it has; sendInputEvent
  // answers at once, so wait for the page to see the key's last event.
  const how = await inTypingWorld(
    wc,
    "globalThis.__instrumentTyping?.handled()",
    KEY_HANDLED_TIMEOUT_MS + PROBE_TIMEOUT_MS,
  );
  if (how === "timeout" || how === undefined) {
    log.debug(
      `key ${params.type} ${params.key ?? ""} sent without focus targetId=${entry.targetId}: the page did not report handling it within ${KEY_HANDLED_TIMEOUT_MS}ms`,
    );
  }
  tally(entry, "keys");
  return true;
}

async function arm(
  wc: WebContents,
  mode: "key" | "text",
  last?: string,
): Promise<FocusFreeMiss | true> {
  const answer = await inTypingWorld(
    wc,
    `(${ARM_SOURCE})(${JSON.stringify(mode)}, ${JSON.stringify(last ?? "")}, ${KEYPRESS_GRACE_MS}, ${KEY_HANDLED_TIMEOUT_MS})`,
  );
  switch (answer) {
    case "armed":
      return true;
    case "frame":
      return "focus in a frame of its own";
    case "none":
      return "no text field has focus";
    default:
      return "page did not answer";
  }
}

/**
 * The page's main world, run through the debugger: the owner element of the
 * frame in a process of its own that focus is in, reached the way the arm
 * check walks, or null when focus is not in one.
 */
const FOCUSED_FRAME_OWNER = `(() => {
  let el = document.activeElement;
  for (;;) {
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el || (el.localName !== "iframe" && el.localName !== "frame")) return null;
    let inner = null;
    try { inner = el.contentDocument; } catch {}
    if (!inner) return el;
    el = inner.activeElement;
  }
})()`;

/**
 * The frame session to type on when focus is in a frame of its own process,
 * counted as typed; undefined when it is not, or the debugger has not attached
 * that frame, which happens only before the agent asks for the page's frames.
 */
async function frameRoute(
  entry: BrowserEntry,
  wc: WebContents,
  kind: "keys" | "text",
): Promise<FrameRoute | undefined> {
  let frameSession: string | undefined;
  for (let depth = 0; depth < MAX_FRAME_DEPTH; depth++) {
    const frameId = await focusedFrameId(wc, frameSession);
    if (frameId === undefined) {
      break;
    }
    frameSession = entry.frameSessions.get(frameId);
    if (frameSession === undefined) {
      return undefined;
    }
  }
  if (frameSession === undefined) {
    return undefined;
  }
  tally(entry, kind);
  return { frameSession };
}

/**
 * The id of the frame in a process of its own that focus is in, asked of the
 * page (or of a frame, on its session). Chromium names such a frame's target
 * by this id, so it is what `frameSessions` is keyed by.
 */
async function focusedFrameId(
  wc: WebContents,
  frameSession: string | undefined,
): Promise<string | undefined> {
  const send = (method: string, params: object) =>
    frameSession === undefined
      ? wc.debugger.sendCommand(method, params)
      : wc.debugger.sendCommand(method, params, frameSession);
  try {
    // Cast: the debugger answers CDP commands untyped.
    const { result } = (await withinTimeout(
      send("Runtime.evaluate", {
        expression: FOCUSED_FRAME_OWNER,
        silent: true,
      }),
      PROBE_TIMEOUT_MS,
      () => new Error("the page did not answer"),
    )) as Protocol.Runtime.EvaluateResponse;
    const { objectId } = result;
    if (objectId === undefined) {
      return undefined;
    }
    try {
      // Cast: as above.
      const { node } = (await send("DOM.describeNode", {
        objectId,
      })) as Protocol.DOM.DescribeNodeResponse;
      return node.frameId;
    } finally {
      send("Runtime.releaseObject", { objectId }).catch(() => undefined);
    }
  } catch {
    return undefined;
  }
}

/**
 * Keeps `entry.frameSessions` to what the guest's debugger has attached, from
 * its attach and detach events.
 */
export function noteFrameSession(
  entry: BrowserEntry,
  method: string,
  params: unknown,
): void {
  if (method === "Target.attachedToTarget") {
    // Cast: debugger events arrive untyped.
    const { sessionId, targetInfo } =
      params as Protocol.Target.AttachedToTargetEvent;
    if (targetInfo.type === "iframe") {
      entry.frameSessions.set(targetInfo.targetId, sessionId);
    }
  } else if (method === "Target.detachedFromTarget") {
    // Cast: as above.
    const { sessionId } = params as Protocol.Target.DetachedFromTargetEvent;
    for (const [frameId, session] of entry.frameSessions) {
      if (session === sessionId) {
        entry.frameSessions.delete(frameId);
      }
    }
  }
}

/** Runs a script in the typing world; undefined when the page fails or does not answer in time. */
async function inTypingWorld(
  wc: WebContents,
  code: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<unknown> {
  return await withinTimeout(
    Promise.resolve()
      .then(
        // Cast: Electron types the script's answer as `any`.
        () =>
          wc.executeJavaScriptInIsolatedWorld(TYPING_WORLD, [
            { code },
          ]) as Promise<unknown>,
      )
      .catch(() => undefined),
    timeoutMs,
    () => undefined,
  );
}

async function withinTimeout<T>(
  answer: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error | T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      answer,
      new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => {
          const outcome = onTimeout();
          if (outcome instanceof Error) {
            reject(outcome);
          } else {
            resolve(outcome);
          }
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// How long a tab's typing has to be quiet before its tally is logged, so a
// burst of characters is one line rather than one per character.
const TALLY_QUIET_MS = 3000;

const tallies = new WeakMap<
  BrowserEntry,
  { keys: number; text: number; timer: ReturnType<typeof setTimeout> }
>();

/**
 * Counts what each tab was sent without focus and logs it once the tab's
 * typing goes quiet: set beside the focus-taking path's own lines, these say
 * how much agent typing now leaves the person's caret alone.
 */
function tally(entry: BrowserEntry, kind: "keys" | "text") {
  const current = tallies.get(entry);
  if (current) {
    clearTimeout(current.timer);
  }
  const counts = {
    keys: (current?.keys ?? 0) + (kind === "keys" ? 1 : 0),
    text: (current?.text ?? 0) + (kind === "text" ? 1 : 0),
  };
  tallies.set(entry, {
    ...counts,
    timer: setTimeout(() => {
      tallies.delete(entry);
      log.info(
        `typed without focus targetId=${entry.targetId} text=${counts.text} keys=${counts.keys}`,
      );
    }, TALLY_QUIET_MS),
  });
}
