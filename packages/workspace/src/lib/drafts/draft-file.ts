import {
  chatAddressOf,
  chatIdNamedBy,
  splitFrontMatter,
} from "@instrument-org/shared";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { isRecord } from "../skills";
import { utcStamp } from "../utc-stamp";
import { pastedPathOf } from "./context-line";

/**
 * A draft as its file holds it: `DRAFT.md`, plain YAML front matter over the
 * person's own words.
 *
 * The words are the body, byte for byte as they typed them, so a draft opened
 * in a text editor reads as what it is and an edit there is the draft. The
 * front matter holds what the app and another device have to agree on, and
 * nothing a reader of the file would have to decode.
 *
 * A draft is its `id`, never its folder or its file name: a folder is named
 * for the day the draft was started (a name from its words would rename
 * itself while someone typed), and two files in one folder are two drafts.
 * Every key but `id` is optional, and a file named as a draft is that has no
 * `id` is given one when it is read, so a draft written by hand is a draft.
 */

/** The keys this build writes, and so the ones that are nobody else's. */
const OWN_KEYS = new Set([
  "asks",
  "chat",
  "context",
  "created",
  "id",
  "send",
  "sending",
  "sent",
  "project",
  // What builds that called a project a topic wrote for `project`.
  "topic",
  "updated",
]);

/**
 * A place in a file the person marked and moved into the draft, which goes
 * with the message: the file, written as a `context` line is
 * (`context-line.ts`), where in it, what is there, and what they typed.
 */
interface DraftFileAsk {
  /** What the app knows about the place that its text alone does not say. */
  context?: string;
  excerpt?: string;
  file: string;
  instruction: string;
  /** Where in the file, as a reader says it: "lines 12-14", "page 3". */
  target: string;
}

export interface DraftFile {
  /** The places marked in files that go with the message, in the order they were marked. */
  asks?: DraftFileAsk[];
  /** The chat a reply goes into, by its id. Absent on a draft that opens a chat of its own. */
  chat?: string;
  /**
   * What from outside the draft's folder goes with the message besides the
   * words, one line each, as the file writes them (`context-line.ts`).
   * Everything in the folder goes too, without a line. Filled as the draft
   * is made and changed only by the person, so a line left out stays out.
   */
  context?: string[];
  /** When the draft was started, which its folder is named for. */
  created: Date;
  id: string;
  /**
   * Front matter this build does not write, kept as it was found. A draft is
   * a file two programs write: the phone, a newer build, or the person with
   * an editor. Dropping a key on the way through would lose their work
   * silently, so what comes in unrecognized goes back out.
   */
  others?: Record<string, unknown>;
  /**
   * The device asked to send the reply as soon as it has it, by its id: what
   * a phone's Send writes, naming the computer that last worked in the chat,
   * since the phone cannot send it itself. Naming one device keeps two
   * computers from both sending it. Written by the asking device only.
   */
  send?: string;
  /**
   * The chat the draft is on its way into, by its id, from the press until
   * the message naming it is written: what a launch after a crash looks in
   * for that message, and what tells another device the draft is not
   * waiting. A draft found with it at a launch whose chat holds no such
   * message was never sent, and is the person's again as the kind of draft
   * it was.
   */
  sending?: string;
  /**
   * The message the draft was sent as, by its id, once it is written and
   * until the turn it started ends with it still in the chat: beside
   * `sending`, which still names the chat, so a device or build that reads
   * only `sending` leaves the draft alone too. A Stop that takes the message
   * back before any answer clears both, and the draft is the person's again.
   */
  sent?: string;
  /** The project the chat it opens is filed under, by the project's id; written only when the person picked one. */
  project?: string;
  /** When it last changed, which is what puts the newest reply draft in the box. */
  updated: Date;
  /** The person's words, exactly as they typed them. */
  words: string;
}

/** Whether a file in a draft folder is a draft; see {@link DRAFT_FILE_NAME}. */
export function isDraftFileName(name: string): boolean {
  return name.startsWith("DRAFT") && name.endsWith(".md");
}

/**
 * A draft from the bytes of its file, or nothing where the file cannot be
 * read as one: an empty file, or front matter that never closes or is not
 * YAML.
 *
 * A file whose front matter names no `id`, or that has no front matter at
 * all, is a draft someone wrote by hand. It is read under `newId`, which the
 * caller writes back; without one, it is no draft.
 *
 * `at` is when the file was last written, which stands in for a date the
 * front matter does not hold. The stamps the front matter does hold win over
 * it, so that reading a draft back gives what was written rather than
 * something the writing itself moved.
 */
export function parseDraftFile(
  text: string,
  { at, newId }: { at: Date; newId?: string },
): DraftFile | undefined {
  const split = splitFrontMatter(text);
  // An empty file is an editor partway through a save, or a placeholder a
  // sync engine has yet to fill, rather than a draft with nothing in it.
  if (!split.ok && (split.reason === "unterminated" || text.trim() === "")) {
    return undefined;
  }
  let parsed: unknown = {};
  if (split.ok) {
    try {
      parsed = parseYaml(split.block) as unknown;
    } catch {
      return undefined;
    }
  }
  const front = isRecord(parsed) ? parsed : {};
  const id = (typeof front.id === "string" ? front.id.trim() : "") || newId;
  if (!id) {
    return undefined;
  }
  const created = dateOf(front.created) ?? at;
  const updated = dateOf(front.updated);
  const others = Object.fromEntries(
    Object.entries(front).filter(([key]) => !OWN_KEYS.has(key)),
  );
  const chat = chatOf(front.chat);
  const sending = chatOf(front.sending);
  const send = typeof front.send === "string" ? front.send.trim() : "";
  const sent = typeof front.sent === "string" ? front.sent.trim() : "";
  const context = linesOf(front.context);
  const asks = asksOf(front.asks);
  const body = split.body.replaceAll("\r\n", "\n");
  return {
    ...(asks === undefined ? {} : { asks }),
    ...(chat === undefined ? {} : { chat }),
    ...(context === undefined ? {} : { context }),
    created,
    id,
    ...(Object.keys(others).length > 0 ? { others } : {}),
    ...(send === "" ? {} : { send }),
    ...(sending === undefined ? {} : { sending }),
    ...(sent === "" ? {} : { sent }),
    ...(projectOf(front) === undefined ? {} : { project: projectOf(front) }),
    updated: updated ?? at,
    words: split.ok ? bodyWords(body) : body.replace(/\n$/, ""),
  };
}

