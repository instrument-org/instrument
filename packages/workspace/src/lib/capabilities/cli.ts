import { type Command, defineCommand, type ExecResult } from "just-bash";
import { isPlainObject } from "radashi";
import { z } from "zod";

import { INSTRUMENT_COMMAND } from "../shell-commands/instrument-command";
import { subprocessStdin } from "../shell-commands/utils";
import { unavailableReason } from "./admit";
import {
  type ArgvSpec,
  type CommandShell,
  parseArgs,
  type ParsedArgs,
} from "./argv";
import { type CapabilityScope, capabilityContexts } from "./context";
import { type Capability, type Role } from "./define";
import { dispatch } from "./dispatch";
import { CAPABILITIES } from "./registry";

/** Exit codes every generated command keeps. */
const EXIT = {
  /** A card is up for the person; the turn ends after this bash call. */
  card: 2,
  /** Nothing was sent: the app's guide came back on stderr, to read first. */
  readFirst: 3,
} as const;

/** How many of a result's top-level keys `--out` names in its one line. */
const KEYS_SHOWN = 10;

/** How a field is read off the command line. */
type FieldKind = "boolean" | "json" | "list" | "number" | "pairs" | "value";

interface Field {
  /** Whether a JSON field may also be plain text, as a request's body may. */
  acceptsText: boolean;
  /** The words a field takes, where its schema lists them. */
  choices?: string[];
  /** What the schema says of it, for its line in the usage. */
  description?: string;
  flag: string;
  kind: FieldKind;
  name: string;
  required: boolean;
}

const JsonSchemaNode = z.looseObject({
  $ref: z.string().optional(),
  additionalProperties: z.unknown().optional(),
  anyOf: z.array(z.unknown()).optional(),
  enum: z.array(z.unknown()).optional(),
  items: z.unknown().optional(),
  type: z.union([z.string(), z.array(z.string())]).optional(),
});

const JsonObjectSchema = z.looseObject({
  $defs: z.record(z.string(), z.unknown()).optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
  required: z.array(z.string()).default([]),
});

function typeOf(node: unknown): string | undefined {
  const parsed = JsonSchemaNode.safeParse(node);
  const type = parsed.success ? parsed.data.type : undefined;
  return typeof type === "string" ? type : undefined;
}

function kindOf(node: unknown): FieldKind {
  const parsed = JsonSchemaNode.safeParse(node);
  if (!parsed.success) {
    return "json";
  }
  const { additionalProperties, items, type } = parsed.data;
  switch (type) {
    case "boolean":
      return "boolean";
    case "integer":
    case "number":
      return "number";
    case "string":
      return "value";
    case "array":
      return ["integer", "number", "string"].includes(typeOf(items) ?? "")
        ? "list"
        : "json";
    case "object":
      return typeOf(additionalProperties) === "string" ? "pairs" : "json";
    default:
      return "json";
  }
}

/** A node, or the definition its `$ref` names. */
function resolved(node: unknown, defs: Record<string, unknown>): unknown {
  const ref = JsonSchemaNode.safeParse(node).data?.$ref;
  return ref?.startsWith("#/$defs/")
    ? defs[ref.slice("#/$defs/".length)]
    : node;
}

function kebabCase(name: string): string {
  return name.replaceAll("_", "-");
}

const fieldCache = new WeakMap<Capability, Field[]>();

/** The capability's input fields, as the command line reads each one. */
function fieldsOf(capability: Capability): Field[] {
  const cached = fieldCache.get(capability);
  if (cached) {
    return cached;
  }
  const schema = JsonObjectSchema.parse(
    z.toJSONSchema(capability.input, { io: "input", unrepresentable: "any" }),
  );
  const flagNames: Partial<Record<string, string>> =
    capability.surfaces.cli?.flagNames ?? {};
  const defs = schema.$defs ?? {};
  const fields = Object.entries(schema.properties).map(([name, node]) => {
    const target = resolved(node, defs);
    const kind = kindOf(target);
    const choices = JsonSchemaNode.safeParse(target).data?.enum;
    const description = z
      .looseObject({ description: z.string().optional() })
      .safeParse(node).data?.description;
    return {
      ...(description === undefined ? {} : { description }),
      ...(choices?.every((choice) => typeof choice === "string")
        ? { choices }
        : {}),
      // A JSON value that may also be a string, as a request's body may,
      // takes text that is not JSON as it is.
      acceptsText:
        kind === "json" &&
        (JsonSchemaNode.safeParse(target).data?.anyOf ?? []).some(
          (option) => typeOf(option) === "string",
        ),
      flag: flagNames[name] ?? kebabCase(name),
      kind,
      name,
      required: schema.required.includes(name),
    };
  });
  fieldCache.set(capability, fields);
  return fields;
}

