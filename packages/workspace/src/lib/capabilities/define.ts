import { type z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";

/** Where a call comes from: `instrument` in the shell, or a script over its channel. */
export type Surface = "cli" | "script";

/**
 * What a call runs under, captured when the shell command or the script's
 * channel opens, never sent by the caller: a script reaches exactly what the
 * shell's own `instrument` reaches in the same bash call.
 */
export interface CapabilityContext {
  chatId: ChatId;
  /** The canonical id of the model the call answers to. */
  model?: string;
  /**
   * The session's model window as the bash call finds it, read at most once
   * per call: a script's hundred requests ask what the model has seen once.
   */
  modelWindow: () => Promise<readonly SessionMessage.WithParts[] | undefined>;
  role: "chat" | "task";
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  surface: Surface;
}

/** What a gate decides before the work runs: the same answer on every surface. */
export type Gate =
  | { kind: "allowed" }
  /** Final for this chat: Not allowed, "not now", nothing connected. */
  | { kind: "refused"; message: string }
  /** The agent asks with `ask_permission`. */
  | {
      ask: { kind: "app" | "folder"; target: string };
      kind: "ask";
      message: string;
    }
  /** A card is already up (macOS's own question); the turn ends after the bash call. */
  | { askId: string; kind: "card"; message: string }
  /** The app's guide, handed over before the session's first request to it. */
  | { app: string; guide: string; kind: "read-first" };

/** How an error reply names what went wrong, which picks the exception a script gets. */
export type CapabilityErrorKind =
  | "ask"
  | "card"
  | "failed"
  | "read-first"
  | "refused";

/** An error reply, the same shape on the channel and inside the dispatcher. */
export interface CapabilityErrorReply {
  ask?: { kind: "app" | "folder"; target: string };
  kind: CapabilityErrorKind;
  message: string;
}

/**
 * A failure `run` throws when it knows what kind it is; anything else it
 * throws is a plain failure with the error's message.
 */
export class CapabilityFailure extends Error {
  constructor(
    message: string,
    readonly kind: CapabilityErrorKind = "failed",
  ) {
    super(message);
    this.name = "CapabilityFailure";
  }
}

/** How a capability reads on the `instrument` command line. */
interface CliSpec<Input> {
  /** The command and subcommand words after `instrument`, as `["app", "request"]`. */
  words: readonly [string, string];
  /** Other subcommand words that run it, as `tool` beside `tools`. */
  aliases?: readonly string[];
  /** Flag names where a field's own would read wrong: `params` as `--param`. */
  flagNames?: Partial<Record<keyof Input & string, string>>;
  /** The lines under its synopsis in the command's usage. */
  help: string;
  /** Fields taken in order from the words after the subcommand. */
  positional?: readonly (keyof Input & string)[];
  /** A field read from stdin when stdin has something, ahead of its positional word. */
  stdin?: keyof Input & string;
}

/** How a capability reads in a script. */
interface ScriptSpec<Input> {
  /** Fields a script passes in order; the rest go in one object (Node) or as keywords (Python). */
  positional?: readonly (keyof Input & string)[];
}

/**
 * One capability, defined once: its schemas, the one gate every surface
 * passes, the work, and how a result reads as text. Every surface the agent
 * reaches it by is generated from this.
 */
export interface Capability<
  In extends z.ZodObject = z.ZodObject,
  Out extends z.ZodType = z.ZodType,
> {
  /** Dotted, snake_case: `apps.request`, `memory.save`. */
  name: string;
  /** One line, for `instrument help`, `help(...)` in Python and the describe answer. */
  summary: string;
  input: In;
  output: Out;
  /** Which generated surfaces carry it. */
  surfaces: {
    cli?: CliSpec<z.output<In>>;
    script?: ScriptSpec<z.output<In>>;
  };
  /** Where it exists: the platforms, the shells, and a build check. */
  where?: {
    available?: () => boolean;
    platforms?: readonly NodeJS.Platform[];
    roles?: readonly ("chat" | "task")[];
  };
  /** Decides before the work runs; the same answer on every surface. */
  gate?(input: z.output<In>, ctx: CapabilityContext): Promise<Gate>;
  /**
   * How a result prints on the command line where it is more than `text` on
   * stdout: the status line of a request on stderr, say, or exit 1 for a
   * service's error.
   */
  render?(
    output: z.output<Out>,
    input: z.output<In>,
  ): {
    exitCode?: number;
    stderr?: string;
    stdout: string;
  };
  run(input: z.output<In>, ctx: CapabilityContext): Promise<z.output<Out>>;
  /** How a result reads as text where a person or the model reads it. */
  text(output: z.output<Out>): string;
}

/** A capability with its schemas' types checked against its gate, run and text. */
export function defineCapability<In extends z.ZodObject, Out extends z.ZodType>(
  capability: Capability<In, Out>,
): Capability<In, Out> {
  return capability;
}