/**
 * The file: the front matter, then the words. Written whole every time, so
 * the file is only ever one draft's worth of bytes rather than something
 * patched in place.
 *
 * Strings a person types or a program names are written as JSON, which YAML
 * reads back as a quoted scalar, so a path or a project holding a colon, a `#`
 * or a quote round-trips. A chat's address is written as it is.
 */
export function renderDraftFile(draft: DraftFile): string {
  const lines = ["---", `id: ${JSON.stringify(draft.id)}`];
  lines.push(`created: ${utcStamp(draft.created)}`);
  lines.push(`updated: ${utcStamp(draft.updated)}`);
  if (draft.chat !== undefined) {
    lines.push(`chat: ${chatAddressOf(draft.chat)}`);
  }
  if (draft.send !== undefined) {
    lines.push(`send: ${JSON.stringify(draft.send)}`);
  }
  if (draft.sending !== undefined) {
    lines.push(`sending: ${chatAddressOf(draft.sending)}`);
  }
  if (draft.sent !== undefined) {
    lines.push(`sent: ${JSON.stringify(draft.sent)}`);
  }
  if (draft.project !== undefined) {
    lines.push(`project: ${JSON.stringify(draft.project)}`);
  }
  if (draft.context && draft.context.length > 0) {
    lines.push("context:");
    for (const line of draft.context) {
      lines.push(`  - ${JSON.stringify(line)}`);
    }
  }
  if (draft.asks && draft.asks.length > 0) {
    lines.push("asks:");
    for (const ask of draft.asks) {
      lines.push(`  - file: ${JSON.stringify(ask.file)}`);
      lines.push(`    target: ${JSON.stringify(ask.target)}`);
      if (ask.excerpt !== undefined) {
        lines.push(`    excerpt: ${JSON.stringify(ask.excerpt)}`);
      }
      lines.push(`    instruction: ${JSON.stringify(ask.instruction)}`);
      if (ask.context !== undefined) {
        lines.push(`    context: ${JSON.stringify(ask.context)}`);
      }
    }
  }
  // Last, and in a fixed order, so a key this build does not know keeps its
  // value and its shape without moving the keys above it from one save to
  // the next.
  if (draft.others && Object.keys(draft.others).length > 0) {
    lines.push(stringifyYaml(draft.others, { sortMapEntries: true }).trimEnd());
  }
  lines.push("---", "", `${draft.words}\n`);
  return lines.join("\n");
}

/**
 * Whether the draft holds nothing: no words, no ask, and nothing pasted
 * into it. One like that is deleted rather than kept, so a draft opened and
 * closed again leaves nothing behind, whatever it was opened over.
 */
export function isEmptyDraft(draft: DraftFile): boolean {
  return (
    draft.words.trim() === "" &&
    (draft.asks ?? []).length === 0 &&
    !(draft.context ?? []).some((line) => pastedPathOf(line) !== undefined)
  );
}

/**
 * The words under the front matter. The renderer writes one blank line under
 * the closing fence, the words and a closing newline, so exactly those two
 * are taken off again and anything the person typed is left alone.
 */
function bodyWords(body: string): string {
  const afterBlank = body.startsWith("\n") ? body.slice(1) : body;
  return afterBlank.endsWith("\n") ? afterBlank.slice(0, -1) : afterBlank;
}

/** The chat a key names, by its address or its bare id. */
function chatOf(value: unknown): string | undefined {
  return typeof value === "string" ? chatIdNamedBy(value) : undefined;
}

/** An `asks` list: each entry naming a file and where in it, in order. */
function asksOf(value: unknown): DraftFileAsk[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const textOf = (field: unknown) =>
    typeof field === "string" && field.trim() !== "" ? field : undefined;
  const asks = value.flatMap((entry: unknown): DraftFileAsk[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const file = textOf(entry.file)?.trim();
    const target = textOf(entry.target);
    if (file === undefined || target === undefined) {
      return [];
    }
    const context = textOf(entry.context);
    const excerpt = textOf(entry.excerpt);
    return [
      {
        ...(context === undefined ? {} : { context }),
        ...(excerpt === undefined ? {} : { excerpt }),
        file,
        instruction: textOf(entry.instruction) ?? "",
        target,
      },
    ];
  });
  return asks.length > 0 ? asks : undefined;
}

/** A `context` list's lines: each one that is text, in order. */
function linesOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const lines = value.flatMap((entry: unknown) =>
    typeof entry === "string" && entry.trim() !== "" ? [entry.trim()] : [],
  );
  return lines.length > 0 ? lines : undefined;
}

function dateOf(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(Date.parse(value));
  }
  return undefined;
}

/** The project a draft opens its chat under, under either name a build wrote it by. */
function projectOf(front: Record<string, unknown>): string | undefined {
  const project = front.project ?? front.topic;
  return typeof project === "string" && project ? project : undefined;
}
