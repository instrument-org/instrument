import { parseAgentBrowserArgs } from "./agent-browser-args";

/**
 * How long a command waits for a document that is still loading before it
 * runs anyway. A document that never finishes, such as one its server streams
 * without end, costs each command this much.
 */
export const DOCUMENT_WAIT_TIMEOUT_MS = 5000;

/**
 * Run ahead of a command that works on the page's elements or text.
 *
 * The CLI's actions return as soon as their input is delivered, and the
 * browser holds a command sent during a navigation until the new document
 * commits, then runs it there at once. A server that sends its `<head>` ahead
 * of the rest leaves that document without a `<body>` for as long as the rest
 * takes, so the command after a click that navigated finds `document.body`
 * null, no element for any selector, and an empty snapshot. Upstream resolves
 * this wait at once in a document that is past loading.
 */
export const DOCUMENT_WAIT_ARGS = [
  "wait",
  "--load",
  "domcontentloaded",
  "--timeout",
  String(DOCUMENT_WAIT_TIMEOUT_MS),
];

/**
 * Run after an action, to give the page one turn of its task queue before the
 * next command is sent.
 *
 * A form submits in a task of its own after the click that caused it, so for
 * a few milliseconds after the click returns no navigation has started and a
 * command sent then reads the page being left. One timer turn later the
 * navigation is under way, and the browser holds the next command for it.
 */
export const TASK_TURN_ARGS = [
  "eval",
  "new Promise((resolve) => setTimeout(resolve, 0))",
];

/**
 * How long the task turn may take. A page too busy to run a timer, or one a
 * dialog is blocking, costs an action this much; so does a navigation the
 * action started at once whose server is slower than this to answer, which
 * the next command then waits out instead.
 */
export const TASK_TURN_TIMEOUT_MS = 1000;

/**
 * Commands that find an element, read the page, or put input into it, by the
 * names the CLI takes at its top level. `storage` and `clipboard` are left
 * out: neither needs the document's elements.
 */
const DOCUMENT_COMMANDS = new Set([
  "check",
  "click",
  "dblclick",
  "diff",
  "download",
  "drag",
  "eval",
  "fill",
  "find",
  "focus",
  "frame",
  "highlight",
  "hover",
  "is",
  "key",
  "keyboard",
  "keydown",
  "keyup",
  "mouse",
  "pdf",
  "press",
  "read",
  "screenshot",
  "scroll",
  "scrollinto",
  "scrollintoview",
  "select",
  "snapshot",
  "tap",
  "type",
  "uncheck",
  "upload",
]);

/** `get` reads a document answers correctly while it is still loading. */
const LOADING_SAFE_GETS = new Set(["cdp-url", "title", "url"]);

/**
 * Whether a command needs the document's elements, so waits for one that is
 * still loading. Navigations wait for their own page, `wait` is the agent's
 * own waiting, and a command about tabs, dialogs or the session needs no
 * document at all.
 */
export function needsLoadedDocument(args: string[]): boolean {
  const { subArgs, subcommand } = parseAgentBrowserArgs(args);
  if (subcommand === undefined) {
    return false;
  }
  if (subcommand === "get") {
    const what = subArgs[1]?.value;
    return what !== undefined && !LOADING_SAFE_GETS.has(what);
  }
  return DOCUMENT_COMMANDS.has(subcommand);
}
