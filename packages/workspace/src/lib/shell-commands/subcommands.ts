import { type CommandContext, type ExecResult } from "just-bash";

/** What a subcommand is handed from the shell it runs in. */
export type SubcommandShell = Pick<
  CommandContext,
  "cwd" | "fs" | "signal" | "stdin"
>;

/** A subcommand's arguments, read against what it declares. */
export interface SubcommandInput {
  /** Every value a flag was given, in order; none for a flag not passed. */
  all(flag: string): string[];
  /** Whether a flag or switch was passed at all. */
  has(flag: string): boolean;
  /** Everything that is not a flag or a flag's value, in order. */
  positional: string[];
  /** The value a flag was given, the last where it was given several. */
  value(flag: string): string | undefined;
}

/**
 * One subcommand of a command like `task` or `memory`.
 *
 * A flag is named without its dashes: a one-letter name is written `-n`, a
 * longer one `--name`, and a value flag also takes `--name=value`. Whatever
 * else starts with `--` is refused with the subcommand's usage, so a
 * misspelled flag is reported rather than read as a word of the brief.
 */
export interface Subcommand<Context> {
  /** Switches: present or absent, never taking the next word. */
  booleans?: readonly string[];
  /** Flags that take a value, as the next word or after `=`. */
  flags?: readonly string[];
  /** The most positional arguments it takes; any number where absent. */
  positional?: number;
  /** Value flags that keep every value they are given rather than the last. */
  repeatable?: readonly string[];
  /**
   * The subcommand itself: what it prints on success, or the whole result
   * where it reports a partial failure. A thrown error is its refusal, which
   * reaches the agent on stderr with exit 1.
   */
  run: (
    input: SubcommandInput,
    context: Context,
    shell: SubcommandShell,
  ) => ExecResult | Promise<ExecResult | string> | string;
  /** Its own lines of the command's usage, shown when a flag is refused. */
  usage?: string;
}

/** A subcommand defined with its context type checked against the command's. */
export function subcommand<Context>(
  spec: Subcommand<Context>,
): Subcommand<Context> {
  return spec;
}

/**
 * A command made of subcommands, each parsed against what it declares.
 *
 * `--help`, `-h` and `help`, alone or anywhere after the subcommand, print
 * the usage. An unknown subcommand, an unknown flag and a positional argument
 * past the last one it takes are refused with the usage. A refusal prints
 * `<command>: <message>`, or `<command> <subcommand>: <message>` where the
 * command words its errors per subcommand.
 */
export function defineSubcommands<Context>({
  bare,
  errorPrefix = "command",
  name,
  subcommands,
  usage,
}: {
  /** The subcommand a bare command runs; the usage where none. */
  bare?: string;
  errorPrefix?: "command" | "subcommand";
  name: string;
  subcommands: Record<string, Subcommand<Context>>;
  usage: string;
}) {
  return async (
    args: string[],
    context: Context,
    shell: SubcommandShell,
  ): Promise<ExecResult> => {
    const [given, ...rest] = args;
    const chosen = given ?? bare;
    if (
      chosen === undefined ||
      chosen === "help" ||
      chosen === "--help" ||
      chosen === "-h" ||
      rest.includes("--help") ||
      rest.includes("-h")
    ) {
      return ok(usage);
    }
    const spec = Object.hasOwn(subcommands, chosen)
      ? subcommands[chosen]
      : undefined;
    if (!spec) {
      return failure(`${name}: unknown subcommand "${chosen}".\n\n${usage}`);
    }
    try {
      return await runSubcommand(spec, rest, context, shell, {
        name: `${name} ${chosen}`,
        usage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure(
        `${errorPrefix === "subcommand" ? `${name} ${chosen}` : name}: ${message}`,
      );
    }
  };
}

/**
 * One subcommand run on its arguments, throwing its refusal rather than
 * printing it: what `defineSubcommands` runs, and what a test calls to see
 * the refusal itself.
 */
export async function runSubcommand<Context>(
  spec: Subcommand<Context>,
  args: string[],
  context: Context,
  shell: SubcommandShell,
  { name, usage }: { name: string; usage?: string },
): Promise<ExecResult> {
  const input = parseSubcommandArgs(spec, args, {
    name,
    usage: spec.usage ?? usage,
  });
  const result = await spec.run(input, context, shell);
  return typeof result === "string" ? ok(result) : result;
}

function failure(message: string): ExecResult {
  return { exitCode: 1, stderr: `${message}\n`, stdout: "" };
}

function flagOf(argument: string): string | undefined {
  if (argument.startsWith("--") && argument.length > 2) {
    return argument.slice(2).split("=", 1)[0];
  }
  return /^-[A-Za-z]$/.test(argument) ? argument.slice(1) : undefined;
}

function ok(stdout: string): ExecResult {
  return { exitCode: 0, stderr: "", stdout };
}

function parseSubcommandArgs<Context>(
  spec: Subcommand<Context>,
  args: string[],
  { name, usage }: { name: string; usage: string | undefined },
): SubcommandInput {
  const booleans = new Set(spec.booleans ?? []);
  const flags = new Set(spec.flags ?? []);
  const repeatable = new Set(spec.repeatable ?? []);
  const values = new Map<string, string[]>();
  const positional: string[] = [];
  const refuse = (message: string) =>
    new Error(`${message}${usage ? `\n\n${usage}` : ""}`);

  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? "";
    if (argument === "--") {
      positional.push(...args.slice(index + 1));
      break;
    }
    const flag = flagOf(argument);
    if (flag === undefined) {
      positional.push(argument);
      continue;
    }
    const inline = argument.includes("=")
      ? argument.slice(argument.indexOf("=") + 1)
      : undefined;
    if (booleans.has(flag) && inline === undefined) {
      values.set(flag, []);
      continue;
    }
    if (flags.has(flag)) {
      const value = inline ?? args[++index];
      if (value === undefined) {
        throw refuse(`${argument} needs a value.`);
      }
      values.set(flag, [
        ...(repeatable.has(flag) ? (values.get(flag) ?? []) : []),
        value,
      ]);
      continue;
    }
    // A lone `-` with a letter is as often a value (`-5`, a pattern) as a
    // flag; only a long one is certainly a flag nobody declared.
    if (argument.startsWith("--")) {
      throw refuse(`unknown flag --${flag} on \`${name}\`.`);
    }
    positional.push(argument);
  }

  if (spec.positional !== undefined && positional.length > spec.positional) {
    const extra = positional.slice(spec.positional);
    throw refuse(
      `unexpected ${extra.length === 1 ? "argument" : "arguments"} ${extra.map((word) => `"${word}"`).join(", ")} on \`${name}\`.`,
    );
  }

  return {
    all: (flag) => values.get(flag) ?? [],
    has: (flag) => values.has(flag),
    positional,
    value: (flag) => values.get(flag)?.at(-1),
  };
}
