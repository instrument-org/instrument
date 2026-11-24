import { MARKDOWN_EXTENSIONS } from "@instrument-org/shared";
import { z } from "zod";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { connectAppResults } from "../../tools/connect-app-output";
import { dataPartVisibility } from "../data-part-visibility";
import { isToolPart } from "../is-tool-part";

/** Where a tool call has got to. */
export type StepStatus = "done" | "failed" | "queued" | "running" | "writing";

/**
 * What a call can draw on a card, read off the call itself: its words or its
 * picture. Absent on a call with nothing to show, which keeps only its row.
 */
export type StepShows =
  | {
      /** Whether the call made the file, once it has said. */
      isNew?: boolean;
      kind: "file";
      /**
       * How many lines it has so far, while a call writes whole a file no
       * card shows as it is written (`writtenFileShows`).
       */
      lines?: number;
      /** When the call last wrote the file, once it has said. */
      modifiedAt?: number;
      path: string;
      /**
       * A page's whole source so far, while the call writing it is going, so
       * a card can draw the page as it arrives. The file is read once written.
       */
      source?: string;
      /** The file's words so far, cut to a card's length. */
      words?: string;
    }
  | { kind: "generated"; modifiedAt?: number; path?: string }
  | {
      blob?: string;
      kind: "image";
      mimeType?: string;
      modifiedAt?: number;
      path?: string;
    }
  | { changesPage: boolean; kind: "page"; url?: string };

/**
 * One tool call or thought, without what it carried: enough to draw its row
 * and its card, with the command and output read only when the row is opened.
 * A transcript of long scripts and big outputs costs what its words cost.
 */
export interface StepPart {
  activity?: string;
  /**
   * A permission ask the app refused before any card went up, for a reason
   * the person reads. `inSettings` says a setting of theirs is the reason.
   */
  blocked?: { inSettings?: true; why: string };
  /** What a blocked or failed call couldn't do, which is its line. */
  couldnt?: string;
  explanation?: string;
  metadata: {
    createdAt: Date;
    endedAt?: Date;
    id: StoreId.Part;
    messageId: StoreId.Message;
    sessionId: StoreId.Session;
    startedAt?: Date;
  };
  /** The command left running, by the id the process list has it under. */
  processId?: string;
  /** It put up a card for the person to answer, which ends the turn on it. */
  putsUpCard?: true;
  shows?: StepShows;
  /** The sites a search came back from or a page read reached, which its row shows. */
  sites?: string[];
  status: StepStatus;
  /** The tasks this call sent work to, each from the message it put in its log. */
  sentTasks?: { messageId: StoreId.Message; sessionId: StoreId.Session }[];
  /** The tasks this call started, whose cards stand for it. */
  startedTasks?: StoreId.Session[];
  /**
   * A call that starts a task or sends one work, known from its command as
   * it arrives, so its card stands for it before the task exists. `name` is
   * the new task's `--name`, once that much has arrived.
   */
  startsTask?: { name?: string };
  tool: "reasoning" | SessionMessagePart.ToolPart["type"];
  type: "step";
}

/**
 * What a message's row in the transcript is drawn from: its words, its notes,
 * its steps as {@link StepPart}s, and whole only the calls a person answers or
 * that the note over the reply box reads.
 */
export type TranscriptPart =
  | SessionMessagePart.DataPart
  | SessionMessagePart.SourceDocumentPart
  | SessionMessagePart.SourceUrlPart
  | SessionMessagePart.TextPart
  | SessionMessagePart.ToolPart
  | StepPart;

/**
 * The computer a message was sent on, as its records say: its name, and
 * whether it is this one.
 */
export interface WrittenOn {
  device: string;
  here: boolean;
  name: string;
}

export type TranscriptMessage =
  | (SessionMessage.Assistant & { parts: TranscriptPart[] })
  | (SessionMessage.User & {
      parts: TranscriptPart[];
      /**
       * Where the person sent it, once its records are read: a chat picked up
       * on another computer draws a line where it moved (`chatSeparators`).
       */
      writtenOn?: WrittenOn;
    });

/** Parts that are no row of their own, yet shape what the transcript draws. */
const READ_THOUGH_HIDDEN = new Set<SessionMessagePart.DataPart["type"]>([
  "data-attachments",
  "data-fileVersions",
  "data-intent",
  "data-stepFacts",
  "data-viewContext",
  "data-workSummary",
]);

