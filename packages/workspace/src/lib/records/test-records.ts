import { ChatIdSchema } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { DeviceIdSchema } from "./device-id";
import { RECORD_FORMAT, type LogRecord, type SessionHeader } from "./record";

/** Records with fixed ids and dates, for the records tests. */

export const CHAT = ChatIdSchema.parse("records-test");

export const DEVICE_A = DeviceIdSchema.parse("dev_AAAAAAAA");
export const DEVICE_B = DeviceIdSchema.parse("dev_BBBBBBBB");
export const DEVICE_C = DeviceIdSchema.parse("dev_CCCCCCCC");

const T0 = Date.parse("2026-10-14T12:00:00.000Z");

/** A moment `seconds` after the tests' fixed start. */
export function at(seconds: number): Date {
  return new Date(T0 + seconds * 1000);
}

/** A ULID whose order follows `n`. */
function ulid(n: number): string {
  return `01K7A${n.toString().padStart(21, "0")}`;
}

export function sessionId(n: number): StoreId.Session {
  return StoreId.SessionSchema.parse(`ses_${ulid(n)}`);
}

export function messageId(n: number): StoreId.Message {
  return StoreId.MessageSchema.parse(`msg_${ulid(n)}`);
}

export function partId(n: number): StoreId.Part {
  return StoreId.PartSchema.parse(`prt_${ulid(n)}`);
}

export function header(
  seq: number,
  fields: Partial<SessionHeader> & Pick<SessionHeader, "device" | "id">,
): SessionHeader {
  return {
    t: "session",
    seq,
    at: at(0),
    format: RECORD_FORMAT,
    chat: CHAT,
    createdAt: at(0),
    app: "0.0.0-test",
    ...fields,
  };
}

export function userMessage(
  session: StoreId.Session,
  id: StoreId.Message,
  createdAt: Date,
): SessionMessage.Type {
  return { id, metadata: { createdAt, sessionId: session }, role: "user" };
}

export function assistantMessage(
  session: StoreId.Session,
  id: StoreId.Message,
  createdAt: Date,
  more: Partial<SessionMessage.Assistant["metadata"]> = {},
): SessionMessage.Type {
  return {
    id,
    metadata: {
      createdAt,
      finishReason: "stop",
      modelId: "test-model",
      providerId: "test-provider",
      sessionId: session,
      ...more,
    },
    role: "assistant",
  };
}

export function textPart(
  session: StoreId.Session,
  message: StoreId.Message,
  id: StoreId.Part,
  text: string,
  createdAt: Date,
): SessionMessagePart.Type {
  return {
    metadata: { createdAt, id, messageId: message, sessionId: session },
    text,
    type: "text",
  };
}

/** A `bash` call, through the coercion the store reads tool parts with. */
export function toolPart({
  createdAt,
  id,
  message,
  more = {},
  session,
  state,
}: {
  createdAt: Date;
  id: StoreId.Part;
  message: StoreId.Message;
  more?: {
    endedAt?: Date;
    output?: unknown;
    preliminary?: boolean;
    startedAt?: Date;
  };
  session: StoreId.Session;
  state: "input-available" | "output-available";
}): SessionMessagePart.Type {
  const { output, preliminary, ...dates } = more;
  return SessionMessagePart.coerce({
    input: { command: "ls" },
    metadata: {
      createdAt,
      id,
      messageId: message,
      sessionId: session,
      ...dates,
    },
    ...(output === undefined ? {} : { output }),
    ...(preliminary === undefined ? {} : { preliminary }),
    state,
    toolCallId: `call-${id}`,
    type: "tool-bash",
  });
}

export function messageRecord(
  seq: number,
  message: SessionMessage.Type,
): LogRecord {
  return { t: "message", seq, at: message.metadata.createdAt, message };
}

export function partRecord(
  seq: number,
  part: SessionMessagePart.Type,
  when = part.metadata.createdAt,
): LogRecord {
  return { t: "part", seq, at: when, part };
}
