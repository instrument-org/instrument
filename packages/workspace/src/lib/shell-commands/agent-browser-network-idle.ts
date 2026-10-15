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
export const NETWORK_IDLE_TIMEOUT_MS = 5000;

/** What the agent reads when the capped wait gives up. */
export const NETWORK_IDLE_GAVE_UP = `The network did not go quiet within ${NETWORK_IDLE_TIMEOUT_MS / 1000} seconds, which a page that keeps a connection open never does. The page has loaded, so act on it, or wait for what you need with \`wait --text\`, \`wait <selector>\` or \`wait --url\`.\n`;

/**
 * True for `wait --load networkidle` (or `-l`) with no `--timeout` of the
 * agent's own.
 */
export function isUncappedNetworkIdleWait(args: string[]): boolean {
  const { subArgs, subcommand } = parseAgentBrowserArgs(args);
  if (subcommand !== "wait") {
    return false;
  }
  const words = subArgs.map(({ value }) => value);
  const load = words.findIndex((word) => word === "--load" || word === "-l");
  return (
    load !== -1 &&
    words[load + 1] === "networkidle" &&
    !words.some((word) => word === "--timeout" || word.startsWith("--timeout="))
  );
}

/** The invocation with the harness's timeout added to an uncapped network-idle wait. */
export function capNetworkIdleWait(args: string[]): string[] {
  return isUncappedNetworkIdleWait(args)
    ? [...args, "--timeout", String(NETWORK_IDLE_TIMEOUT_MS)]
    : args;
}

/**
 * The capped wait's result as the agent sees it: a timeout becomes a success
 * that says the network stayed busy. The page is as ready as a longer wait
 * would make it (`open` already waited for the load event), and a failure
 * would end the `&&` chain the agent wrote to read that page.
 */
export function networkIdleWaitResult(result: {
  exitCode: number;
  stderr: string;
  stdout: string;
}) {
  const timedOut =
    result.exitCode !== 0 && /timed out|timeout/i.test(result.stderr);
  return timedOut
    ? { exitCode: 0, stderr: "", stdout: NETWORK_IDLE_GAVE_UP }
    : result;
}