/** The most of a file's words a step carries; the rest opens with the file. */
const FILE_WORDS_CHARS = 1500;
/** The longest thought sent with its row; the whole is read when it is opened. */
const THOUGHT_CHARS = 200;

/**
 * A stored message as the transcript draws it, or nothing for one it does not
 * draw. `writtenOn` says which computer the person sent a message on.
 */
export function transcriptMessage(
  message: SessionMessage.WithParts,
  writtenOn?: WrittenOn,
): TranscriptMessage | undefined {
  if (message.role !== "assistant" && message.role !== "user") {
    return undefined;
  }
  const parts = message.parts.flatMap((part) =>
    transcriptParts(part, message.parts),
  );
  return message.role === "user" && writtenOn !== undefined
    ? { ...message, parts, writtenOn }
    : { ...message, parts };
}

/** A thought's words: a provider that keeps them to itself leaves a marker. */
export function thoughtText(text: string): string {
  return text.replaceAll("[REDACTED]", "");
}

function transcriptParts(
  part: SessionMessagePart.Type,
  siblings: readonly SessionMessagePart.Type[],
): TranscriptPart[] {
  if (isToolPart(part)) {
    if (answeredByAPerson(part)) {
      return [part];
    }
    const step = toolStep(part, siblings);
    return readByTheReplyBox(part) ? [step, part] : [step];
  }
  switch (part.type) {
    case "reasoning": {
      // A thought with no words yet draws nothing: a model that keeps them to
      // itself would flash a row that goes again as the part ends.
      return thoughtText(part.text).trim() === ""
        ? []
        : [
            {
              explanation: thoughtText(part.text).slice(0, THOUGHT_CHARS),
              metadata: part.metadata,
              status: part.state === "streaming" ? "running" : "done",
              tool: "reasoning",
              type: "step",
            },
          ];
    }
    case "text":
    case "source-document":
    case "source-url": {
      return [part];
    }
    case "file":
    case "step-start": {
      return [];
    }
    default: {
      return READ_THOUGH_HIDDEN.has(part.type) ||
        dataPartVisibility(part) === "always"
        ? [part]
        : [];
    }
  }
}

/** A card the person answers. A refused one is the agent's to fix, and a step. */
function answeredByAPerson(part: SessionMessagePart.ToolPart): boolean {
  switch (part.type) {
    case "tool-choose": {
      return part.state !== "input-streaming" && part.state !== "output-error";
    }
    case "tool-connect_app": {
      return (
        part.state === "output-available" &&
        connectAppResults(part.output).some(
          (result) => result.state !== "failure",
        )
      );
    }
    case "tool-offer_feedback": {
      return part.state === "output-available" && part.output.offered;
    }
    default: {
      return false;
    }
  }
}

/**
 * Why the app refused a permission ask before any card went up. An ask that
 * gives the person no reason is the agent's own mistake, and a failed step.
 */
function blockedOf(
  part: SessionMessagePart.ToolPart,
): StepPart["blocked"] | undefined {
  if (
    part.type !== "tool-ask_permission" ||
    part.state !== "output-available" ||
    part.output.state !== "refused" ||
    part.output.why === undefined
  ) {
    return undefined;
  }
  return {
    ...(part.output.inSettings && { inSettings: true }),
    why: part.output.why,
  };
}

/** What a blocked or failed call couldn't do, by the thing's own name. */
function couldntOf(part: SessionMessagePart.ToolPart): string | undefined {
  if (part.state !== "output-available") {
    return undefined;
  }
  if (part.type === "tool-ask_permission" && blockedOf(part)) {
    return part.input.kind === "app"
      ? `Couldn't use ${part.input.target}`
      : `Couldn't open ${nameOf(part.input.target)}`;
  }
  return part.type === "tool-read_file" &&
    part.output.state === "does-not-exist"
    ? `Couldn't find ${nameOf(part.output.filePath)}`
    : undefined;
}

/** A path's last name, however its slashes run. */
function nameOf(path: string): string {
  return path.split(/[/\\]/).findLast((name) => name !== "") ?? path;
}

/** A call that ran into the account's plan, which the reply box offers a way past. */
function readByTheReplyBox(part: SessionMessagePart.ToolPart): boolean {
  if (part.state !== "output-available") {
    return false;
  }
  if (part.type === "tool-generate_image") {
    return (
      part.output.state === "failure" &&
      (part.output.errorType === "no-image-model" ||
        part.output.errorType === "refused")
    );
  }
  return (
    part.type === "tool-web_search" &&
    part.output.state === "success" &&
    part.output.platformRefusal !== undefined
  );
}