/** One argument's place in a synopsis. */
function synopsisWord(field: Field, positional: boolean, rest = false): string {
  if (positional) {
    const word = `${field.kind === "json" ? `'<${field.name}>'` : `<${field.name}>`}${rest || field.kind === "list" ? "..." : ""}`;
    return field.required ? word : `[${word}]`;
  }
  switch (field.kind) {
    case "boolean":
      return `[--${field.flag}]`;
    case "list":
      return `[--${field.flag} <${field.flag}>]...`;
    case "pairs":
      return `[--${field.flag} <key>=<value>]...`;
    case "json":
      return `[--${field.flag} '<json>']`;
    default: {
      const value = field.choices?.join("|") ?? `<${field.flag}>`;
      return field.required
        ? `--${field.flag} ${value}`
        : `[--${field.flag} ${value}]`;
    }
  }
}

/**
 * The fields the command line takes as flags: every one not a positional
 * word, and not one read from stdin alone, which a heredoc gives.
 */
function flaggedFields(capability: Capability): Field[] {
  const cli = capability.surfaces.cli;
  const positional: readonly string[] = cli?.positional ?? [];
  return fieldsOf(capability).filter(
    (field) => !positional.includes(field.name) && field.name !== cli?.stdin,
  );
}

/**
 * Whether the last positional field takes every word left: joined by spaces
 * where the capability says `rest`, or one item each for a list.
 */
function takesTheRest(capability: Capability): "joined" | "list" | undefined {
  const cli = capability.surfaces.cli;
  const last = cli?.positional?.at(-1);
  if (last === undefined) {
    return undefined;
  }
  if (cli?.rest === true) {
    return "joined";
  }
  return fieldsOf(capability).find((field) => field.name === last)?.kind ===
    "list"
    ? "list"
    : undefined;
}

/** A capability's lines in its command's usage: the synopsis, the summary, its help. */
function cliUsage(capability: Capability): string {
  const cli = capability.surfaces.cli;
  const [command, word] = cli?.words ?? ["", ""];
  const positional: readonly string[] = cli?.positional ?? [];
  const fields = fieldsOf(capability);
  const flagged = flaggedFields(capability);
  const heredoc = cli?.stdin === undefined ? [] : ["[<<'EOF' ... EOF]"];
  const words = [
    ...positional.flatMap((name, index) => {
      const field = fields.find((each) => each.name === name);
      return field
        ? [
            synopsisWord(
              field,
              true,
              cli?.rest === true && index === positional.length - 1,
            ),
          ]
        : [];
    }),
    ...flagged.map((field) => synopsisWord(field, false)),
    ...heredoc,
  ];
  const lead = `${INSTRUMENT_COMMAND.name} ${command} ${[word, ...(cli?.aliases ?? [])].join("|")}`;
  // A flag's own line says what it is for, from its schema's description.
  const flags = flagged.flatMap((field) =>
    field.description === undefined
      ? []
      : [`--${field.flag}: ${field.description}`],
  );
  const help = [
    capability.summary,
    ...(cli?.help ? cli.help.split("\n") : []),
    ...flags,
  ];
  return [
    `  ${[lead, ...words].join(" ")}`,
    ...help.map((line) => (line === "" ? "" : `      ${line}`)),
  ].join("\n");
}

