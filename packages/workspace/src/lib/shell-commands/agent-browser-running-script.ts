import ms from "ms";

import {
  runningScriptAnswerExpression,
  runningScriptNamedIn,
} from "../running-page-script";
import { parseAgentBrowserArgs } from "./agent-browser-args";

/**
 * How long `eval` waits on one script before it reports the script as still
 * running. The CLI gives up on any one command after 30 seconds, so a longer
 * script is waited on with a command per stretch, and this is where that
 * stops for a script that never finishes. It is the longest a bash call
 * itself waits.
 */
export const SCRIPT_WAIT_LIMIT_MS = ms("10 minutes");

interface Output {
  exitCode?: number | undefined;
  stderr: string;
  stdout: string;
}

/** Whether the invocation runs a script the agent wrote in the page. */
export function isEval(args: string[]): boolean {
  return parseAgentBrowserArgs(args).subcommand === "eval";
}

/**
 * An `eval` invocation with its script replaced by the request for a running
 * script's answer, which keeps the flags the output is printed by (`--json`).
 */
export function askForAnswerArgs(args: string[], id: string): string[] {
  const script = new Set(
    parseAgentBrowserArgs(args)
      .subArgs.slice(1)
      .map(({ index }) => index),
  );
  return [
    ...args.filter((_, index) => !script.has(index)),
    runningScriptAnswerExpression(id),
  ];
}

/**
 * The result of an `eval` whose script the page was still running when the
 * command came back: the script's own answer once it finishes, asked for with
 * one command after another, each of which waits as long as a command may.
 * Any other result is returned as it came. Stops asking when the call is
 * canceled or the script has outlasted SCRIPT_WAIT_LIMIT_MS, and returns the
 * last answer, which says the script is still running.
 */
export async function awaitRunningScript<R extends Output>({
  ask,
  first,
  signal,
}: {
  /** Runs the command that asks for the running script's answer. */
  ask: (id: string) => Promise<R>;
  first: R;
  signal: AbortSignal | undefined;
}): Promise<R> {
  const startedAt = Date.now();
  let result = first;
  for (;;) {
    const id =
      result.exitCode === 0
        ? undefined
        : runningScriptNamedIn(`${result.stderr}\n${result.stdout}`);
    if (
      id === undefined ||
      signal?.aborted === true ||
      Date.now() - startedAt >= SCRIPT_WAIT_LIMIT_MS
    ) {
      return result;
    }
    result = await ask(id);
  }
}
