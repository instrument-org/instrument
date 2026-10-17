import { APP_NAME, APP_NAME_SLUG } from "@instrument-org/shared";
import { z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { TOOL_NAMES } from "../../tools/name";
import {
  callActivity,
  clipLine,
  partCreatedAt,
  partEndedAt,
  toolCallLine,
} from "../chat/call-label";
import { isToolPart } from "../is-tool-part";
import { type FoldedChat, type FoldedSession } from "../records/fold";
import { localStamp } from "../local-stamp";
import { sessionOf } from "../records/session-of";

/**
 * A chat's `CHAT.md`: its conversation as Markdown, for the person to read in
 * a file manager, a Markdown editor or their own search of the folder, and
 * for a chat's agent to read what another chat said without opening any
 * records.
 *
 * The same records render the same bytes, every time, on any computer. So
 * nothing here reads the clock, the process's time zone or a folder's
 * listing: the zone the days and times are written in is handed in, and
 * every list is ordered by an id or by a time the records carry. A `Map` is
 * only ever asked for one key, never iterated.
 *
 * What the person sees in the chat stays visible: what they and the agent
 * said, what they sent, the cards they answered, a model switch. The work
 * between two visible messages folds into one `<details>` holding plain
 * `<pre>` lines, which is the one markup that reads the same in Obsidian: it
 * renders no Markdown inside `<details>`, so a callout or a list in there
 * would show its own source.
 */

/** What a render is made from. */
export interface ChatMarkdownInput {
  /** The chat's records as they stand, its tasks' sessions included. */
  chat: FoldedChat;
  /** The chat, for the address that opens it in the app. */
  id: ChatId;
  /** The zone the day and time headings are written in, as an IANA name. */
  timeZone: string;
  /**
   * Each topic's name by its id, for the front matter. A topic the workspace
   * no longer has is left out rather than named by its id.
   */
  topicNames?: ReadonlyMap<string, string>;
}

/** How much of one line of reasoning or of an instruction the file keeps. */
const CLIP_LENGTH = 1000;

/** Parts of a message the person sees in the chat, by type. */
const VISIBLE = new Set<string>([
  "data-asks",
  "data-attachments",
  "data-modelChange",
  "data-permissionAnswer",
  "data-questionAnswer",
  "data-reply",
  "data-skillChanges",
  "data-taskEvent",
  "file",
  "text",
  `tool-${TOOL_NAMES.choose}`,
  `tool-${TOOL_NAMES.connectApp}`,
]);

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** What a `choose` card asked. */
const ChooseInputSchema = z.object({
  choices: z.array(z.string()).optional(),
  question: z.string(),
});

/** What a `connect_app` card asked for. */
const ConnectInputSchema = z.object({
  reason: z.string().optional(),
  slug: z.string(),
});

/** One line the fold holds: a line of work, at the depth it belongs. */
interface WorkLine {
  at: Date;
  /** 0 for the chat's own agent, 1 for a task of its. */
  depth: number;
  /** When the call it names ended, where the records say so; `at` otherwise. */
  endedAt: Date;
  /** Where in the records it is, so two at the same moment keep an order. */
  order: readonly [string, string];
  text: string;
}

/**
 * The chat's `CHAT.md`, or nothing for a record folder that names no
 * conversation of the chat's own, which is not yet a chat to read.
 */
export function renderChatMarkdown({
  chat,
  id,
  timeZone,
  topicNames,
}: ChatMarkdownInput): string | undefined {
  const own = ownSession(chat);
  if (!own) {
    return undefined;
  }
  const blocks: string[] = [
    frontMatter(own, timeZone, topicNames),
    `[Open this chat in ${APP_NAME}](${APP_NAME_SLUG}://chat/${id})`,
  ];
  const work = workLines(chat, own.id);
  let taken = 0;
  let day: string | undefined;
  /** Says the day of what comes next, where the file has not said it yet. */
  const onDay = (at: Date) => {
    const heading = dayHeading(at, timeZone);
    if (heading !== day) {
      day = heading;
      blocks.push(`## ${heading}`);
    }
  };
  /** The work done before `until`, as one fold, if any was. */
  const foldUpTo = (until: number | undefined) => {
    const held: WorkLine[] = [];
    while (taken < work.length) {
      const next = work[taken];
      if (!next || (until !== undefined && next.at.getTime() >= until)) {
        break;
      }
      held.push(next);
      taken += 1;
    }
    const first = held[0];
    if (!first) {
      return;
    }
    onDay(first.at);
    blocks.push(details(held));
  };
  for (const message of own.messages) {
    const said = visibleBlocks(message);
    if (said.length === 0) {
      continue;
    }
    // When the message was said rather than when its turn began: a reply
    // whose words land after three minutes of work is read after the fold
    // of that work, where the person saw it.
    const at = said[0]?.at ?? message.metadata.createdAt;
    foldUpTo(at.getTime());
    onDay(at);
    blocks.push(`### ${speaker(message)} at ${timeHeading(at, timeZone)}`);
    blocks.push(...said.map((block) => block.text));
  }
  foldUpTo(undefined);
  return `${blocks.join("\n\n")}\n`;
}

/** The title the chat's folder is named by, as its records hold it. */
export function chatTitleOf(chat: FoldedChat): string | undefined {
  const own = ownSession(chat);
  return own && sessionOf(own).title;
}

/** The chat's own conversation: the session of its records with no parent. */
function ownSession(chat: FoldedChat): FoldedSession | undefined {
  return chat.sessions.find((session) => session.parent === undefined);
}

/**
 * The file's front matter: what the chat is called, when it began, and the
 * topic it is filed under. Nothing lists its files, its pages or its apps,
 * which the folder beside it and the app already say.
 *
 * The chat's own id is the link in the first line of the body rather than a
 * key, so it is something to click as well as what ties a folder back to a
 * chat. Which also says what this file is: a render the app rewrites whole,
 * with no `id` of its own, where a draft or a topic carries one because the
 * app has to find it again after the person moves it.
 *
 * `title` is here so a Markdown viewer's properties panel and the file's
 * thumbnail name the conversation, and so the name survives the person
 * moving the folder. `topic` is singular: a chat is filed under one.
 */
function frontMatter(
  own: FoldedSession,
  timeZone: string,
  topicNames: ReadonlyMap<string, string> | undefined,
): string {
  const [topic] = (own.marks.topics?.value ?? []).flatMap((topicId) => {
    const name = topicNames?.get(topicId);
    return name === undefined ? [] : [name];
  });
  const title = sessionOf(own).title;
  return [
    "---",
    ...(title === undefined ? [] : [`title: ${yamlScalar(title)}`]),
    `created: ${localStamp(own.createdAt, timeZone)}`,
    ...(topic === undefined ? [] : [`topic: ${yamlScalar(topic)}`]),
    "---",
  ].join("\n");
}

/** Who the message is from, as the chat shows it. */
function speaker(message: SessionMessage.WithParts): string {
  return message.role === "user" ? "You" : APP_NAME;
}

/**
 * What the person sees of one message, in the order its parts are in, each
 * with when it was said.
 */
function visibleBlocks(
  message: SessionMessage.WithParts,
): { at: Date; text: string }[] {
  if (message.role !== "assistant" && message.role !== "user") {
    return [];
  }
  return message.parts.flatMap((part) => {
    if (!VISIBLE.has(part.type)) {
      return [];
    }
    const text = visibleBlock(part);
    return text === undefined || text === ""
      ? []
      : [{ at: partCreatedAt(part) ?? message.metadata.createdAt, text }];
  });
}

function visibleBlock(part: SessionMessagePart.Type): string | undefined {
  switch (part.type) {
    case "text": {
      return part.text.trim();
    }
    case "file": {
      return `${part.filename ?? "A file"} (${part.mediaType})`;
    }
    case "data-reply": {
      return part.data.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }
    case "data-attachments": {
      const sent = [
        ...part.data.files.map((file) => file.filename),
        ...(part.data.folders ?? []).map((folder) => folder.path),
      ];
      return sent.length === 0 ? undefined : `Sent: ${sent.join(", ")}`;
    }
    case "data-asks": {
      return part.data.asks
        .map(
          (ask) =>
            `- ${ask.file.name}, ${ask.target}: ${clipLine(ask.instruction, CLIP_LENGTH)}`,
        )
        .join("\n");
    }
    case "data-modelChange": {
      const { from, to } = part.data;
      return `Switched the model from ${from.name ?? from.modelId} to ${to.name ?? to.modelId}.`;
    }
    case "data-permissionAnswer": {
      const { answer, target } = part.data;
      switch (answer) {
        case "allowed": {
          return `You allowed ${target}.`;
        }
        case "always": {
          return `You allowed ${target} from now on.`;
        }
        case "declined": {
          return `You said no to ${target}.`;
        }
      }
    }
    case "data-questionAnswer": {
      const { answer } = part.data;
      const note =
        answer.note === undefined ? "" : ` You added: ${answer.note}`;
      return "declined" in answer
        ? `You skipped the question.${note}`
        : `You chose “${answer.selectedChoice}”.${note}`;
    }
    case "data-skillChanges": {
      const changed = [...part.data.created, ...part.data.updated];
      return changed.length === 0
        ? undefined
        : `Wrote the skill${changed.length === 1 ? "" : "s"} ${changed.join(", ")}.`;
    }
    case "data-taskEvent": {
      // A task's news shows in the chat where the person or the app stopped
      // it; the rest of what a task did is the fold's to say.
      const stopped = part.data.events.flatMap((event) =>
        event.stoppedBy === undefined
          ? []
          : [
              `${event.stoppedBy === "user" ? "You stopped" : "The app stopped"} the task ${event.title}.`,
            ],
      );
      return stopped.length === 0 ? undefined : stopped.join("\n");
    }
    default: {
      return isToolPart(part) ? card(part) : undefined;
    }
  }
}

/** A card the agent put in the chat, with what it asked. */
function card(part: SessionMessagePart.ToolPart): string | undefined {
  if (part.type === `tool-${TOOL_NAMES.choose}`) {
    const asked = ChooseInputSchema.safeParse(part.input);
    if (!asked.success) {
      return undefined;
    }
    return [
      `Asked: ${asked.data.question}`,
      ...(asked.data.choices ?? []).map((choice) => `- ${choice}`),
    ].join("\n");
  }
  const asked = ConnectInputSchema.safeParse(part.input);
  if (!asked.success) {
    return undefined;
  }
  const { reason, slug } = asked.data;
  return `Asked to connect ${slug}.${reason === undefined ? "" : ` ${reason}`}`;
}

/**
 * The work of a stretch, as one `<details>`: how long it ran in the summary,
 * and its lines in a `<pre>`, a task's indented under the chat's own.
 */
function details(held: WorkLine[]): string {
  const first = held[0];
  if (!first) {
    return "";
  }
  // To the end of the last call to finish rather than to when it was made: a
  // fold whose one call ran for two minutes took two minutes.
  const ended = Math.max(...held.map((line) => line.endedAt.getTime()));
  const body = held.flatMap((line) =>
    line.text
      .split("\n")
      .map((each) => escaped(`${" ".repeat(line.depth * 2)}${each}`)),
  );
  return [
    "<details>",
    `<summary>${worked(ended - first.at.getTime())}</summary>`,
    "<pre>",
    ...body,
    "</pre>",
    "</details>",
  ].join("\n");
}

/** How long the work took, in the words the summary line says it in. */
function worked(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 1
    ? "Worked for less than a minute"
    : `Worked for ${minutes.toString()} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Every line of work the chat's sessions hold, oldest first: its own agent's
 * reasoning and calls, and each of its tasks' at a depth of one. Ordered by
 * when each happened, and for two at the same moment by the session and the
 * part they are, so the order never comes from how the records were read.
 */
function workLines(chat: FoldedChat, own: StoreId.Session): WorkLine[] {
  const lines: WorkLine[] = [];
  for (const session of chat.sessions) {
    const depth = session.id === own ? 0 : 1;
    const handle = depth === 0 ? "" : `${session.handle ?? session.id} `;
    // The phase the calls so far belong to, per session: a call opens a new
    // one by naming an activity of its own.
    let activity: string | undefined;
    for (const message of session.messages) {
      if (message.role !== "assistant") {
        continue;
      }
      for (const part of message.parts) {
        const at = partCreatedAt(part) ?? message.metadata.createdAt;
        const endedAt = partEndedAt(part) ?? at;
        const order = [session.id, part.metadata.id] as const;
        if (part.type === "reasoning") {
          const text = part.text.trim();
          if (text !== "") {
            lines.push({
              at,
              depth,
              endedAt,
              order,
              text: `${handle}thinking: ${text.slice(0, CLIP_LENGTH)}`,
            });
          }
          continue;
        }
        if (!isToolPart(part) || VISIBLE.has(part.type)) {
          continue;
        }
        const named = callActivity(part);
        if (named !== undefined && named !== activity) {
          activity = named;
          lines.push({
            at,
            depth,
            endedAt: at,
            order,
            text: `${handle}${named}`,
          });
        }
        lines.push({
          at,
          depth,
          endedAt,
          order,
          text: `${handle}${toolCallLine(part)}`,
        });
      }
    }
  }
  return lines.toSorted(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      compare(a.order[0], b.order[0]) ||
      compare(a.order[1], b.order[1]),
  );
}

/** The day a moment falls on in the zone, as the heading says it. */
function dayHeading(at: Date, timeZone: string): string {
  const { day, month, year } = zoned(at, timeZone);
  const weekday =
    WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  return `${weekday}, ${MONTHS[month - 1] ?? ""} ${day.toString()}, ${year.toString()}`;
}

/** The time of day a moment falls at in the zone, as a heading says it. */
function timeHeading(at: Date, timeZone: string): string {
  const { hour, minute } = zoned(at, timeZone);
  const half = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve.toString()}:${minute.toString().padStart(2, "0")} ${half}`;
}

/**
 * The civil date and time a moment reads as in the zone, as numbers. Only
 * digits are taken from the system's own calendar data, and the names of the
 * days and the months are this file's, so what a heading says cannot change
 * under an updated copy of that data.
 */
function zoned(
  at: Date,
  timeZone: string,
): { day: number; hour: number; minute: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    month: read("month"),
    year: read("year"),
  };
}

/** A name as a YAML scalar, quoted where plain text would read as something else. */
function yamlScalar(value: string): string {
  return /^[\w ][\w ().-]*$/.test(value) && value.trim() === value
    ? value
    : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** A line of work as HTML text, so nothing in it is read as markup. */
function escaped(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
