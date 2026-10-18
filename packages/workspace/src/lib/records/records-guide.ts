import { type SessionMessage } from "../../schemas/session/message";
import { BLOBS_FOLDER_NAME } from "./blobs";
import { type LogRecord, type MarkField } from "./record";

/**
 * What the chat-history skill tells the agent of a chat's records, so it can
 * search and read them itself. Keyed by the record format's own types: a record, a message role
 * or a mark the format adds or drops fails the type check here until this
 * says what it is, so the agent is never told of a record that is not there.
 * The file names are checked against the parser in the test beside this.
 */

/** Every record a session's log holds, by its `t`. */
const LOG_RECORDS = {
  message:
    "a message, with its `role` and `id`; its words are in the `part` records that name it",
  part: "a piece of a message, which `part.metadata.messageId` names: `text` and `reasoning` hold words, `tool-<name>` a call with its `input` and `output`, `file` a file. The newest record of a part's id is the one that stands",
  retract: "the `messages` it names are no longer in the session",
  rollover: "the context window was reset after message `after`",
  session:
    "the log's first line: `parent` and `forkedAt` on a task, a session the chat started, whose history is its parent's up to `forkedAt`, then its own",
  state: "a standing fact the app keeps, `what` naming it",
  stopped: "the turn was stopped, `by` saying who stopped it",
} satisfies Record<LogRecord["t"], string>;

/** Every role a message record has. */
const MESSAGE_ROLES = {
  assistant: "you",
  "session-context":
    "what the app told you at the start, the same in every chat and no part of the conversation",
  system: "a note the app added for you",
  user: "the user",
} satisfies Record<SessionMessage.Type["role"], string>;

/** Every field a mark sets. */
const MARK_FIELDS = {
  archived: "whether it is archived",
  starred: "whether it is starred",
  stoppedAt: "when the user stopped its turn",
  title: "its title, in `value.text`",
  topic:
    "its topic id, the `id` in the topic's `TOPIC.md`, or `null` for none. An older `topics` mark lists ids, and its first is the topic",
  unread: "whether it is unread",
} satisfies Record<MarkField, string>;

/** The names the guide gives a chat's record files, checked by its test. */
export const RECORD_FILE_EXAMPLES = {
  log: "<session>.<device>.jsonl",
  marks: "marks.<device>.jsonl",
} as const;

/** Each entry as a bullet of its own, `depth` levels in. */
function listed(entries: Record<string, string>, depth: number): string[] {
  const indent = "  ".repeat(depth);
  return Object.entries(entries).map(
    ([name, meaning]) => `${indent}- \`${name}\`: ${meaning}`,
  );
}

/**
 * The chat-history skill's `records.md`: the files in a chat's records and
 * every record in them, held equal to this by its test.
 */
export function chatRecordsReference(): string {
  return [
    "# Chat records",
    "",
    "A chat's folder holds JSON Lines files, one record per line, with `t` naming the record.",
    "",
    `- \`${RECORD_FILE_EXAMPLES.log}\`: one session's log as one device wrote it (\`.2\` and on once it grew long). Its records, by \`t\`:`,
    ...listed(LOG_RECORDS, 1),
    "  A message's `role`:",
    ...listed(MESSAGE_ROLES, 2),
    `- \`${RECORD_FILE_EXAMPLES.marks}\`: \`mark\` records, the newest of each \`field\` standing:`,
    ...listed(MARK_FIELDS, 1),
    `- \`${BLOBS_FOLDER_NAME}/\`: bytes a tool returned, which its part names in a \`blob\` field (\`sha256-<hex>.<ext>\`).`,
    "",
  ].join("\n");
}
