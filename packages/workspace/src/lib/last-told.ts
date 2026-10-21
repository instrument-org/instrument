import { alphabetical } from "radashi";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { baselineInForce } from "./session-baseline";

/**
 * What a session's model was last told of something that changes under the
 * chat is read from the session's history, never kept beside it: the
 * baseline records the picture it began with, and each note since carries
 * what it brought the model up to. A note is written with the message it
 * rides on or not at all, so the telling and the record of it cannot part.
 * A task reads its chat's history up to where it forked, so it starts from
 * what the chat had been told by then.
 */

type DataPartNamed<T extends SessionMessagePart.DataPart["type"]> = Extract<
  SessionMessagePart.DataPart,
  { type: T }
>;

/**
 * The session's baseline in force, from its history: its own once it wrote
 * one, else the one it inherited.
 */
function baselineIn(
  messages: SessionMessage.WithParts[],
  sessionId: StoreId.Session,
): SessionMessage.ContextWithParts[] {
  return baselineInForce(
    messages.filter(
      (message): message is SessionMessage.ContextWithParts =>
        message.role === "session-context",
    ),
    sessionId,
  );
}

/**
 * One value the baseline recorded on its metadata, with the id of its last
 * message, which every note that changed it since comes after. Undefined
 * where there is no baseline or it recorded none.
 */
export function baselineRecorded<
  K extends "apps" | "environment" | "folders" | "skills",
>(
  messages: SessionMessage.WithParts[],
  sessionId: StoreId.Session,
  key: K,
):
  | {
      value: NonNullable<SessionMessage.ContextWithParts["metadata"][K]>;
      writtenAt: StoreId.Message;
    }
  | undefined {
  const baseline = baselineIn(messages, sessionId);
  const value = baseline.find((message) => message.metadata[key] !== undefined)
    ?.metadata[key];
  const writtenAt = baseline.at(-1)?.id;
  return value === undefined || value === null || writtenAt === undefined
    ? undefined
    : { value, writtenAt };
}

/**
 * The history's parts of the given types, oldest first, from messages after
 * `after` when it is given. A note from before a baseline told what the
 * baseline already holds, so a reader measuring from one starts after it.
 */
export function partsAfter<T extends SessionMessagePart.DataPart["type"]>(
  messages: SessionMessage.WithParts[],
  types: readonly T[],
  after?: StoreId.Message,
): DataPartNamed<T>[] {
  const wanted = new Set<string>(types);
  return alphabetical(
    messages
      .filter((message) => after === undefined || message.id > after)
      .flatMap((message) => message.parts)
      .filter((part): part is DataPartNamed<T> => wanted.has(part.type)),
    (part) => part.metadata.id,
  );
}

/**
 * The last message before the session's newest rollover, from the mark the
 * rollover left on it: the model is sent nothing before it.
 */
export function rolledOverAfter(
  messages: SessionMessage.WithParts[],
  sessionId: StoreId.Session,
): StoreId.Message | undefined {
  return partsAfter(messages, ["data-contextRollover"])
    .filter((part) => part.metadata.sessionId === sessionId)
    .at(-1)?.metadata.messageId;
}
