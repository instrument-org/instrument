/**
 * Shared argv scanning for the agent-browser wrapper: the flag tables and the
 * subcommand lookup are needed both by the command policy and by the
 * navigation-target rewrite, which must agree on which token is the subcommand.
 */

/** Optional explicit values for upstream boolean flags (`--headed false`). */
export const BOOLEAN_VALUE_TOKENS = new Set(["false", "true"]);

/**
 * Global flags that consume the following token as a value. Used when locating
 * the subcommand so a flag value (e.g. `--profile session`) is never mistaken
 * for one. Boolean flags are handled separately: they only consume a following
 * literal `true`/`false`.
 */
export const VALUE_FLAGS = new Set([
  "--action-policy",
  "--allowed-domains",
  "--args",
  "--cdp",
  "--color-scheme",
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
  "--profile",
  "--provider",
  "--proxy",
  "--proxy-bypass",
  "--restore",
  "--restore-check-fn",
  "--restore-check-text",
  "--restore-check-url",
  "--restore-save",
  "--screenshot-dir",
  "--screenshot-format",
  "--screenshot-quality",
  "--state",
  "--user-agent",
  "-p",
]);

/** First positional token, or `undefined` when the argv is all flags. */
export function findSubcommand(args: string[]): string | undefined {
  return args[findSubcommandIndex(args)];
}

/**
 * Index of the first positional token, skipping flag values: value flags
 * consume the next token, boolean flags consume only a literal `true`/`false`
 * (upstream's optional boolean value form). `-1` when there is none.
 */
export function findSubcommandIndex(args: string[]): number {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg.startsWith("-")) {
      if (!arg.includes("=")) {
        const next = args[i + 1];
        if (VALUE_FLAGS.has(arg)) {
          i++;
        } else if (next !== undefined && BOOLEAN_VALUE_TOKENS.has(next)) {
          i++;
        }
      }
      continue;
    }
    return i;
  }
  return -1;
}
