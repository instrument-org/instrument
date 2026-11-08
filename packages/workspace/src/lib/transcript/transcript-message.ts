import { z } from "zod";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { connectAppResults } from "../../tools/connect-app-output";
import { dataPartVisibility } from "../data-part-visibility";
import { isToolPart } from "../is-tool-part";

/** Where a tool call has got to. */
export type StepStatus = "done" | "failed" | "queued" | "running" | "writing";

/** One search result, as a web card lists it. */
export interface WebResult {
  title?: string;
  url: string;
}

/**
 * What a call can draw on a card, read off the call itself: its words, its
 * picture, its results. Absent on a call with nothing to show, which keeps
 * only its row.
 */
export type StepShows =
  | {
      /** The change an edit made, each side cut to a card's length. */
      after?: string;
      before?: string;
      /** Whether the call made the file, once it has said. */
      isNew?: boolean;
      kind: "file";
      path: string;
      /** The file's words so far, cut to a card's length. */
      words?: string;
    }
  | { kind: "fetch"; title?: string; url?: string; words?: string }
  | { kind: "generated"; modifiedAt?: number; path?: string }
  | {
      blob?: string;
      kind: "image";
      mimeType?: string;
      modifiedAt?: number;
      path?: string;
    }
  | { kind: "opened"; target: string }
  | { changesPage: boolean; kind: "page"; url?: string }
  | { kind: "search"; query?: string; results: WebResult[]; total: number };

/**
 * One tool call or thought, without what it carried: enough to draw its row
 * and its card, with the command and output read only when the row is opened.
 * A transcript of long scripts and big outputs costs what its words cost.
 */
export interface StepPart {
  activity?: string;
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
  shows?: StepShows;
  status: StepStatus;
  /** The tasks this call started, whose cards stand for it. */
  startedTasks?: StoreId.Session[];
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

export type TranscriptMessage =
  | (SessionMessage.Assistant & { parts: TranscriptPart[] })
  | (SessionMessage.User & { parts: TranscriptPart[] });

/** Parts that are no row of their own, yet shape what the transcript draws. */
const READ_THOUGH_HIDDEN = new Set<SessionMessagePart.DataPart["type"]>([
  "data-attachments",
  "data-intent",
  "data-stepFacts",
  "data-viewContext",
  "data-workSummary",
]);

/** The most of a file's words a step carries; the rest opens with the file. */
const FILE_WORDS_CHARS = 1500;
/** The most of either side of an edit a step carries. */
const EDIT_SIDE_CHARS = 400;
/** The longest thought sent with its row; the whole is read when it is opened. */
const THOUGHT_CHARS = 200;
const PAGE_WORDS_CHARS = 500;
const RESULTS_SHOWN = 8;

/**
 * A stored message as the transcript draws it, or nothing for one it does not
 * draw.
 */
export function transcriptMessage(
  message: SessionMessage.WithParts,
): TranscriptMessage | undefined {
  if (message.role !== "assistant" && message.role !== "user") {
    return undefined;
  }
  const parts = message.parts.flatMap((part) =>
    transcriptParts(part, message.parts),
  );
  return { ...message, parts };
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
    newString: z.string(),
    oldString: z.string(),
    query: z.string(),
    url: z.string(),
  })
  .partial();

