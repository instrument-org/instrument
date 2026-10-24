/** How long one agent-browser invocation runs before the log notes it. */
export const SLOW_INVOCATION_MS = 60_000;

/** The part of a started CLI process the watch reads. */
interface WatchedProcess {
  once(event: "exit", listener: () => void): unknown;
  pid?: number | undefined;
}

/**
 * Logs an agent-browser invocation still unsettled after SLOW_INVOCATION_MS,
 * and again when it settles, saying whether the CLI is still running or has
 * exited while something holds its output open: the two ways a command can
 * fail to come back. Only the subcommand is named, since the arguments can
 * carry what the agent typed into a page. Returns what to call once it
 * settles.
 */
export function watchSlowInvocation(
  subcommand: string | undefined,
  child: WatchedProcess,
): () => void {
  const name = `agent-browser ${subcommand ?? "(no subcommand)"}`;
  const startedAt = performance.now();
  let exitedAt: number | undefined;
  child.once("exit", () => {
    exitedAt = performance.now();
  });
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    const state =
      exitedAt === undefined
        ? `process ${child.pid ?? "unknown"} is still running`
        : `its process exited ${seconds(performance.now() - exitedAt)} ago and its output is still open`;
    console.warn(
      `${name} has not finished after ${seconds(SLOW_INVOCATION_MS)}: ${state}`,
    );
  }, SLOW_INVOCATION_MS);
  timer.unref();
  return () => {
    clearTimeout(timer);
    if (slow) {
      console.info(
        `${name} finished after ${seconds(performance.now() - startedAt)}`,
      );
    }
  };
}

function seconds(durationMs: number) {
  return `${Math.round(durationMs / 1000)}s`;
}
