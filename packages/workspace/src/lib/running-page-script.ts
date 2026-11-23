/**
 * What the app's browser and the `agent-browser` command say to each other
 * about a script a page is still running when the wait for its answer ends.
 *
 * agent-browser gives up on any one command after 30 seconds, so a script
 * that awaits longer cannot be answered in the command that started it. The
 * browser keeps the script's answer under an id and fails the command with a
 * message naming it; the shell command then asks for that answer with a
 * command of its own, as often as it takes.
 */

/** The ids the browser gives, as both sides read them. */
const ID = "[a-z0-9]{8}";

const NAMED_IN_MESSAGE = new RegExp(`\\[running script: (${ID})\\]`);

const ASKED_FOR = new RegExp(`^__instrumentRunningScript\\("(${ID})"\\)$`);

/**
 * What a command fails with when the script it sent is still running and the
 * page answers other questions, so the script is waiting rather than stuck.
 * Worded to pass through agent-browser as written: it rewrites any error that
 * mentions a "timeout", and treats "CDP command timed out" as a tab that
 * stopped responding.
 */
export function scriptStillRunningMessage({
  id,
  seconds,
}: {
  id: string;
  seconds: number;
}): string {
  return `The script was still running after ${seconds}s. The page is responsive, so the script is waiting on something that has not finished (a request, a timer, a promise). It keeps running in the page until it finishes or the page navigates, but its return value is not kept. For work this long, have the script save its results on \`window\` as it goes and read them with a later \`eval\`. [running script: ${id}]`;
}

/** The id of the running script a command's output names, if it names one. */
export function runningScriptNamedIn(output: string): string | undefined {
  return NAMED_IN_MESSAGE.exec(output)?.[1];
}

/** The script to send that asks for a running script's answer rather than running anything. */
export function runningScriptAnswerExpression(id: string): string {
  return `__instrumentRunningScript("${id}")`;
}

/** The id of the running script whose answer an expression asks for, if it asks for one. */
export function runningScriptAskedFor(expression: unknown): string | undefined {
  return typeof expression === "string"
    ? ASKED_FOR.exec(expression.trim())?.[1]
    : undefined;
}
