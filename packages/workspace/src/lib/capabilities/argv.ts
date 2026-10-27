import { type CommandContext } from "just-bash";

/** What a generated subcommand is handed from the shell it runs in. */
export type CommandShell = Pick<
  CommandContext,
  "cwd" | "fs" | "signal" | "stdin"
>;

/** A subcommand's arguments, read against the flags its capability declares. */
export interface ParsedArgs {
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
 * The flags and words one subcommand takes, from its capability's schema.
 *
 * A flag is named without its dashes: a one-letter name is written `-n`, a
 * longer one `--name`, and a value flag also takes `--name=value`. Whatever
 * else starts with `--` is refused, so a misspelled flag is reported rather
 * than read as a word of a brief.
 */
export interface ArgvSpec {
  /** Switches: present or absent, never taking the next word. */
  booleans?: readonly string[];
  /** Flags that take a value, as the next word or after `=`. */
  flags?: readonly string[];
  /** The most positional arguments it takes; any number where absent. */
  positional?: number;
  /** Value flags that keep every value they are given rather than the last. */
  repeatable?: readonly string[];
}

function flagOf(argument: string): string | undefined {
  if (argument.startsWith("--") && argument.length > 2) {
    return argument.slice(2).split("=", 1)[0];
  }
  return /^-[A-Za-z]$/.test(argument) ? argument.slice(1) : undefined;
}

/**
 * The arguments after a subcommand's word, read against what it takes.
 * Everything after `--` is a word. Throws the refusal of an unknown flag, a
 * value flag with no value, or a word past the last it takes, naming `name`
 * (`instrument task new`) and the form it takes.
 */
export function parseArgs(
  spec: ArgvSpec,
  args: readonly string[],
  { form, name }: { form: string; name: string },
): ParsedArgs {
  const booleans = new Set(spec.booleans ?? []);
  const flags = new Set(spec.flags ?? []);
  const repeatable = new Set(spec.repeatable ?? []);
  const values = new Map<string, string[]>();
  const positional: string[] = [];
  const refuse = (message: string) => new Error(`${message}\n\n${form}`);

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