/**
 * The fields a row or card reads off a call's input. The input may still be
 * arriving, when any of them can be missing or half written.
 */
const StepInputSchema = z
  .object({
    activity: z.string(),
    command: z.string(),
    content: z.string(),
    explanation: z.string(),
    filePath: z.string(),
    url: z.string(),
  })
  .partial();

/** What a finished call says of itself, whichever tool it was. */
const StepOutputSchema = z
  .looseObject({
    asks: z.array(z.string()),
    blob: z.string(),
    exitCode: z.number(),
    filePath: z.string(),
    handOffs: z.array(
      z.looseObject({
        kind: z.string(),
        messageId: z.string().optional(),
        sessionId: z.string(),
      }),
    ),
    images: z.array(
      z.looseObject({
        filePath: z.string(),
        modifiedAt: z.number().optional(),
      }),
    ),
    isNewFile: z.boolean(),
    mimeType: z.string(),
    modifiedAt: z.number(),
    processId: z.string(),
    results: z.looseObject({
      sources: z.array(z.looseObject({ url: z.string() })),
    }),
    state: z.string(),
    url: z.string(),
  })
  .partial();

type StepInput = z.output<typeof StepInputSchema>;
type StepOutput = z.output<typeof StepOutputSchema>;

function toolStep(
  part: SessionMessagePart.ToolPart,
  siblings: readonly SessionMessagePart.Type[],
): StepPart {
  const parsedInput = StepInputSchema.safeParse(part.input);
  const input = parsedInput.success ? parsedInput.data : {};
  const parsedOutput =
    part.state === "output-available"
      ? StepOutputSchema.safeParse(part.output)
      : undefined;
  const output = parsedOutput?.success ? parsedOutput.data : {};
  const activity = isStillArriving(part, "activity")
    ? undefined
    : input.activity?.trim();
  const explanation = input.explanation?.trim();
  const startedTasks = (output.handOffs ?? []).flatMap((handOff) =>
    handOff.kind === "created" ? [handOff.sessionId as StoreId.Session] : [],
  );
  // A send recorded before sends named their message draws no card.
  const sentTasks = (output.handOffs ?? []).flatMap((handOff) =>
    handOff.kind === "sent" && handOff.messageId !== undefined
      ? [
          {
            messageId: handOff.messageId as StoreId.Message,
            sessionId: handOff.sessionId as StoreId.Session,
          },
        ]
      : [],
  );
  const status = stepStatus(part, siblings, output);
  const shows = stepShows(part.type, input, output, status);
  const sites = stepSites(part.type, input, output, status);
  const putsUpCard =
    (part.type === "tool-ask_permission" && output.state === "asked") ||
    (part.type === "tool-bash" && (output.asks?.length ?? 0) > 0);
  const startsTask =
    part.type === "tool-bash" && input.command !== undefined
      ? taskCallOf(input.command)
      : undefined;
  const blocked = blockedOf(part);
  const couldnt = couldntOf(part);
  return {
    ...(activity && { activity }),
    ...(blocked && { blocked }),
    ...(couldnt !== undefined && { couldnt }),
    ...(explanation && { explanation }),
    metadata: part.metadata,
    ...(output.processId && { processId: output.processId }),
    ...(putsUpCard && { putsUpCard }),
    ...(sentTasks.length > 0 && { sentTasks }),
    ...(shows && { shows }),
    ...(sites.length > 0 && { sites }),
    ...(startedTasks.length > 0 && { startedTasks }),
    ...(startsTask && { startsTask }),
    status,
    tool: part.type,
    type: "step",
  };
}

/**
 * Whether a field of a call's input may still be half written: the input is
 * arriving and nothing after the field has begun. A field arrives whole only
 * once the next one starts, since a call's input is written in order.
 */
export function isStillArriving(
  part: SessionMessagePart.ToolPart,
  field: string,
): boolean {
  return (
    part.state === "input-streaming" &&
    typeof part.input === "object" &&
    part.input !== null &&
    Object.keys(part.input).at(-1) === field
  );
}

function stepStatus(
  part: SessionMessagePart.ToolPart,
  siblings: readonly SessionMessagePart.Type[],
  output: StepOutput,
): StepStatus {
  switch (part.state) {
    case "input-streaming": {
      return "writing";
    }
    case "input-available": {
      return part.metadata.startedAt !== undefined ||
        isNextInLine(part, siblings)
        ? "running"
        : "queued";
    }
    case "output-error": {
      return "failed";
    }
    case "output-available": {
      return part.preliminary === true
        ? "running"
        : didNotWork(output) || refusedAsk(part)
          ? "failed"
          : "done";
    }
  }
}

