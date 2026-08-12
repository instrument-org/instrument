/**
 * A model of how the agent-browser CLI reads its own argument list, so the
 * wrapper gates the command the CLI will actually run rather than a guess.
 *
 * The CLI pulls its global flags out of the argument list wherever they appear,
 * then treats the first token that survives as the subcommand. Anything that
 * scans for "the first argument that isn't a flag" instead lands on the *value*
 * of a global flag, which is how a blocked subcommand slips through as
 * `--headers '{}' close`.
 *
 * The tables mirror the CLI's own; keep them in step when the pinned version
 * moves.
 */

/** Global flags that always consume the following argument as their value. */
const GLOBAL_VALUE_FLAGS = new Set([
  "--action-policy",
  "--allowed-domains",
  "--args",
  "--cdp",
  "--color-scheme",
  "--config",
  "--confirm-actions",
  "--device",
  "--download-path",
  "--enable",
  "--engine",
  "--executable-path",
  "--extension",
  "--headers",
  "--idle-timeout",
  "--init-script",
  "--max-output",
  "--model",
  "--namespace",
  "--profile",
  "--provider",
  "--proxy",
  "--proxy-bypass",
  "--restore-check-fn",
  "--restore-check-text",
  "--restore-check-url",
  "--restore-save",
  "--screenshot-dir",
  "--screenshot-format",
  "--screenshot-quality",
  "--session",
  "--session-name",
  "--state",
  "--user-agent",
]);

/**
 * Global flags that stand alone, and swallow a following argument only when it
 * is a literal `true` or `false`.
 */
const GLOBAL_BOOL_FLAGS = new Set([
  "--allow-file-access",
  "--annotate",
  "--auto-connect",
  "--confirm-interactive",
  "--content-boundaries",
  "--debug",
  "--fix",
  "--headed",
  "--hide-scrollbars",
  "--ignore-https-errors",
  "--json",
  "--no-auto-dialog",
  "--offline",
  "--quick",
  "--quiet",
  "--verbose",
  "--webgpu",
]);

/** Short forms the CLI resolves to a long flag. */
const FLAG_ALIASES = new Map([
  ["-p", "--provider"],
  ["-q", "--quiet"],
  ["-v", "--verbose"],
]);

const RESTORE_FLAG = "--restore";
const RESTORE_INLINE_PREFIX = `${RESTORE_FLAG}=`;

/**
 * The long-form name a flag token carries, ignoring any inline `=value`.
 *
 * Used for gating rather than parsing: the CLI honors `--cdp <value>` but not
 * `--cdp=<value>`, so both forms resolve to the same name here and a rejection
 * covers the form the CLI ignores too.
 */
export function agentBrowserFlagName(arg: string): string {
  const equalsIndex = arg.indexOf("=");
  const base = equalsIndex > 0 ? arg.slice(0, equalsIndex) : arg;
  return FLAG_ALIASES.get(base) ?? base;
}

/**
 * Split an invocation into the global flags the CLI consumes itself and the
 * arguments its subcommand parser sees. `subArgs` carries each argument's index
 * in the original list so a caller can rewrite one in place.
 */
export function parseAgentBrowserArgs(args: string[]) {
  const globalFlags: { name: string; value: string | undefined }[] = [];
  const subArgs: { index: number; value: string }[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg.startsWith(RESTORE_INLINE_PREFIX)) {
      globalFlags.push({
        name: RESTORE_FLAG,
        value: arg.slice(RESTORE_INLINE_PREFIX.length),
      });
      continue;
    }

    const name = FLAG_ALIASES.get(arg) ?? arg;
    const next = args[i + 1];

    if (GLOBAL_VALUE_FLAGS.has(name)) {
      globalFlags.push({ name, value: next });
      i++;
      continue;
    }

    if (name === RESTORE_FLAG) {
      // The CLI takes the next token as the restore key only when it isn't
      // itself a subcommand; approximated by "nothing has reached subArgs yet",
      // which is enough because --restore is rejected before anyone reads this.
      const takesValue =
        subArgs.length === 0 && next !== undefined && !next.startsWith("-");
      globalFlags.push({ name, value: takesValue ? next : undefined });
      if (takesValue) {
        i++;
      }
      continue;
    }

    if (GLOBAL_BOOL_FLAGS.has(name)) {
      const explicit = next === "true" || next === "false";
      globalFlags.push({ name, value: explicit ? next : undefined });
      if (explicit) {
        i++;
      }
      continue;
    }

    subArgs.push({ index: i, value: arg });
  }

  // The CLI takes whatever survives first as the subcommand, flag-looking or
  // not -- `--raw read <url>` is an unknown command to it, not a read.
  return { globalFlags, subArgs, subcommand: subArgs[0]?.value };
}