function parseJson(field: Field, text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    // A field that takes text sends a quoted word with its quotes.
    return field.acceptsText && typeof parsed === "string" ? text : parsed;
  } catch (error) {
    if (field.acceptsText) {
      return text;
    }
    throw new Error(
      `${field.name} must be JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The capability's raw input from what the command line gave. */
function rawInput(
  capability: Capability,
  input: ParsedArgs,
  stdin: CommandShell["stdin"],
): Record<string, unknown> {
  const cli = capability.surfaces.cli;
  const fields = fieldsOf(capability);
  const raw: Record<string, unknown> = {};
  const read = (field: Field, text: string) =>
    field.kind === "json"
      ? parseJson(field, text)
      : field.kind === "number"
        ? Number(text)
        : text;
  const positional = cli?.positional ?? [];
  const rest = takesTheRest(capability);
  /** The words each positional field was given. */
  const given = new Map<string, string[]>();
  positional.forEach((name, index) => {
    const field = fields.find((each) => each.name === name);
    const words =
      rest !== undefined && index === positional.length - 1
        ? input.positional.slice(index)
        : input.positional.slice(index, index + 1);
    given.set(name, words);
    if (!field) {
      return;
    }
    if (rest === "list" && index === positional.length - 1) {
      if (words.length > 0) {
        raw[name] = words;
      }
      return;
    }
    const word = words.join(" ").trim();
    if (word !== "") {
      raw[name] = read(field, word);
    }
  });
  for (const field of fields) {
    if (!input.has(field.flag)) {
      continue;
    }
    switch (field.kind) {
      case "boolean":
        raw[field.name] = true;
        break;
      case "list":
        raw[field.name] = input.all(field.flag);
        break;
      case "pairs":
        raw[field.name] = Object.fromEntries(
          input.all(field.flag).map((pair) => {
            const index = pair.indexOf("=");
            if (index <= 0) {
              throw new Error(
                `--${field.flag} takes <key>=<value> (got "${pair}").`,
              );
            }
            return [pair.slice(0, index), pair.slice(index + 1)];
          }),
        );
        break;
      default:
        raw[field.name] = read(field, input.value(field.flag) ?? "");
    }
  }
  const piped = subprocessStdin(stdin)?.toString("utf8").trim();
  const stdinField = fields.find((field) => field.name === cli?.stdin);
  if (piped && stdinField) {
    // Words beside a heredoc are most often a path or a title that lost its
    // quotes, which taking stdin alone would silently drop.
    const beside = given.get(stdinField.name) ?? [];
    if (beside.length > 0) {
      throw new Error(
        `unexpected ${beside.length === 1 ? "argument" : "arguments"} ${beside.map((word) => `"${word}"`).join(", ")} beside the ${stdinField.name} on stdin. A word with a space in it needs quotes.`,
      );
    }
    raw[stdinField.name] = read(stdinField, piped);
  }
  return raw;
}

/**
 * What `--out` wrote, in a few words of our own: enough to aim jq at it
 * without opening it. Key names are the service's, so they are quoted and cut
 * short rather than passed through.
 */
function describeWritten(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return `text, ${body.split("\n").length} lines`;
  }
  if (Array.isArray(parsed)) {
    return `JSON, an array of ${parsed.length}`;
  }
  if (!isPlainObject(parsed)) {
    return "JSON";
  }
  const keys = Object.keys(parsed);
  const shown = keys
    .slice(0, KEYS_SHOWN)
    .map((key) => JSON.stringify(key.slice(0, 40)));
  const more =
    keys.length > KEYS_SHOWN ? ` and ${keys.length - KEYS_SHOWN} more` : "";
  return `JSON, an object with keys ${shown.join(", ")}${more}`;
}

function withNewline(text: string): string {
  return text.endsWith("\n") || text === "" ? text : `${text}\n`;
}

/** One generated subcommand: what its arguments are read against, its usage, and the call. */
interface GeneratedSubcommand {
  argv: ArgvSpec;
  /** Its lines of the command's usage, which a refused argument is shown. */
  usage: string;
  /**
   * The call: what it prints, with its exit code. A thrown error is its
   * refusal, which reaches the agent on stderr with exit 1.
   */
  run(
    input: ParsedArgs,
    scope: CapabilityScope,
    shell: CommandShell,
  ): Promise<ExecResult>;
}

/**
 * A capability as one subcommand of its `instrument` command: flags and
 * positional words from its input schema, its gate's answers as exit codes
 * (0, 1 a failure, 2 a card is up, 3 not sent until the guide is read), and
 * `--json` for the whole result as JSON or `--out <file>` to write it.
 */
function cliSubcommand(
  capability: Capability,
  registry: readonly Capability[] = CAPABILITIES,
): GeneratedSubcommand {
  const positional = capability.surfaces.cli?.positional ?? [];
  const flagged = flaggedFields(capability);
  const valued = flagged.filter((field) => field.kind !== "boolean");
  return {
    argv: {
      booleans: [
        "json",
        ...flagged
          .filter((field) => field.kind === "boolean")
          .map((field) => field.flag),
      ],
      flags: ["out", ...valued.map((field) => field.flag)],
      ...(takesTheRest(capability) === undefined
        ? { positional: positional.length }
        : {}),
      repeatable: valued
        .filter((field) => field.kind === "list" || field.kind === "pairs")
        .map((field) => field.flag),
    },
    usage: cliUsage(capability),
    run: async (input, scope, shell): Promise<ExecResult> => {
      const ctx = capabilityContexts(scope, "cli", (named) =>
        shell.fs.readFileBuffer(shell.fs.resolvePath(shell.cwd, named)),
      )(shell.signal, shell);
      const answer = await dispatch(
        capability.name,
        rawInput(capability, input, shell.stdin),
        ctx,
        registry,
      );
      if ("error" in answer) {
        const { kind, message } = answer.error;
        if (kind === "read-first" || kind === "card") {
          // On stderr, so nothing downstream of a pipe takes it for a result.
          return {
            exitCode: kind === "card" ? EXIT.card : EXIT.readFirst,
            stderr: withNewline(message),
            stdout: "",
          };
        }
        throw new Error(message);
      }
      const used = answer.capability;
      const out = input.value("out");
      if (out !== undefined) {
        const body = withNewline(
          input.has("json")
            ? JSON.stringify(answer.output)
            : used.text(answer.output),
        );
        try {
          await shell.fs.writeFile(shell.fs.resolvePath(shell.cwd, out), body);
        } catch (error) {
          throw new Error(
            `cannot write ${out}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return {
          exitCode: 0,
          stderr: "",
          stdout: `Wrote ${out}: ${describeWritten(body.trimEnd())}, ${Buffer.byteLength(body.trimEnd())} bytes.\n`,
        };
      }
      if (input.has("json")) {
        return {
          exitCode: 0,
          stderr: "",
          stdout: `${JSON.stringify(answer.output)}\n`,
        };
      }
      const rendered = used.render?.(answer.output, answer.input);
      return rendered
        ? {
            exitCode: rendered.exitCode ?? 0,
            stderr: rendered.stderr ?? "",
            stdout: rendered.stdout,
          }
        : {
            exitCode: 0,
            stderr: "",
            stdout: withNewline(used.text(answer.output)),
          };
    },
  };
}