/** Whether every call ahead of this one in its message has finished. */
function isNextInLine(
  part: SessionMessagePart.ToolPart,
  siblings: readonly SessionMessagePart.Type[],
): boolean {
  for (const other of siblings) {
    if (other.metadata.id === part.metadata.id) {
      return true;
    }
    if (
      isToolPart(other) &&
      other.state !== "output-available" &&
      other.state !== "output-error"
    ) {
      return false;
    }
  }
  return false;
}

function refusedAsk(part: SessionMessagePart.ToolPart): boolean {
  return (
    part.type === "tool-ask_permission" &&
    part.state === "output-available" &&
    part.output.state === "refused"
  );
}

/** A call that returned, and says in its answer that it could not do it. */
function didNotWork({ exitCode, state }: StepOutput): boolean {
  return (
    (exitCode !== undefined && exitCode !== 0) ||
    state === "does-not-exist" ||
    state === "failure" ||
    state === "not-found"
  );
}

function stepShows(
  tool: SessionMessagePart.ToolPart["type"],
  input: StepInput,
  output: StepOutput,
  status: StepStatus,
): StepShows | undefined {
  switch (tool) {
    case "tool-write_file": {
      const path = input.filePath ?? output.filePath;
      if (path === undefined) {
        return undefined;
      }
      const words = wordsOnACard(input.content, status);
      const shown = writtenFileShows(path);
      const source =
        status === "done" || shown !== "page" ? undefined : input.content;
      const lines =
        status === "done" ||
        input.content === undefined ||
        shown === "page" ||
        shown === "words"
          ? undefined
          : linesOf(input.content);
      return {
        ...(output.isNewFile !== undefined && { isNew: output.isNewFile }),
        kind: "file",
        ...(lines !== undefined && { lines }),
        ...(output.modifiedAt !== undefined && {
          modifiedAt: output.modifiedAt,
        }),
        path,
        ...(source !== undefined && { source }),
        ...(words !== undefined && { words }),
      };
    }
    case "tool-read_file": {
      return output.state === "image"
        ? {
            ...(output.blob !== undefined && { blob: output.blob }),
            kind: "image",
            ...(output.mimeType !== undefined && {
              mimeType: output.mimeType,
            }),
            ...(output.modifiedAt !== undefined && {
              modifiedAt: output.modifiedAt,
            }),
            ...(output.filePath !== undefined && { path: output.filePath }),
          }
        : undefined;
    }
    case "tool-generate_image": {
      const image = output.images?.[0];
      return {
        kind: "generated",
        ...(image?.filePath !== undefined && { path: image.filePath }),
        ...(image?.modifiedAt !== undefined && {
          modifiedAt: image.modifiedAt,
        }),
      };
    }
    case "tool-bash": {
      return input.command === undefined
        ? undefined
        : commandShows(input.command);
    }
    default: {
      return undefined;
    }
  }
}

/** A file a browser draws as a page, which a card draws as one too. */
export const isPagePath = (path: string) => /\.html?$/i.test(path);

/** The files the app draws as they look, a drawing or a table, which a card shows by their picture. */
const PICTURED_EXTENSIONS = new Set(["csv", "svg", "tsv"]);

/** The files written for a person to read as they stand: prose, in Markdown or plain text. */
const READ_EXTENSIONS = new Set([
  ...MARKDOWN_EXTENSIONS,
  "adoc",
  "asciidoc",
  "org",
  "rst",
  "text",
  "txt",
]);

/**
 * What a card shows of a file a call writes whole: a page as it draws, a
 * drawing or a table by its picture, words as they are typed. Anything else,
 * code and data above all, has nothing: its source going by is not worth
 * watching.
 */
export function writtenFileShows(
  path: string,
): "page" | "picture" | "words" | undefined {
  if (isPagePath(path)) {
    return "page";
  }
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  return PICTURED_EXTENSIONS.has(extension)
    ? "picture"
    : READ_EXTENSIONS.has(extension)
      ? "words"
      : undefined;
}

/** How many lines `content` has so far, its last line counted however far it has got. */
function linesOf(content: string): number {
  let count = content === "" || content.endsWith("\n") ? 0 : 1;
  for (const character of content) {
    if (character === "\n") {
      count += 1;
    }
  }
  return count;
}

