import ms from "ms";
import { dedent } from "radashi";

/**
 * What the job commands are called and how they are described to the agent,
 * apart from the code that implements them.
 *
 * Split out because the renderer needs these names too: the note that tells the
 * model what is still running names the commands for managing it, and that note
 * is rendered in the chat as well. The implementations reach the process
 * registry, which reaches `node:fs`, which does not exist in a browser.
 */

/** Ceiling on one `fg`, matching the longest a single tool call may run. */
export const MAX_WAIT_MS = ms("10 minutes");

/**
 * A promoted run nobody polls or kills is stopped at this age: long enough to
 * cover a slow build or a dev server the user is still looking at, short enough
 * that a leaked process does not outlive interest in it.
 *
 * Here with the descriptions rather than with the registry that enforces it,
 * because it is a number the agent and the user are both told, and only the
 * descriptions can be read from the renderer.
 */
export const MAX_RUNNING_AGE_MS = ms("2 hours");

export const JOBS_COMMAND = {
  description: dedent`
    List the background processes this session started, with their status, run time and command.
    Unlike the rest of the shell, this survives across calls: a process started by an earlier call is still listed here. Use it at the start of a turn to find what is already running instead of starting a second copy.
    Usage: \`jobs [-l] [-p] [--json]\`. \`-l\` adds the pids each one is running, \`-p\` prints only those.
  `.trim(),
  name: "jobs",
} as const;

export const KILL_COMMAND = {
  description: dedent`
    Stop a process you started, waiting until it has really exited.
    Usage: \`kill [-SIGNAL] <bg_1|%1|pid>...\`. Takes a \`jobs\` id or the pid of anything your commands started, their children included, so \`lsof -ti :3000 | xargs kill\` frees a port your own server holds. Without a signal, or with TERM, INT or KILL, it escalates on its own until the process is gone; any other signal (\`-HUP\`, \`-0\`) is sent as given. \`kill -l\` lists signals.
    Processes you did not start belong to the person and are refused.
  `.trim(),
  name: "kill",
} as const;

export const FG_COMMAND = {
  description: dedent`
    Bring a background process to the foreground: print what it has written since your last read, and block until it exits.
    Usage: \`fg [<id>...] [--timeout <ms>]\`. With no id it takes everything still running. Exits with the process's own exit code once it finishes, so \`fg bg_1 && pnpm test\` runs the tests only on success. A process that was stopped, or that hit the age cap, never ran to completion and so exits non-zero however far it got.
    \`--timeout 0\` returns immediately with whatever is pending, which is how you glance at a server that never exits. Otherwise it blocks until the process exits, so this is how you wait out a build in one call rather than polling.
    IMPORTANT: it never waits past this \`bash\` call's own \`yieldMs\`; it returns what has arrived by then instead. To wait out something longer, raise \`yieldMs\` on the \`bash\` call rather than the timeout here.
    IMPORTANT: reading consumes -- each call returns only what arrived since the last one, so piping into a filter (\`fg bg_1 | rg error\`) discards the rest. The complete output is always in the process's log file.
  `.trim(),
  name: "fg",
} as const;
