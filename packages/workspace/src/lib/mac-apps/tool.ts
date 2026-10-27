import { z } from "zod";

import { type MacAppBackend } from "./backend";

/** A call the tool turns down, in words the agent can act on. */
export class ToolRefusal extends Error {}

/**
 * macOS keeping Instrument out of the app: the privacy setting is off,
 * Automation was refused, or an Apple Event timed out the way one does
 * while macOS's own prompt is up.
 */
export class MacosRefused extends Error {
  constructor(
    readonly reason: "denied" | "timed-out",
    message: string,
  ) {
    super(message);
  }
}

/** A tool's answer: the data, and the text a person or the agent reads. */
export interface ToolAnswer {
  structured: Record<string, unknown>;
  text: string;
}

/** What a tool runs with. */
export interface ToolContext {
  app: { bundleId: string; name: string };
  backend: MacAppBackend;
  signal?: AbortSignal;
}

/** One tool of a Mac app, with its input checked before it runs. */
export interface MacAppTool {
  /** Its arguments by name, in the order its schema lists them, and whether each may be left out. */
  args: { name: string; optional: boolean }[];
  call: (args: unknown, context: ToolContext) => Promise<ToolAnswer>;
  description: string;
  /**
   * The arguments that name files the app reads outside every sandbox, which
   * the app-call path holds to the chat's folder rules before the call and
   * hands over as absolute paths.
   */
  files: string[];
  input: z.ZodObject;
  name: string;
  output: z.ZodObject;
  readOnly: boolean;
}

/** A tool from its schemas and what it runs, its input parsed strictly so a misspelled key is named. */
export function defineTool<
  In extends z.ZodRawShape,
  Out extends z.ZodRawShape,
>(spec: {
  description: string;
  files?: (keyof In & string)[];
  input: In;
  name: string;
  output: Out;
  readOnly: boolean;
  run: (
    input: z.output<z.ZodObject<In>>,
    context: ToolContext,
  ) => Promise<{ structured: z.output<z.ZodObject<Out>>; text?: string }>;
}): MacAppTool {
  const input = z.strictObject(spec.input);
  const output = z.object(spec.output);
  return {
    args: Object.entries(spec.input).map(([name, schema]) => ({
      name,
      optional: z.safeParse(schema, undefined).success,
    })),
    call: async (args, context) => {
      const parsed = input.safeParse(args);
      if (!parsed.success) {
        throw new ToolRefusal(
          parsed.error.issues
            .map(
              (issue) =>
                `${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
            )
            .join("; "),
        );
      }
      const answer = await spec.run(parsed.data, context);
      return {
        structured: answer.structured,
        text: answer.text ?? JSON.stringify(answer.structured, null, 2),
      };
    },
    description: spec.description,
    files: spec.files ?? [],
    input,
    name: spec.name,
    output,
    readOnly: spec.readOnly,
  };
}

/** One of the Mac's own apps as a bundled MCP app. */
export interface MacAppDefinition {
  /** What the app is for, the opening line of its guide. */
  about: string;
  bundleId: string;
  /** The Mac app's own name, which its folder in Apps and its cards use. */
  name: string;
  /** The bundled server's name, which is also the directory's slug for the app. */
  server: string;
  tools: MacAppTool[];
  /** How it is reached: Apple's frameworks through the helper, or the app's scripts. */
  through: "helper" | "script";
}

/**
 * Flags for the helper, from the values given: `--name value` for each, a
 * bare `--name` for `true`, nothing for what was left out. The helper reads
 * any word that starts with `--` as a flag, so a value that does is refused.
 */
export function helperFlags(
  values: Record<string, boolean | number | string | undefined>,
): string[] {
  return Object.entries(values).flatMap(([name, value]) => {
    if (value === undefined || value === false) {
      return [];
    }
    if (value === true) {
      return [`--${name}`];
    }
    const text = String(value);
    if (text.startsWith("--")) {
      throw new ToolRefusal(`${name} can't start with "--".`);
    }
    return [`--${name}`, text];
  });
}

/**
 * The helper's JSON answer to one command, parsed with `schema` before it
 * is trusted. Its exit code 2 is macOS refusing the app; any other failure
 * is the sentence it wrote.
 */
export async function runHelper<T extends z.ZodType>(
  { app, backend, signal }: ToolContext,
  args: string[],
  schema: T,
): Promise<z.output<T>> {
  if (backend.helper === undefined) {
    throw new ToolRefusal(
      `this build has no way into ${app.name}. Tell the person what you couldn't do.`,
    );
  }
  const result = await backend.helper(args, signal);
  if (result.exitCode === 2) {
    throw new MacosRefused("denied", result.stderr.trim());
  }
  if (result.exitCode !== 0) {
    throw new ToolRefusal(
      result.stderr.trim() || `${app.name} failed without saying why.`,
    );
  }
  return schema.parse(JSON.parse(result.stdout));
}

/** osascript's report of a script that failed: the message and its number. */
const EXECUTION_ERROR =
  /execution error: (?<message>[\s\S]*?) \((?<code>-?\d+)\)\s*$/;

/** The words an app puts ahead of its own error, which say nothing the tool doesn't. */
const APP_GOT_AN_ERROR = /^.+? got an error: /;

/**
 * Runs one of the app's own scripts and answers what it printed, its last
 * line break dropped. A failure is said in words: `errors` for the numbers
 * the script raises itself, and for the system's own, what to do about them.
 */
export async function runScript(
  { app, backend, signal }: ToolContext,
  script: string,
  values: string[],
  errors: Record<number, string> = {},
): Promise<string> {
  const result = await backend.script(script, values, signal);
  if (result.exitCode === 0) {
    return result.stdout.replace(/\n$/, "");
  }
  const reported = EXECUTION_ERROR.exec(result.stderr.trim())?.groups;
  if (!reported) {
    throw new ToolRefusal(
      result.stderr.trim() || `${app.name} failed without saying why.`,
    );
  }
  const code = Number(reported.code);
  const own = errors[code];
  if (own !== undefined) {
    throw new ToolRefusal(own);
  }
  switch (code) {
    case -1743: {
      throw new MacosRefused(
        "denied",
        `macOS keeps Instrument from controlling ${app.name}.`,
      );
    }
    case -1712: {
      // A script to an app nobody has let the app control waits on macOS's
      // prompt until the event times out; the app-call path asks macOS
      // whether that prompt is what held it.
      throw new MacosRefused(
        "timed-out",
        `${app.name} took too long to answer. It may be busy or showing a dialog; try again, or ask the person to look at ${app.name}.`,
      );
    }
    case -600:
    case -609: {
      throw new ToolRefusal(
        `${app.name} quit or couldn't be opened. Try again; if it fails again, ask the person to open ${app.name}.`,
      );
    }
    default: {
      throw new ToolRefusal(
        (reported.message ?? "").replace(APP_GOT_AN_ERROR, "").trim(),
      );
    }
  }
}
