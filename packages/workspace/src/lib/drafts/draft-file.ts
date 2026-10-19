import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { isRecord, splitFrontmatter } from "../skills";

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
 */

/**
 * Something a draft was given that has a place on disk. The original is
 * opened to the chat where it lies, so `path` is absolute for a file or
 * folder the person attached; it is relative to the draft's own folder for
 * what they pasted in with no file behind it, which is written beside the
 * draft and moves with it.
 */
export interface DraftAttached {
  kind: "file" | "folder";
  mediaType?: string;
  name?: string;
  path: string;
  size?: number;
}

/** The keys this build writes, and so the ones that are nobody else's. */
const OWN_KEYS = new Set([
  "attached",
  "chat",
  "created",
  "id",
  "send",
  "sendOn",
  "sending",
  "state",
  "topic",
  "updated",
]);

export interface DraftFile {
  /** What the draft was given, each by its path; see {@link DraftAttached}. */
  attached?: DraftAttached[];
  /** The chat a reply goes into. Absent on a draft that opens a chat of its own. */
  chat?: string;
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
   * `auto` means a computer running Instrument sends this draft as soon as it
   * sees it, and `sendOn` names the one computer that may. Reserved: no build
   * sends a draft on its own yet, and a draft without the field is only ever
   * sent by the person.
   */
  send?: "auto";
  /** The one device that sends a `send: auto` draft; see {@link DraftFile.send}. */
  sendOn?: string;
  /**
   * The chat the draft is on its way into, from the press until the message
   * naming it is written: what a launch after a crash looks in for that
   * message, and what tells another device the draft is not waiting. A
   * draft found with it at a launch whose chat holds no such message was
   * never sent, and is the person's again as the kind of draft it was.
   */
  sending?: string;
  /** What the app keeps about the draft besides the above: the window's own bookkeeping. */
  state?: Record<string, unknown>;
  /** The topic the chat it opens is filed under. */
  topic?: string;
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
 * A draft from the bytes of its file, or nothing where the file names no
 * draft: one with no front matter at all, or none holding an `id`, is
 * something else the person left in the folder.
 *
 * `at` is when the file was last written, which stands in for a date the
 * front matter does not hold. The stamps the front matter does hold win over
 * it, so that reading a draft back gives what was written rather than
 * something the writing itself moved.
 */
export function parseDraftFile(
  text: string,
  { at }: { at: Date },
): DraftFile | undefined {
  const split = splitFrontmatter(text);
  if (!split.ok) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(split.block) as unknown;
  } catch {
    return undefined;
  }
  const front = isRecord(parsed) ? parsed : {};
  const id = typeof front.id === "string" ? front.id.trim() : "";
  if (!id) {
    return undefined;
  }
  const created = dateOf(front.created) ?? at;
  const updated = dateOf(front.updated);
  const others = Object.fromEntries(
    Object.entries(front).filter(([key]) => !OWN_KEYS.has(key)),
  );
  return {
    ...(attachedOf(front.attached)
      ? { attached: attachedOf(front.attached) }
      : {}),
    ...(typeof front.chat === "string" && front.chat
      ? { chat: front.chat }
      : {}),
    created,
    id,
    ...(Object.keys(others).length > 0 ? { others } : {}),
    ...(front.send === "auto" ? { send: "auto" as const } : {}),
    ...(typeof front.sendOn === "string" && front.sendOn
      ? { sendOn: front.sendOn }
      : {}),
    ...(typeof front.sending === "string" && front.sending
      ? { sending: front.sending }
      : {}),
    ...(isRecord(front.state) ? { state: front.state } : {}),
    ...(typeof front.topic === "string" && front.topic
      ? { topic: front.topic }
      : {}),
    updated: updated ?? at,
    words: bodyWords(split.body),
  };
}

/**
 * The file: the front matter, then the words. Written whole every time, so
 * the file is only ever one draft's worth of bytes rather than something
 * patched in place.
 *
 * Strings are written as JSON, which YAML reads back as a quoted scalar, so
 * a path or a topic holding a colon, a `#` or a quote round-trips.
 */
export function renderDraftFile(draft: DraftFile): string {
  const lines = ["---", `id: ${JSON.stringify(draft.id)}`];
  lines.push(`created: ${draft.created.toISOString()}`);
  lines.push(`updated: ${draft.updated.toISOString()}`);
  if (draft.chat !== undefined) {
    lines.push(`chat: ${JSON.stringify(draft.chat)}`);
  }
  if (draft.topic !== undefined) {
    lines.push(`topic: ${JSON.stringify(draft.topic)}`);
  }
  if (draft.send !== undefined) {
    lines.push(`send: ${draft.send}`);
  }
  if (draft.sendOn !== undefined) {
    lines.push(`sendOn: ${JSON.stringify(draft.sendOn)}`);
  }
  if (draft.sending !== undefined) {
    lines.push(`sending: ${JSON.stringify(draft.sending)}`);
  }
  if (draft.attached && draft.attached.length > 0) {
    lines.push("attached:");
    for (const item of draft.attached) {
      lines.push(`  - path: ${JSON.stringify(item.path)}`);
      lines.push(`    kind: ${item.kind}`);
      if (item.name !== undefined) {
        lines.push(`    name: ${JSON.stringify(item.name)}`);
      }
      if (item.mediaType !== undefined) {
        lines.push(`    mediaType: ${JSON.stringify(item.mediaType)}`);
      }
      if (item.size !== undefined) {
        lines.push(`    size: ${item.size.toString()}`);
      }
    }
  }
  if (draft.state && Object.keys(draft.state).length > 0) {
    lines.push(`state: ${JSON.stringify(draft.state)}`);
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
 * Whether the draft holds nothing: no words, nothing pasted into it and
 * nothing attached. One like that is deleted rather than kept, so a draft
 * opened and closed again leaves nothing behind.
 */
export function isEmptyDraft(draft: DraftFile): boolean {
  return draft.words.trim() === "" && (draft.attached ?? []).length === 0;
}

/**
 * The words under the front matter. The renderer writes the closing fence,
 * one blank line, the words and a closing newline, so exactly those three
 * are taken off again and anything the person typed is left alone.
 */
function bodyWords(body: string): string {
  const afterFence = body.startsWith("\n") ? body.slice(1) : body;
  const afterBlank = afterFence.startsWith("\n")
    ? afterFence.slice(1)
    : afterFence;
  return afterBlank.endsWith("\n") ? afterBlank.slice(0, -1) : afterBlank;
}

function attachedOf(value: unknown): DraftAttached[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.path !== "string" || !entry.path) {
      return [];
    }
    return [
      {
        kind: entry.kind === "folder" ? ("folder" as const) : ("file" as const),
        ...(typeof entry.mediaType === "string"
          ? { mediaType: entry.mediaType }
          : {}),
        ...(typeof entry.name === "string" ? { name: entry.name } : {}),
        path: entry.path,
        ...(typeof entry.size === "number" ? { size: entry.size } : {}),
      },
    ];
  });
  return items.length > 0 ? items : undefined;
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