/**
 * What a card shows of a file: the end of what has arrived while the model is
 * writing it, since that is where the words are appearing, and its start once
 * it is whole.
 */
function wordsOnACard(content: string | undefined, status: StepStatus) {
  if (content === undefined) {
    return undefined;
  }
  if (status !== "writing") {
    return content.slice(0, FILE_WORDS_CHARS);
  }
  if (content.length <= FILE_WORDS_CHARS) {
    return content;
  }
  // From the first whole line, so neither a grammar nor Markdown starts reading
  // partway through a token.
  const tail = content.slice(-FILE_WORDS_CHARS);
  const lineStart = tail.indexOf("\n");
  return lineStart === -1 ? tail : tail.slice(lineStart + 1);
}

/**
 * The sites a call reached, each once and in order: where a search's results
 * came from, or the page a read fetched. A call that failed reached none.
 */
function stepSites(
  tool: SessionMessagePart.ToolPart["type"],
  input: StepInput,
  output: StepOutput,
  status: StepStatus,
): string[] {
  if (status === "failed") {
    return [];
  }
  const urls =
    tool === "tool-web_search"
      ? (output.results?.sources ?? []).map((source) => source.url)
      : tool === "tool-web_fetch"
        ? [input.url ?? output.url].filter((url) => url !== undefined)
        : [];
  return [...new Set(urls.flatMap((url) => siteOf(url) ?? []))];
}

function siteOf(url: string): string | undefined {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:"
      ? hostname.replace(/^www\./, "")
      : undefined;
  } catch {
    return undefined;
  }
}

/** Where a program starts in a shell line, and not a word its arguments say. */
const COMMAND_START = String.raw`(?:^|[\n;&|(])\s*`;
const AGENT_BROWSER = new RegExp(String.raw`${COMMAND_START}agent-browser\b`);
const BROWSER_SUBCOMMAND =
  /\bagent-browser\b(?:\s+--?[\w-]+(?:[= ]\S+)?)*\s+([a-z][\w-]*)/g;
/** What a command hands a program to read, which is that program's words. */
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g;
/** What the chat tells a task is the task's to do, whatever it names. */
const STARTS_A_TASK = /^\s*(?:instrument\s+)?task\b/;
/** A command that starts a task or sends one work, and the new task's name. */
const TASK_CALL = /^\s*(?:instrument\s+)?task\s+(new|send)\b/;
const TASK_NAME = /\s--name(?:=|\s+)(?:'([^']*)'|"([^"]*)"|([^\s'"]+))/;

/** Whether a command starts a task or sends one work, with the name a new one is given. */
function taskCallOf(command: string): { name?: string } | undefined {
  const call = TASK_CALL.exec(command);
  if (!call) {
    return undefined;
  }
  const named = call[1] === "new" ? TASK_NAME.exec(command) : null;
  const name = (named?.[1] ?? named?.[2] ?? named?.[3])?.trim();
  return name ? { name } : {};
}
const URL_IN_COMMAND = /(?:https?|file):\/\/[^\s"')]+/;
/** The browser commands that change what a page shows, and so its picture. */
const CHANGES_THE_PAGE = new Set([
  "back",
  "check",
  "click",
  "dblclick",
  "drag",
  "fill",
  "find",
  "forward",
  "goto",
  "keyboard",
  "navigate",
  "open",
  "press",
  "reload",
  "scroll",
  "scrollintoview",
  "select",
  "type",
  "uncheck",
  "upload",
]);

/**
 * What a shell command shows, from its words: the page it drives. A command's
 * files are told by the disk (`file-changes.ts`), never from here.
 */
function commandShows(command: string): StepShows | undefined {
  if (STARTS_A_TASK.test(command)) {
    return undefined;
  }
  const words = command.replaceAll(HEREDOC, "");
  if (!AGENT_BROWSER.test(words)) {
    return undefined;
  }
  const url = URL_IN_COMMAND.exec(words)?.[0];
  const changesPage = [...words.matchAll(BROWSER_SUBCOMMAND)].some(
    (match) => match[1] !== undefined && CHANGES_THE_PAGE.has(match[1]),
  );
  return { changesPage, kind: "page", ...(url && { url }) };
}

/** Whether a part is one of a transcript message's steps. */
export function isStepPart(part: TranscriptPart): part is StepPart {
  return part.type === "step";
}
