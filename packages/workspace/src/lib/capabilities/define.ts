import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { type ToolResultPart } from "ai";
import { type Result } from "neverthrow";
import { type z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { type Asker } from "../chat/asks";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { type BaseInputSchema } from "../../tools/base";
import { type ToolName } from "../../tools/types";
import { type ExecuteError } from "../execute-error";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";

/**
 * Where a call comes from: `instrument` in the shell, a script over its
 * channel, or the model calling a tool.
 */
type Surface = "cli" | "script" | "tool";

/** Whose session a call runs in: the chat's own, or one of its tasks. */
export type Role = "chat" | "task";

/**
 * What a call runs under, captured when the shell command or the script's
 * channel opens, never sent by the caller: a script reaches exactly what the
 * shell's own `instrument` reaches in the same bash call.
 */
export interface CapabilityContext {
  /** Who a card the call raises is from: the bash call's chat, session and part. */
  asker: Asker;
  /**
   * The model the chat's sessions run on, in full, for work that calls a
   * model on its behalf (a search, an image): read once per bash call, at
   * the first call that asks.
   */
  callingModel: () => Promise<AIGatewayModel.Type>;
  chatId: ChatId;
  /**
   * The shell's folders under the chat's rules, for work that holds what it
   * reads to them; absent where no folders were given.
   */
  layout?: WorkspaceFsLayout;
  /** The canonical id of the model the call answers to. */
  model?: string;
  /**
   * The session's model window as the bash call finds it, read at most once
   * per call: a script's hundred requests ask what the model has seen once.
   */
  modelWindow: () => Promise<readonly SessionMessage.WithParts[] | undefined>;
  /**
   * A file the call names for an app to read outside every sandbox, as the
   * absolute path the chat may read: held to the folder rules as the shell's
   * own commands hold a path. Throws what it refuses.
   */
  readableFile: (named: string) => Promise<string>;
  /**
   * A file the command line names, read through the shell that ran it and
   * held to the chat's rules; absent where no shell names files (a script).
   */
  readShellFile?: (named: string) => Promise<Uint8Array>;
  /** What is left of the bash call's yield window, for work that waits. */
  remainingYieldMs: () => number;
  role: Role;
  sessionId: StoreId.Session;
  /**
   * What is at a path the command line names, resolved from the shell's
   * folder; absent where no shell names paths (a script).
   */
  shellPath?: (named: string) => Promise<ShellPath>;
  signal?: AbortSignal;
  surface: Exclude<Surface, "tool">;
}

/** A path the command line named, as the shell resolved it, and what is there. */
export interface ShellPath {
  kind: "file" | "folder" | "none" | "other";
  path: string;
  /** A file's length in bytes. */
  size?: number;
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
  /** Apps' guides, handed over before the session's first request to each. */
  | { guides: { app: string; guide: string }[]; kind: "read-first" };

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
    /** For a `card`, the card `run` put up, which ends the turn as a gate's does. */
    readonly askId?: string,
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
  /**
   * The last positional field takes every word left, joined by spaces, so
   * `instrument x search new rust release` searches for all three words.
   */
  rest?: boolean;
  /** A field read from stdin when stdin has something, ahead of its positional word. */
  stdin?: keyof Input & string;
}

/** How a capability reads in a script. */
interface ScriptSpec<Input> {
  /** Fields a script passes in order; the rest go in one object (Node) or as keywords (Python). */
  positional?: readonly (keyof Input & string)[];
}

/** A model tool's input schema: the `activity` and `explanation` every call carries, then the capability's fields. */
export type ToolInputSchema<In extends z.ZodObject> = ReturnType<
  typeof BaseInputSchema.extend<In["shape"]>
>;

/** What a model tool's call is given. */
export type ToolInput<In extends z.ZodObject> = z.output<ToolInputSchema<In>>;

/** One model tool call, as the session hands it to the tool. */
interface ToolCall<Input> {
  chatId: ChatId;
  input: Input;
  messageId: StoreId.Message;
  model: AIGatewayModel.Type;
  partId: StoreId.Part;
  sessionId: StoreId.Session;
  signal: AbortSignal;
}

type ToolResult<T> = Result<T, ExecuteError>;

/**
 * How a capability reads as a model tool. Its name, description and input
 * schema open the prefix a provider caches, so they are the same on every
 * computer and in every session of a chat, its tasks' included; a role a
 * capability leaves out is refused when the call runs, never by leaving the
 * tool out.
 */
export interface ToolSpec<
  Name extends ToolName,
  Input,
  Stored extends z.ZodType,
> {
  name: Name;
  description:
    | ((options: {
        chatId: ChatId;
        model: AIGatewayModel.Type;
      }) => Promise<string> | string)
    | string;
  /**
   * What a call records on its part. Sessions on disk keep every shape it
   * ever had, so it changes only in ways the shapes before it still read as.
   */
  output: Stored;
  readOnly: boolean;
  /** How long a call may run before it is stopped. */
  timeoutMs(options: { chatId: ChatId; input: Input }): number;
  /** The call itself; a generator's every yield is shown as it comes, its last kept. */
  execute(
    call: ToolCall<Input>,
  ):
    | AsyncGenerator<ToolResult<z.output<Stored>>>
    | Promise<ToolResult<z.output<Stored>>>;
  /** What the model reads of a recorded call. */
  toModelOutput(options: {
    input: Input;
    output: z.output<Stored>;
    toolCallId: string;
  }): ToolResultPart["output"];
}

/** Where a capability exists: the platforms, the roles, and a build check. */
export interface Where {
  available?: () => boolean;
  platforms?: readonly NodeJS.Platform[];
  roles?: readonly Role[];
  /**
   * What a call from a role left out is told, naming what to do instead;
   * a line saying only the chat has it where absent.
   */
  roleRefusal?: string;
}

interface CapabilityBase<In extends z.ZodObject> {
  /** Dotted, snake_case: `apps.request`, `memory.save`. */
  name: string;
  /** One line, for `instrument help`, `help(...)` in Python and the describe answer. */
  summary: string;
  input: In;
  where?: Where;
}

/**
 * One capability, defined once: its schemas, the one gate every surface
 * passes, the work, and how a result reads as text. Every surface the agent
 * reaches it by is generated from this.
 */
export interface Capability<
  In extends z.ZodObject = z.ZodObject,
  Out extends z.ZodType = z.ZodType,
  Name extends ToolName = ToolName,
  Stored extends z.ZodType = z.ZodType,
  // Its own parameter, so a capability's variance in `In` is its input's:
  // the tool input's mapped type would make every capability invariant.
  ToolIn = ToolInput<In>,
> extends CapabilityBase<In> {
  output: Out;
  /**
   * Which generated surfaces carry it. A tool beside a command or a script
   * call runs the same work through its own `execute`, which keeps the
   * shape its recorded calls have.
   */
  surfaces: {
    cli?: CliSpec<z.output<In>>;
    script?: ScriptSpec<z.output<In>>;
    tool?: ToolSpec<Name, ToolIn, Stored>;
  };
  /** Decides before the work runs; the same answer on the command line and in a script. */
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

/**
 * A capability only the model reaches, as a tool: one that ends the turn
 * (a card the person answers), or works on the call's own part (a file
 * read, the shell).
 */
export interface ToolCapability<
  In extends z.ZodObject = z.ZodObject,
  Name extends ToolName = ToolName,
  Stored extends z.ZodType = z.ZodType,
  ToolIn = ToolInput<In>,
> extends CapabilityBase<In> {
  surfaces: { tool: ToolSpec<Name, ToolIn, Stored> };
}

/** A capability with its schemas' types checked against its gate, run and text. */
export function defineCapability<
  In extends z.ZodObject,
  Out extends z.ZodType,
  Name extends ToolName = ToolName,
  Stored extends z.ZodType = z.ZodType,
>(
  capability: Capability<In, Out, Name, Stored>,
): Capability<In, Out, Name, Stored>;
export function defineCapability<
  In extends z.ZodObject,
  Name extends ToolName,
  Stored extends z.ZodType,
>(
  capability: ToolCapability<In, Name, Stored>,
): ToolCapability<In, Name, Stored>;
export function defineCapability(
  capability: Capability | ToolCapability,
): Capability | ToolCapability {
  return capability;
}
