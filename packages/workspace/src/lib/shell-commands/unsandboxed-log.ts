/**
 * Which calls of macOS `log` may run outside the OS sandbox, to read the
 * system log.
 *
 * `log` declines to run inside a sandbox ("Cannot run while sandboxed"), and
 * the unified log is where a hang or a crash that left no report shows up.
 * Outside, it reads what the person's account can read, with private fields
 * redacted as macOS redacts them for every reader. Only the verbs that read
 * are here (`show`, `stats`, `stream`, `help`); `collect`, `config`,
 * `erase`, `repack` and `emit` write. Nothing that names a file is: an
 * archive or directory (`--archive`, `--directory`, `--file`, an operand),
 * which would read past the rules. Not `--pager`, which starts `less`.
 *
 * The lists are closed and spelled exactly. `log` parses with getopt_long,
 * which takes any unambiguous prefix of a long option (`--arch` is
 * `--archive`) and clusters of short ones (`-LA`), so a prefix, a cluster or
 * an operand refuses the call. A predicate is NSPredicate syntax, whose
 * `FUNCTION`, `CAST` and `SUBQUERY` reach Objective-C methods; `log` rejects
 * them, and they are refused here before it reads them. The program runs
 * from its fixed path, root-owned and writable by no one else, with the
 * environment `unsandboxedEnv` builds from nothing.
 */

/** Whether a call may run, or why it may not. */
export type LogCall = { allowed: true } | { allowed: false; reason: string };

interface LogOption {
  long: string;
  short?: string;
  takes: "flag" | "value";
}

const flag = (long: string, short?: string): LogOption => ({
  long,
  short,
  takes: "flag",
});
const value = (long: string, short?: string): LogOption => ({
  long,
  short,
  takes: "value",
});

/** `--x` and `--no-x`, as `log help` lists `--[no-]x`. */
const both = (long: string): LogOption[] => [flag(long), flag(`no-${long}`)];

const PREDICATES = new Set(["highlight-predicate", "predicate"]);

const VERBS: Record<"show" | "stats" | "stream", LogOption[]> = {
  show: [
    ...both("backtrace"),
    ...both("debug"),
    ...both("info"),
    ...both("loss"),
    ...both("signpost"),
    flag("no-pager"),
    flag("metric"),
    flag("realtime"),
    flag("source"),
    flag("mach-continuous-time"),
    flag("unreliable"),
    flag("last24", "L"),
    flag("yesterday", "Y"),
    flag("today", "T"),
    value("color", "c"),
    value("end", "E"),
    value("last", "l"),
    value("highlight-predicate", "H"),
    value("predicate", "P"),
    value("process", "p"),
    value("start", "S"),
    value("style", "s"),
    value("timezone", "Z"),
  ],
  stats: [
    flag("no-pager"),
    flag("overview", "O"),
    flag("per-book", "B"),
    flag("per-file", "f"),
    value("count", "c"),
    value("sort", "o"),
    value("last", "l"),
    value("start", "S"),
    value("end", "E"),
    value("style", "s"),
    value("sender", "b"),
    value("process", "p"),
    value("predicate", "P"),
  ],
  stream: [
    ...both("backtrace"),
    ...both("debug"),
    ...both("info"),
    ...both("signpost"),
    flag("metric"),
    flag("source"),
    flag("mach-continuous-time"),
    flag("unreliable"),
    flag("ignore-dropped"),
    flag("payload", "o"),
    value("color", "c"),
    value("level", "l"),
    value("predicate", "P"),
    value("process", "p"),
    value("user", "u"),
    value("style", "s"),
    value("timeout", "T"),
    value("type", "Y"),
  ],
};

/** What `log help` may be asked about. */
const HELP_TOPICS = new Set([
  "predicates",
  "shorthand",
  "show",
  "stats",
  "stream",
]);

const HELP =
  "`log` runs `show`, `stats` and `stream` with their options as `log help <verb>` lists them, spelled in full or as one short letter per argument; not an archive, a directory, a file or `--pager`.";

function refuse(what: string): LogCall {
  return {
    allowed: false,
    reason: `log: ${what} can't be used here. ${HELP}`,
  };
}

/** A predicate form that reaches Objective-C rather than filtering. */
const PREDICATE_CODE = /\b(?:function|cast|subquery)\s*\(/i;

function valueRefusal(option: LogOption, given: string): string | undefined {
  if (PREDICATES.has(option.long) && PREDICATE_CODE.test(given)) {
    return "a predicate with FUNCTION, CAST or SUBQUERY";
  }
  if (
    option.long === "timezone" &&
    (given.startsWith("/") || given.split("/").includes(".."))
  ) {
    return `the time zone \`${given}\``;
  }
  return undefined;
}

/**
 * Whether `log` with `argv` (its arguments, without the program name) may
 * run outside the sandbox on `platform`. Pure: it reads only its arguments.
 */
export function classifyLog(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
): LogCall {
  if (platform !== "darwin") {
    return { allowed: false, reason: "log: not available here." };
  }
  const [verb, ...rest] = argv;
  if (verb === "help") {
    return rest.length === 0 ||
      (rest.length === 1 && HELP_TOPICS.has(rest[0] ?? ""))
      ? { allowed: true }
      : refuse(`\`help ${rest.join(" ")}\``);
  }
  if (verb !== "show" && verb !== "stats" && verb !== "stream") {
    return refuse(verb === undefined ? "`log` alone" : `\`${verb}\``);
  }
  const options = VERBS[verb];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index] ?? "";
    const eq = arg.indexOf("=");
    const option = arg.startsWith("--")
      ? options.find(
          (candidate) =>
            candidate.long === (eq === -1 ? arg.slice(2) : arg.slice(2, eq)),
        )
      : arg.startsWith("-") && arg.length >= 2
        ? options.find((candidate) => candidate.short === arg.charAt(1))
        : undefined;
    if (option === undefined) {
      return refuse(`\`${arg}\``);
    }
    const long = arg.startsWith("--");
    // A short flag stands alone; a short value takes the rest of the
    // argument or the next one.
    if (option.takes === "flag") {
      if ((long && eq !== -1) || (!long && arg.length > 2)) {
        return refuse(`\`${arg}\``);
      }
      continue;
    }
    const joined = long
      ? eq === -1
        ? undefined
        : arg.slice(eq + 1)
      : arg.length > 2
        ? arg.slice(2)
        : undefined;
    const given = joined ?? rest[index + 1];
    if (given === undefined) {
      return refuse(`\`${arg}\` without its value`);
    }
    const bad = valueRefusal(option, given);
    if (bad !== undefined) {
      return refuse(bad);
    }
    index += joined === undefined ? 1 : 0;
  }
  return { allowed: true };
}