/** The generated subcommands of one `instrument` command, by word, aliases included. */
export function cliSubcommands(
  command: string,
  registry: readonly Capability[] = CAPABILITIES,
): {
  subcommands: Record<string, GeneratedSubcommand>;
  usage: string[];
} {
  const own = registry.filter(
    (capability) => capability.surfaces.cli?.words[0] === command,
  );
  return {
    subcommands: Object.fromEntries(
      own.flatMap((capability) => {
        const cli = capability.surfaces.cli;
        const subcommand = cliSubcommand(capability, registry);
        return [cli?.words[1] ?? "", ...(cli?.aliases ?? [])].map(
          (word) => [word, subcommand] as const,
        );
      }),
    ),
    usage: own.map((capability) => cliUsage(capability)),
  };
}

/**
 * An `instrument` command whose every subcommand the registry generates,
 * with its usage around the lines they make: `instrument x`, `instrument app`.
 */
export function generatedCommand(
  {
    bare,
    name,
    scope,
    usage,
    word,
  }: {
    /** The subcommand a bare command runs; the usage where none. */
    bare?: string;
    /** The command as the shell names it: `instrument app`. */
    name: string;
    scope: CapabilityScope;
    /** The whole usage, from each generated subcommand's lines. */
    usage: (generated: string[]) => string;
    /** The capabilities' first CLI word: `app`. */
    word: string;
  },
  registry: readonly Capability[] = CAPABILITIES,
): Command {
  const refused = commandRefusal(word, scope.role, registry);
  if (refused !== undefined) {
    // Nothing in it is this shell's, so every form says why, its usage too.
    return defineCommand(name, () =>
      Promise.resolve({
        exitCode: 1,
        stderr: `${name}: ${refused}\n`,
        stdout: "",
      }),
    );
  }
  const generated = cliSubcommands(word, registry);
  const whole = usage(generated.usage);
  // `--help`, `-h` and `help`, alone or anywhere after the subcommand, print
  // the usage; an unknown subcommand is refused with it.
  return defineCommand(name, async (args, ctx) => {
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
      return { exitCode: 0, stderr: "", stdout: whole };
    }
    const subcommand = Object.hasOwn(generated.subcommands, chosen)
      ? generated.subcommands[chosen]
      : undefined;
    if (!subcommand) {
      return failure(`${name}: unknown subcommand "${chosen}".\n\n${whole}`);
    }
    try {
      return await runSubcommand(subcommand, rest, scope, ctx, {
        name: `${name} ${chosen}`,
      });
    } catch (error) {
      return failure(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

function failure(message: string): ExecResult {
  return { exitCode: 1, stderr: `${message}\n`, stdout: "" };
}

/**
 * One generated subcommand run on the words after it, throwing its refusal
 * rather than printing it: what its command runs, and what a test calls to
 * see the refusal itself.
 */
export function runSubcommand(
  subcommand: GeneratedSubcommand,
  args: readonly string[],
  scope: CapabilityScope,
  shell: CommandShell,
  { name }: { name: string },
): Promise<ExecResult> {
  const input = parseArgs(subcommand.argv, args, {
    form: subcommand.usage,
    name,
  });
  return subcommand.run(input, scope, shell);
}

/**
 * Why a role has none of an `instrument` command's capabilities, in the
 * words its first one refuses with, or nothing when it has any: a task's
 * `instrument task`. Such a command is left out of `instrument`'s listing
 * for that role, and answers every call with this.
 */
export function commandRefusal(
  word: string,
  role: Role,
  registry: readonly Capability[] = CAPABILITIES,
): string | undefined {
  const reasons = registry
    .filter((capability) => capability.surfaces.cli?.words[0] === word)
    .map((capability) => unavailableReason(capability, role));
  return reasons.length > 0 && reasons.every((reason) => reason !== undefined)
    ? reasons[0]
    : undefined;
}
