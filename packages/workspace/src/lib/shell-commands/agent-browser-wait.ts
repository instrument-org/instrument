import { parseAgentBrowserArgs } from "./agent-browser-args";

/**
 * How long `wait --load networkidle` waits when the agent names no timeout.
 *
 * A page with nothing in flight goes quiet in about a second, and a page that
 * holds a beacon, a long poll or a stream open never does. Upstream then waits
 * out its 25-second default and reports `✓ Done` anyway, because the
 * load-state handler drops the inner wait's timeout error. Every Amazon search
 * and product page measured did that, as did most news and shop pages, so the
 * wait cost 25 seconds and told the agent nothing.
 */
const NETWORK_IDLE_TIMEOUT_MS = 5000;

/**
 * How long `wait --text`, `wait --url` and `wait <selector>` wait when the
 * agent names no timeout.
 *
 * In the app's history every one of these that succeeded did so within about
 * three seconds, page load and the step before it included, and every one that
 * reached upstream's 25-second default had been waiting for something that
 * never came. Ten seconds leaves a slower machine or network more than three
 * times the slowest success.
 */
const NAMED_WAIT_TIMEOUT_MS = 10_000;

/** What the agent reads when the capped network-idle wait gives up. */
export const NETWORK_IDLE_GAVE_UP = `The network did not go quiet within ${NETWORK_IDLE_TIMEOUT_MS / 1000} seconds. A page that keeps a connection open never goes quiet, but this one has loaded, so act on it, or wait for what you need with \`wait --text\`, \`wait <selector>\` or \`wait --url\`.\n`;

/**
 * A wait the harness gives its own timeout. `--fn` is left alone: its use here
 * is a document preview's readiness check, which takes as long as the
 * document takes to lay out.
 */
export type CappedWait =
  | { kind: "networkidle" }
  | { condition: string; kind: "text" }
  | { condition: string; kind: "url" }
  | { condition: string; kind: "selector"; state: string | undefined };

/**
 * The wait the harness caps, read the way upstream reads `wait`'s arguments
 * (`--url`, then `--load`, `--fn`, `--text`, `--download`, then a selector or
 * a number of milliseconds), or undefined when the agent passed its own
 * `--timeout` or the wait is not one the harness caps.
 */
export function uncappedWait(args: string[]): CappedWait | undefined {
  const { subArgs, subcommand } = parseAgentBrowserArgs(args);
  if (subcommand !== "wait") {
    return undefined;
  }
  const words = subArgs.slice(1).map(({ value }) => value);
  if (
    words.some((word) => word === "--timeout" || word.startsWith("--timeout="))
  ) {
    return undefined;
  }
  const flag = (...names: string[]) => {
    const index = words.findIndex((word) => names.includes(word));
    return index === -1 ? undefined : { value: words[index + 1] };
  };

  const url = flag("--url", "-u");
  if (url) {
    return url.value === undefined
      ? undefined
      : { condition: url.value, kind: "url" };
  }
  const load = flag("--load", "-l");
  if (load) {
    return load.value === "networkidle" ? { kind: "networkidle" } : undefined;
  }
  if (flag("--fn", "-f")) {
    return undefined;
  }
  const text = flag("--text", "-t");
  if (text) {
    return text.value === undefined
      ? undefined
      : { condition: text.value, kind: "text" };
  }
  if (flag("--download", "-d")) {
    return undefined;
  }
  const [selector] = words;
  if (
    selector === undefined ||
    selector.startsWith("-") ||
    /^\d+$/.test(selector)
  ) {
    return undefined;
  }
  return {
    condition: selector,
    kind: "selector",
    state: flag("--state")?.value,
  };
}

/** The invocation with the harness's timeout added to an uncapped wait. */
export function capWait(args: string[], wait: CappedWait | undefined) {
  if (!wait) {
    return args;
  }
  const timeoutMs =
    wait.kind === "networkidle"
      ? NETWORK_IDLE_TIMEOUT_MS
      : NAMED_WAIT_TIMEOUT_MS;
  return [...args, "--timeout", String(timeoutMs)];
}

/** What the agent reads when a capped named wait gives up. */
export function namedWaitGaveUp(
  wait: Exclude<CappedWait, { kind: "networkidle" }>,
): string {
  const [missed, what] =
    wait.kind === "text"
      ? [`The text "${wait.condition}" did not appear`, "text"]
      : wait.kind === "url"
        ? [`The page address did not match "${wait.condition}"`, "pattern"]
        : wait.state
          ? [`"${wait.condition}" did not become ${wait.state}`, "selector"]
          : [`Nothing on the page matched "${wait.condition}"`, "selector"];
  return `${missed} within ${NAMED_WAIT_TIMEOUT_MS / 1000} seconds, so the last step may not have done what you expected. Take a snapshot to see what the page shows now, and check the ${what} you waited for. If the page is only slow, wait again with a longer \`--timeout\`, such as \`--timeout 30000\`.\n`;
}

/**
 * The capped wait's result as the agent sees it.
 *
 * A network-idle timeout becomes a success that says the network stayed busy.
 * The page is as ready as a longer wait would make it (`open` already waited
 * for the load event), and a failure would end the `&&` chain the agent wrote
 * to read that page.
 *
 * A named wait's timeout stays a failure, since the next step in the chain
 * would act on a page that is not the one the agent expected, and its message
 * says what to do next instead of upstream's bare `Wait timed out`.
 */
export function cappedWaitResult(
  wait: CappedWait,
  result: { exitCode: number; stderr: string; stdout: string },
) {
  if (wait.kind === "networkidle") {
    const timedOut =
      result.exitCode !== 0 && /timed out|timeout/i.test(result.stderr);
    return timedOut
      ? { exitCode: 0, stderr: "", stdout: NETWORK_IDLE_GAVE_UP }
      : result;
  }
  const timedOut =
    result.exitCode !== 0 && /Wait timed out/i.test(result.stderr);
  return timedOut ? { ...result, stderr: namedWaitGaveUp(wait) } : result;
}
