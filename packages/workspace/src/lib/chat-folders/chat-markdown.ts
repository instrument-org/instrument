import { APP_NAME, chatAddressOf } from "@instrument-org/shared";
import { stripDictatedMarks } from "@instrument-org/shared/dictated-text";
import { z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { TOOL_NAMES } from "../../tools/name";
import { clipLine, partCreatedAt, partEndedAt } from "../chat/call-label";
import { shownTitle } from "../chat/shown-title";
import { isToolPart } from "../is-tool-part";
import { type FoldedChat, type FoldedSession } from "../records/fold";
import { setupChangeSentence } from "../setup-change-sentence";
import { utcStamp } from "../utc-stamp";
import { sessionOf } from "../records/session-of";
import {
  inlineMarkdown,
  spokenDuration,
  workFoldFacts,
  workFoldStep,
} from "./work-fold";

/**
 * A chat's `CHAT.md`: its conversation as Markdown, for the person to read in
 * a file manager, a Markdown editor or their own search of the folder, and
 * for a chat's agent to read what another chat said without opening any
 * records.
 *
 * The same records render the same bytes, every time, on any computer. So
 * nothing here reads the clock, the process's time zone or a folder's
 * listing: every day and time is written in UTC, the front matter's as ISO
 * 8601 and the headings' as words with `UTC` after the time, and every list
 * is ordered by an id or by a time the records carry. A `Map` is only ever
 * asked for one key, never iterated.
 *
 * What the person sees in the chat stays visible: what they and the agent
 * said, what they sent, the cards they answered, a model switch. The work
 * between two visible messages folds into one `<details>` whose body is
 * Markdown, set off by blank lines so a reader that renders Markdown inside
 * HTML (GitHub, the app's own viewer and editor) draws it: each call's
 * command in a shell block, each thought as a quote.
 */

/** What a render is made from. */
export interface ChatMarkdownInput {
  /** The chat's records as they stand, its tasks' sessions included. */
  chat: FoldedChat;
  /** The chat, for the address that opens it in the app. */
  id: ChatId;
  /** The workspace, which the files the work touched are named from. */
  rootDir: string;
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
  "data-setupChanges",
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

/** One line the fold holds: a call, or a thought when there is no call. */
interface WorkLine {
  at: Date;
  /** The call the line is, for the summary to count; none for a thought. */
  call?: SessionMessagePart.ToolPart;
  /** The task's handle for a task's line; empty for the chat's own agent. */
  handle: string;
  /** When the call it names ended, where the records say so; `at` otherwise. */
  endedAt: Date;
  /** Where in the records it is, so two at the same moment keep an order. */
  order: readonly [string, string];
  /** A thought's words, or a call already written as the fold's Markdown. */
  text: string;
}

/**
 * The chat's `CHAT.md`, or nothing for a record folder that names no
 * conversation of the chat's own, which is not yet a chat to read.
 */
export function renderChatMarkdown({
  chat,
  id,
  rootDir,
}: ChatMarkdownInput): string | undefined {
  const own = ownSession(chat);
  if (!own) {
    return undefined;
  }
  const blocks: string[] = [
    frontMatter(own, id),
    // The file is rewritten from the records at the end of every turn.
    `[Open this chat in ${APP_NAME}](${chatAddressOf(id)}). This file is a copy of the chat that ${APP_NAME} keeps up to date, so changes you make here won't last.`,
  ];
  const work = workLines(chat, own.id, rootDir);
  let taken = 0;
  let day: string | undefined;
  /** Says the day of what comes next, where the file has not said it yet. */
  const onDay = (at: Date) => {
    const heading = dayHeading(at);
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
    blocks.push(`### ${speaker(message)} at ${timeHeading(at)}`);
    blocks.push(...said.map((block) => block.text));
  }
  foldUpTo(undefined);
  return `${blocks.join("\n\n")}\n`;
}

/** The title the chat's folder is named by, as the chat list shows it. */
export function chatTitleOf(chat: FoldedChat): string | undefined {
  const own = ownSession(chat);
  return own && titleOf(own);
}

/** The chat's title as the chat list shows it. */
function titleOf(own: FoldedSession): string {
  return shownTitle(
    sessionOf(own).title,
    own.messages.find((message) => message.role === "user"),
  );
}

/** The chat's own conversation: the session of its records with no parent. */
function ownSession(chat: FoldedChat): FoldedSession | undefined {
  return chat.sessions.find((session) => session.parent === undefined);
}

/**
 * The file's front matter: what the chat is called, which chat it is, when it
 * began, and the topic it is filed under. Nothing lists its files, its pages
 * or its apps, which the folder beside it and the app already say.
 *
 * `chat` is the chat's id, what ties a folder back to its chat, and the link
 * in the first line of the body says it again as something to click. It is
 * no `id`: this file is a render the app rewrites whole, where a draft or a
 * topic carries an `id` because the app has to find it again after the
 * person moves it.
 *
 * `title` is here so a Markdown viewer's properties panel and the file's
 * thumbnail name the conversation, and so the name survives the person
 * moving the folder. `topic` is singular: a chat is filed under one.
 */
function frontMatter(own: FoldedSession, id: ChatId): string {
  const topic = own.settings.topic?.value;
  return [
    "---",
    `title: ${yamlScalar(titleOf(own))}`,
    `chat: ${chatAddressOf(id)}`,
    `created: ${utcStamp(own.createdAt)}`,
    ...(topic ? [`topic: ${yamlScalar(topic)}`] : []),
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
      return stripDictatedMarks(part.text).trim();
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
    case "data-setupChanges": {
      return part.data.changes
        .map((change) => {
          const { after, before, label } = setupChangeSentence(change);
          return `${before}${label}${after}`;
        })
        .join("\n");
    }
    case "data-taskEvent": {
      // A task's news shows in the chat where the person or the app stopped
      // it; the rest of what a task did is the fold's to say.
      const stopped = part.data.events.flatMap((event) =>
        event.stoppedBy === undefined
          ? []
          : [
              `${event.stoppedBy === "person" ? "You stopped" : "The app stopped"} the task ${event.title}.`,
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
 * The work of a stretch, as one `<details>`: how long it ran and what it did
 * in the summary, and under it each step as Markdown: a call's label in bold
 * with how it ended, its command in a shell block and what it touched or why
 * it failed under that, and a thought as a quote. A task's steps carry its
 * handle in front.
 */
function details(held: WorkLine[]): string {
  const first = held[0];
  if (!first) {
    return "";
  }
  // To the end of the last call to finish rather than to when it was made: a
  // fold whose one call ran for two minutes took two minutes.
  const ended = Math.max(...held.map((line) => line.endedAt.getTime()));
  const summary = [
    `Worked for ${spokenDuration(ended - first.at.getTime())}`,
    ...workFoldFacts(held.flatMap((line) => (line.call ? [line.call] : []))),
  ].join(" · ");
  return [
    "<details>",
    `<summary>${escaped(summary)}</summary>`,
    "",
    ...held.map(step),
    "</details>",
  ].join("\n");
}

/** One line of work as the Markdown a fold shows it in, ending in a blank line. */
function step(line: WorkLine): string {
  if (line.call) {
    return `${line.text}\n`;
  }
  const quoted = inlineMarkdown(line.text)
    .split("\n")
    .map((each) => (each.trim() === "" ? ">" : `> ${each}`));
  const who = line.handle ? [`> **${inlineMarkdown(line.handle)}**`, ">"] : [];
  return [...who, ...quoted, ""].join("\n");
}

/**
 * Every line of work the chat's sessions hold, oldest first: its own agent's
 * reasoning and calls, and each of its tasks' under its handle. Ordered by
 * when each happened, and for two at the same moment by the session and the
 * part they are, so the order never comes from how the records were read.
 */
function workLines(
  chat: FoldedChat,
  own: StoreId.Session,
  rootDir: string,
): WorkLine[] {
  const lines: WorkLine[] = [];
  for (const session of chat.sessions) {
    const handle = session.id === own ? "" : (session.handle ?? session.id);
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
              endedAt,
              handle,
              order,
              text: text.slice(0, CLIP_LENGTH),
            });
          }
          continue;
        }
        if (!isToolPart(part) || VISIBLE.has(part.type)) {
          continue;
        }
        lines.push({
          at,
          call: part,
          endedAt,
          handle,
          order,
          text: workFoldStep(part, rootDir, handle),
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

/** The day a moment falls on in UTC, as the heading says it. */
function dayHeading(at: Date): string {
  const weekday = WEEKDAYS[at.getUTCDay()] ?? "";
  const month = MONTHS[at.getUTCMonth()] ?? "";
  return `${weekday}, ${month} ${at.getUTCDate().toString()}, ${at.getUTCFullYear().toString()}`;
}

/** The time of day a moment falls at in UTC, as a heading says it. */
function timeHeading(at: Date): string {
  const hour = at.getUTCHours();
  const minute = at.getUTCMinutes();
  const half = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve.toString()}:${minute.toString().padStart(2, "0")} ${half} UTC`;
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
