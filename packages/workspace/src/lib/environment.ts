import { ok, safeTry } from "neverthrow";
import os from "node:os";

import {
  type Environment,
  type EnvironmentChange,
  EnvironmentSchema,
} from "../schemas/environment";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { ChatReads } from "./chat-reads";
import { chatOutputFolder, outputFolderPath } from "./chat/output-folder";
import { getCurrentDate } from "./get-current-date";
import { getSystemInfo } from "./get-system-info";
import { baselineRecorded, partsAfter } from "./last-told";
import { getWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";

/**
 * The computer this process runs on, as a session's model is told it.
 *
 * The output folder is worked out exactly as `$INSTRUMENT_OUTPUT` is
 * (`finishedWorkFolder`), so what the model reads and what its shell holds
 * are the same folder; a change to it between turns is told as any other
 * move of a folder is. Without a chat, as for the window, it is the
 * Instrument folder.
 */
export function currentEnvironment(chatId?: ChatId): Environment {
  return {
    appsFolder: shellPath(getWorkspaceConfig().appsDir),
    computer: getSystemInfo(),
    homeFolder: shellPath(os.homedir()),
    outputFolder: shellPath(
      chatId === undefined ? outputFolderPath() : chatOutputFolder(chatId),
    ),
    platform: process.platform,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    workspaceSkillsFolder: shellPath(getWorkspaceSkillsDir()),
  };
}

/** Each fact of `current` that differs from `told`, or undefined when none does. */
export function environmentChange(
  told: Environment,
  current: Environment,
): EnvironmentChange | undefined {
  const change: EnvironmentChange = {};
  for (const fact of EnvironmentSchema.keyof().options) {
    if (told[fact] !== current[fact]) {
      change[fact] = current[fact];
    }
  }
  return Object.keys(change).length > 0 ? change : undefined;
}

/**
 * What the session's model was last told about its computer: what its
 * baseline recorded, with each environment note written since laid over it
 * in order. Read from the session's history, so it is what the model saw,
 * whichever computer the chat was last used on. Undefined for a session with
 * no baseline yet, or one from before baselines recorded it.
 */
export function lastToldEnvironment(
  messages: SessionMessage.WithParts[],
  sessionId: StoreId.Session,
): Environment | undefined {
  const recorded = baselineRecorded(messages, sessionId, "environment");
  if (recorded === undefined) {
    return undefined;
  }
  return partsAfter(
    messages,
    ["data-environmentChange"],
    recorded.writtenAt,
  ).reduce<Environment>(
    (told, note) => ({ ...told, ...note.data }),
    recorded.value,
  );
}

/**
 * The note for the message being sent when the computer differs from what the
 * session was last told, or undefined when it does not. Never rewrites the
 * baseline: the note supersedes it, so the request in front of it stays
 * byte-stable and cached.
 */
export function detectEnvironmentChange({
  chatId,
  messageId,
  sessionId,
}: {
  chatId: ChatId;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}) {
  return safeTry<SessionMessagePart.Type | undefined, Error>(
    async function* () {
      const messages = yield* ChatReads.modelHistory({
        chatId,
        sessionId,
      });
      const told = lastToldEnvironment(messages, sessionId);
      const change =
        told === undefined
          ? undefined
          : environmentChange(told, currentEnvironment(chatId));
      if (change === undefined) {
        return ok(undefined);
      }
      return ok({
        data: change,
        metadata: {
          createdAt: getCurrentDate(),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        type: "data-environmentChange",
      } satisfies SessionMessagePart.Type);
    },
  );
}
