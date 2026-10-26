import { type Session } from "../../schemas/session";
import { type SessionMessage } from "../../schemas/session/message";
import { SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { TOOL_NAMES } from "../../tools/name";
import { contextRolloverBoundaryInForce } from "../apply-context-rollover";
import { isToolPart } from "../is-tool-part";
import { type ChatRead } from "./chat-records";
import { historyOf } from "./fold";
import { type LoadBlob, partFromRecord } from "./part-blobs";
import { sessionOf } from "./session-of";

/**
 * The reads a chat is drawn and sent from, each made from one `ChatRead`:
 *
 * - list: every session of the chat, in the shape the list reads.
 * - conversation: what the chat view draws for everyone.
 * - steps: the rest of the transcript, for developer mode and the task
 *   page's tool rows. Merged with the conversation by part id
 *   (`mergeViews`), the two are the whole transcript.
 * - live: what the running turn holds in memory and never writes.
 * - model history: the transcript the model is sent, with the bytes its
 *   calls returned read back from their blobs.
 * - search: who said what, in words.
 *
 * A task's history starts with its parent's messages up to where it forked,
 * unless a view is asked for the session's own alone.
 */

/** What a view of a session reads. */
interface HistoryOptions {
  /** Whether a task's history starts with its parent's messages. */
  inherited?: boolean;
  /** Only these messages, for a reader following a change to them. */
  only?: ReadonlySet<StoreId.Message>;
}

/** Parts the chat view draws for everyone, by type. */
const CONVERSATION_PARTS = new Set<string>([
  "data-asks",
  "data-attachments",
  "data-fileChanges",
  "data-folderChanges",
  "data-fromChat",
  "data-maxSteps",
  "data-modelChange",
  "data-permissionAnswer",
  "data-reply",
  "data-setupChanges",
  "data-viewContext",
  "text",
  `tool-${TOOL_NAMES.choose}`,
  `tool-${TOOL_NAMES.connectApp}`,
]);

/** How many bytes of blobs the steps view keeps read, across chats. */
const INFLATED_BYTES = 32 * 1024 * 1024;

/** Blobs read for the steps view, oldest read first; a name is its bytes' hash. */
const inflatedBlobs = new Map<string, Uint8Array>();

/** Every session of the chat as the list and its callers read a session. */
export function listView(read: ChatRead): Session.Type[] {
  return read.chat.sessions.map(sessionOf);
}

/**
 * The ids of the session's messages, oldest first: what a reader that only
 * places a message among the others needs, without reading any of them.
 */
export function messageIdsView(
  read: ChatRead,
  sessionId: StoreId.Session,
  options: HistoryOptions = {},
): StoreId.Message[] {
  return messagesOf(read, sessionId, options).map((message) => message.id);
}

/**
 * What the chat view draws for everyone: user and assistant messages, each
 * with the parts that show in the conversation.
 */
export function conversationView(
  read: ChatRead,
  sessionId: StoreId.Session,
  options: HistoryOptions = {},
): SessionMessage.WithParts[] {
  return messagesOf(read, sessionId, options).flatMap((message) =>
    isConversational(message)
      ? [
          {
            ...message,
            parts: message.parts.filter((part) =>
              inConversation(message, part),
            ),
          },
        ]
      : [],
  );
}

/**
 * Every part the conversation leaves out, in order: tool calls, reasoning,
 * the session's context and the data parts only developer mode shows. A
 * call's returned bytes are read back from their blob, unless the reader
 * says it is not showing them (`bytes: false`), which spends no read on one.
 */
export async function stepsView(
  read: ChatRead,
  sessionId: StoreId.Session,
  { bytes = true, ...options }: HistoryOptions & { bytes?: boolean } = {},
): Promise<SessionMessage.WithParts[]> {
  const load = cachedLoad(read.load);
  const steps: SessionMessage.WithParts[] = [];
  for (const message of messagesOf(read, sessionId, options)) {
    const parts = message.parts.filter(
      (part) => !inConversation(message, part),
    );
    if (parts.length === 0 && isConversational(message)) {
      continue;
    }
    steps.push({
      ...message,
      parts: bytes
        ? await Promise.all(parts.map((part) => inflated(part, load)))
        : parts,
    });
  }
  return steps;
}

/**
 * The session's running turn as it stands in memory: the reply under way,
 * with only the parts it holds that are not written yet. Merged after the
 * conversation and steps, they stand over what was written.
 */
export function liveView(
  read: ChatRead,
  sessionId: StoreId.Session,
  { only }: Pick<HistoryOptions, "only"> = {},
): SessionMessage.WithParts[] {
  const turn = read.live.get(sessionId);
  if (!turn) {
    return [];
  }
  const written = new Map(
    (
      read.chat.sessions.find((session) => session.id === sessionId)
        ?.messages ?? []
    ).map((message) => [message.id, message]),
  );
  const ids = new Set(
    [
      ...(turn.message ? [turn.message.id] : []),
      ...[...turn.parts.values()].map((part) => part.metadata.messageId),
    ].filter((id) => !only || only.has(id)),
  );
  return [...ids].toSorted(byId).flatMap((id) => {
    const message = turn.message?.id === id ? turn.message : written.get(id);
    if (!message) {
      return [];
    }
    const parts = [...turn.parts.values()]
      .filter((part) => part.metadata.messageId === id)
      .toSorted((a, b) => byId(a.metadata.id, b.metadata.id));
    // The running request goes on writing into the metadata it handed over
    // (how it ended, its usage), so a reader gets a copy: one that held on to
    // the request's own object would find it already changed when compared
    // with the next read, and see no change at all.
    return [{ ...structuredClone(message), parts }];
  });
}

/**
 * Views of one session as one transcript: messages by id, each with the
 * parts every view gave it by part id, a later view's part and message
 * standing over an earlier one's.
 */
export function mergeViews(
  ...views: SessionMessage.WithParts[][]
): SessionMessage.WithParts[] {
  const merged = new Map<string, SessionMessage.WithParts>();
  for (const message of views.flat()) {
    const earlier = merged.get(message.id);
    if (!earlier) {
      merged.set(message.id, message);
      continue;
    }
    const parts = new Map(
      earlier.parts.map((part) => [part.metadata.id, part]),
    );
    for (const part of message.parts) {
      parts.set(part.metadata.id, part);
    }
    merged.set(message.id, {
      ...message,
      parts: [...parts.values()].toSorted((a, b) =>
        byId(a.metadata.id, b.metadata.id),
      ),
    });
  }
  return [...merged.values()].toSorted((a, b) => byId(a.id, b.id));
}

/**
 * The session's whole history, for the model request to be built from:
 * every message, with the bytes its calls returned read back from their
 * blobs in the messages the model is sent, those after the rollover that
 * holds for `model` as the session recorded it. The messages before it keep their
 * blob references, since past a rollover only the person's words are sent.
 * A blob that is gone leaves its call an error saying so.
 *
 * `inherited: false` reads the session's own messages alone, for a reader
 * that is looking at one run rather than at the whole request.
 */
export async function modelHistoryView(
  read: ChatRead,
  sessionId: StoreId.Session,
  { inherited, model }: HistoryOptions & { model?: string } = {},
): Promise<SessionMessage.WithParts[]> {
  const session = read.chat.sessions.find(({ id }) => id === sessionId);
  const messages = messagesOf(read, sessionId, { inherited });
  const boundary = contextRolloverBoundaryInForce({
    model,
    rolledOverAfterMessageId: session?.rollover?.after,
    rolloverWindows: session?.rollover?.windows,
  });
  // A boundary the history does not hold sends everything, as the request's own reading of it does.
  const sentFrom = messages.findIndex((message) => message.id === boundary) + 1;
  return Promise.all(
    messages.map(async (message, index) => ({
      ...message,
      parts:
        index < sentFrom
          ? message.parts
          : await Promise.all(
              message.parts.map((part) => inflated(part, read.load)),
            ),
    })),
  );
}

/**
 * The session's history as it is stored, oldest first: a task's carries its
 * chat's messages up to where it forked. No blob is read back and no
 * rollover applies, for a reader looking for what the session was told.
 */
export function historyView(
  read: ChatRead,
  sessionId: StoreId.Session,
): SessionMessage.WithParts[] {
  return messagesOf(read, sessionId, {});
}

/**
 * Every message of the session with every part it holds, oldest first, each
 * call's returned bytes read back from its blob: what a transcript saved or
 * copied out of the chat carries, where the conversation and the steps each
 * carry a side of it. No context rollover applies, since a transcript is the
 * whole session rather than a request built from it.
 */
export async function everyMessageView(
  read: ChatRead,
  sessionId: StoreId.Session,
  options: HistoryOptions = {},
): Promise<SessionMessage.WithParts[]> {
  const load = cachedLoad(read.load);
  return Promise.all(
    messagesOf(read, sessionId, options).map(async (message) => ({
      ...message,
      parts: await Promise.all(
        message.parts.map((part) => inflated(part, load)),
      ),
    })),
  );
}

/**
 * What the session's context meter shows: the input tokens the last reply
 * that reported any was built from. Zero where no reply has reported one.
 */
/** The hosts the session's own browser has been on, oldest first. */
export function sitesView(
  read: ChatRead,
  sessionId: StoreId.Session,
): string[] {
  return read.chat.sessions.find(({ id }) => id === sessionId)?.sites ?? [];
}

export function contextTokensView(
  read: ChatRead,
  sessionId: StoreId.Session,
): number {
  return inputTokensIn(messagesOf(read, sessionId, {}));
}

function inputTokensIn(messages: SessionMessage.Type[]): number {
  const reported = messages.findLast(
    (message) =>
      message.role === "assistant" &&
      Number.isFinite(message.metadata.usage?.inputTokens) &&
      (message.metadata.usage?.inputTokens ?? 0) > 0,
  );
  return reported?.role === "assistant"
    ? (reported.metadata.usage?.inputTokens ?? 0)
    : 0;
}

function messagesOf(
  read: ChatRead,
  sessionId: StoreId.Session,
  { inherited = true, only }: HistoryOptions,
): SessionMessage.WithParts[] {
  const messages = inherited
    ? historyOf(read.chat, sessionId)
    : (read.chat.sessions.find(({ id }) => id === sessionId)?.messages ?? []);
  return only ? messages.filter((message) => only.has(message.id)) : messages;
}

function isConversational(message: SessionMessage.Type): boolean {
  return message.role === "user" || message.role === "assistant";
}

function inConversation(
  message: SessionMessage.Type,
  part: SessionMessagePart.Type,
): boolean {
  if (!isConversational(message)) {
    return false;
  }
  // A task's news shows when the person or the app stopped it; the rest is
  // the chat's to read.
  if (part.type === "data-taskEvent") {
    return part.data.events.some((event) => event.stoppedBy !== undefined);
  }
  return CONVERSATION_PARTS.has(part.type);
}

/**
 * A call's output with its blobs read back into `base64Data`, or, for a
 * blob that is gone, the call as an error that says so.
 */
async function inflated(
  part: SessionMessagePart.Type,
  load: LoadBlob,
): Promise<SessionMessagePart.Type> {
  try {
    return await partFromRecord(part, load);
  } catch (error) {
    if (!isToolPart(part) || !isMissing(error)) {
      throw error;
    }
    return SessionMessagePart.coerce({
      ...part,
      errorText:
        "The file this call returned is no longer in the chat's records.",
      state: "output-error",
    });
  }
}

/** Reads blobs through a cache shared by every chat's steps, under a byte budget. */
function cachedLoad(load: LoadBlob): LoadBlob {
  return async (name) => {
    const cached = inflatedBlobs.get(name);
    if (cached) {
      inflatedBlobs.delete(name);
      inflatedBlobs.set(name, cached);
      return cached;
    }
    const bytes = await load(name);
    inflatedBlobs.set(name, bytes);
    let total = 0;
    for (const kept of inflatedBlobs.values()) {
      total += kept.length;
    }
    for (const [oldest, kept] of inflatedBlobs) {
      if (total <= INFLATED_BYTES || oldest === name) {
        break;
      }
      inflatedBlobs.delete(oldest);
      total -= kept.length;
    }
    return bytes;
  };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function byId(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
