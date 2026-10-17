import { ok, Result, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { type ChatDir } from "../schemas/paths";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { type ChatSettingsUpdate } from "../schemas/chat-settings";
import { type WorkspaceConfig } from "../types";
import { createSession } from "./create-session";
import { TypedError } from "./errors";
import { getCurrentDate } from "./get-current-date";
import { forgetChat, placeChat } from "./record-folders";
import { updateChatSettings } from "./chat-settings";

type InitialSettings = Omit<
  ChatSettingsUpdate,
  "chatSessionId" | "createdWithAppVersion"
>;

/**
 * Makes a chat's record folder under `chats/`, holding `sessionId` as its
 * one session. Its work folder is made when its agent first needs it.
 */
export function initializeChat({
  chatId,
  initialSettings,
  sessionId,
  workspaceConfig,
}: {
  chatId: ChatId;
  initialSettings: InitialSettings;
  sessionId: StoreId.Session;
  workspaceConfig: WorkspaceConfig;
}) {
  return initializeRecord({
    initialSettings: { ...initialSettings, chatSessionId: sessionId },
    place: () => placeChat(chatId, sessionId),
    chatId,
    sessionId,
    workspaceConfig,
  });
}

async function initializeRecord({
  initialSettings,
  place,
  chatId,
  sessionId,
  workspaceConfig,
}: {
  initialSettings: Omit<ChatSettingsUpdate, "createdWithAppVersion">;
  place: () => ChatDir;
  chatId: ChatId;
  sessionId: StoreId.Session;
  workspaceConfig: WorkspaceConfig;
}) {
  // Lets go of the id reserved below when any later step fails, so a chat
  // that was never made does not hold its name in the index.
  let release: (() => void) | undefined;
  return safeTry(async function* () {
    // The id is reserved in the index before its folder exists, which is
    // what refuses a name another chat just took.
    const dir = yield* Result.fromThrowable(
      place,
      (error) =>
        new TypedError.Conflict(
          error instanceof Error ? error.message : String(error),
        ),
    )();
    const parentDir = path.dirname(dir);
    release = () => {
      forgetChat(chatId);
    };

    // Ensure the parent dir exists (idempotent), then create the chat's
    // dir non-recursively so it acts as an atomic existence guard. With
    // deterministic date+slug names, two concurrent creates can both pass a
    // separate access check, so we rely on mkdir failing with EEXIST instead.
    yield* ResultAsync.fromPromise(
      fs.mkdir(parentDir, { recursive: true }),
      (error) =>
        new TypedError.FileSystem(
          error instanceof Error ? error.message : "Unknown error",
          { cause: error },
        ),
    );
    yield* ResultAsync.fromPromise(
      fs.mkdir(dir, { recursive: false }),
      (error) =>
        error instanceof Error && "code" in error && error.code === "EEXIST"
          ? new TypedError.Conflict(`Chat directory already exists: ${dir}`)
          : new TypedError.FileSystem(
              error instanceof Error ? error.message : "Unknown error",
              { cause: error },
            ),
    );

    const createdAt = getCurrentDate();

    yield* updateChatSettings(chatId, {
      ...initialSettings,
      // Stamped from the start so a chat that has never been messaged still
      // lists by when it was made rather than by whatever last touched a file
      // beneath it.
      createdAt,
      createdWithAppVersion: workspaceConfig.appVersion,
      lastActivityAt: createdAt,
    });

    // The chat's own session is made with it, so every send, wake and task
    // finds the session its settings name already there.
    yield* await createSession({ chatId, sessionId });

    return ok({ chatId });
  }).mapErr((error) => {
    release?.();
    return error;
  });
}
