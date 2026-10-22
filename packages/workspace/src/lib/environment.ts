import {
  AIGatewayModelURI,
  imageParametersDescription,
} from "@instrument-org/ai-gateway";
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
 *
 * The image options are for the image model `runsOn` would pick among the
 * providers connected now: the chat's model, which every session of it runs
 * on. Switching models already starts a new cache, and connecting a
 * provider is told as a change.
 */
export async function currentEnvironment(
  chatId?: ChatId,
  runsOn?: AIGatewayModelURI.Type,
): Promise<Environment> {
  // Imported when asked: the shell's module reaches this one through the
  // commands that send a task a message.
  const { computerCommandsText } = await import("./create-bash-env");
  return {
    appsFolder: shellPath(getWorkspaceConfig().appsDir),
    commands: computerCommandsText(),
    computer: getSystemInfo(),
    homeFolder: shellPath(os.homedir()),
    imageOptions: imageOptionsFor(runsOn),
    outputFolder: shellPath(
      chatId === undefined ? outputFolderPath() : chatOutputFolder(chatId),
    ),
    platform: process.platform,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    workspaceSkillsFolder: shellPath(getWorkspaceSkillsDir()),
  };
}

/** What `generate_image` takes for the image model `runsOn` would pick. */
function imageOptionsFor(runsOn: AIGatewayModelURI.Type | undefined) {
  const parsed =
    runsOn === undefined ? undefined : AIGatewayModelURI.parse(runsOn);
  return imageParametersDescription({
    callingModel: {
      params: {
        providerConfigId: parsed?.ok
          ? parsed.value.params.providerConfigId
          : undefined,
      },
    },
    configs: getWorkspaceConfig().getAIProviderConfigs(),
  });
}

/**
 * Every output folder any session of the chat was told, in the shell's
 * spelling: its baselines' and each note's since. A chat's own folder moves
 * when its title settles, so a path the agent wrote into the folder as it
 * was told it then names the folder by a name it no longer has. Empty for a
 * chat whose records cannot be read.
 */
export async function toldOutputFolders(chatId: ChatId): Promise<Set<string>> {
  const told = new Set<string>();
  const sessions = await ChatReads.sessions({
    chatId,
    includeChildSessions: true,
  });
  if (sessions.isErr()) {
    return told;
  }
  for (const session of sessions.value) {
    const history = await ChatReads.history({
      chatId,
      sessionId: session.id,
    });
    if (history.isErr()) {
      continue;
    }
    for (const message of history.value) {
      if (message.role === "session-context") {
        const folder = message.metadata.environment?.outputFolder;
        if (folder !== undefined) {
          told.add(folder);
        }
      }
      for (const part of message.parts) {
        if (
          part.type === "data-environmentChange" &&
          part.data.outputFolder !== undefined
        ) {
          told.add(part.data.outputFolder);
        }
      }
    }
  }
  return told;
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
  runsOn,
  sessionId,
}: {
  chatId: ChatId;
  messageId: StoreId.Message;
  /** The model the chat runs on as of this message. */
  runsOn: AIGatewayModelURI.Type | undefined;
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
          : environmentChange(told, await currentEnvironment(chatId, runsOn));
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