/** What a finished call says of itself, whichever tool it was. */
const StepOutputSchema = z
  .looseObject({
    blob: z.string(),
    exitCode: z.number(),
    filePath: z.string(),
    handOffs: z.array(
      z.looseObject({ kind: z.string(), sessionId: z.string() }),
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
      sources: z.array(
        z.looseObject({ title: z.string().optional(), url: z.string() }),
      ),
    }),
    state: z.string(),
    text: z.string(),
    title: z.string(),
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
  const activity = input.activity?.trim();
  const explanation = input.explanation?.trim();
  const startedTasks = (output.handOffs ?? []).flatMap((handOff) =>
    handOff.kind === "created" ? [handOff.sessionId as StoreId.Session] : [],
  );
  const status = stepStatus(part, siblings, output);
  const shows = stepShows(part.type, input, output, status);
  return {
    ...(activity && { activity }),
    ...(explanation && { explanation }),
    metadata: part.metadata,
    ...(output.processId && { processId: output.processId }),
    ...(shows && { shows }),
    ...(startedTasks.length > 0 && { startedTasks }),
    status,
    tool: part.type,
    type: "step",
  };
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
        : didNotWork(output)
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
      return {
        ...(output.isNewFile !== undefined && { isNew: output.isNewFile }),
        kind: "file",
        path,
        ...(words !== undefined && { words }),
      };
    }
    case "tool-edit_file": {
      const path = input.filePath ?? output.filePath;
      if (path === undefined) {
        return undefined;
      }
      return {
        ...(input.newString !== undefined && {
          after: input.newString.slice(0, EDIT_SIDE_CHARS),
        }),
        ...(input.oldString !== undefined && {
          before: input.oldString.slice(0, EDIT_SIDE_CHARS),
        }),
        kind: "file",
        path,
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
    case "tool-web_search": {
      const sources = output.results?.sources ?? [];
      return {
        kind: "search",
        ...(input.query !== undefined && { query: input.query }),
        results: sources.slice(0, RESULTS_SHOWN).map(({ title, url }) => ({
          ...(title !== undefined && { title }),
          url,
        })),
        total: sources.length,
      };
    }
    case "tool-web_fetch": {
      const url = input.url ?? output.url;
      return {
        kind: "fetch",
        ...(url !== undefined && { url }),
        ...pageOf(output.text, output.title),
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
 * The title and opening words of a fetched page. Its title is the one the
 * page gives itself, and its first heading where the fetch kept none. A page's
 * text opens with its navigation, so its words start at its first heading,
 * and a page with none gives no words at all rather than a screen of links.
 */
function pageOf(
  text: string | undefined,
  title: string | undefined,
): { title?: string; words?: string } {
  const heading = text === undefined ? null : /^#{1,2}\s+(.+)$/m.exec(text);
  if (text === undefined || heading?.[1] === undefined) {
    return title === undefined ? {} : { title };
  }
  const words = text
    .slice(heading.index + heading[0].length)
    .replaceAll(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/[#*_`>]/g, "")
    .replaceAll(/\n{2,}/g, "\n")
    .trim()
    .slice(0, PAGE_WORDS_CHARS);
  return {
    title: title ?? heading[1].trim(),
    ...(words !== "" && { words }),
  };
}

/** Where a program starts in a shell line, and not a word its arguments say. */
const COMMAND_START = String.raw`(?:^|[\n;&|(])\s*`;
const AGENT_BROWSER = new RegExp(String.raw`${COMMAND_START}agent-browser\b`);
const BROWSER_SUBCOMMAND =
  /\bagent-browser\b(?:\s+--?[\w-]+(?:[= ]\S+)?)*\s+([a-z][\w-]*)/g;
const OPENS_A_PLACE = new RegExp(
  String.raw`${COMMAND_START}(?:(?:instrument\s+)?(?:window|tab)\s+(?:open|show)|open)\s+(?:-\S+\s+(?:"[^"]*"\s+|'[^']*'\s+|[A-Z]\w*\s+)?)*(?:"([^"]+)"|'([^']+)'|(\S+))`,
);
/** What a command hands a program to read, which is that program's words. */
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g;
/** A word that could be a place: a file's name, a path or an address. */
const NAMES_A_PLACE = /[/.:]/;
/** What the chat tells a task is the task's to do, whatever it names. */
const STARTS_A_TASK = /^\s*(?:instrument\s+)?task\b/;
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
 * What a shell command shows, from its words: a page it drives, or a page or
 * file it opens for the person. A command's files are told by the disk
 * (`file-changes.ts`), never from here.
 */
function commandShows(command: string): StepShows | undefined {
  if (STARTS_A_TASK.test(command)) {
    return undefined;
  }
  const words = command.replaceAll(HEREDOC, "");
  if (AGENT_BROWSER.test(words)) {
    const url = URL_IN_COMMAND.exec(words)?.[0];
    const changesPage = [...words.matchAll(BROWSER_SUBCOMMAND)].some(
      (match) => match[1] !== undefined && CHANGES_THE_PAGE.has(match[1]),
    );
    return { changesPage, kind: "page", ...(url && { url }) };
  }
  const opened = OPENS_A_PLACE.exec(words);
  const target = opened?.[1] ?? opened?.[2] ?? opened?.[3];
  return target !== undefined && NAMES_A_PLACE.test(target)
    ? { kind: "opened", target }
    : undefined;
}

/** Whether a part is one of a transcript message's steps. */
export function isStepPart(part: TranscriptPart): part is StepPart {
  return part.type === "step";
}
