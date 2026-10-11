import { ok, Result, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { CHAT_FOLDER_NAMES } from "../constants";
import { type ChatDir } from "../schemas/paths";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { type ChatSettingsUpdate } from "../schemas/chat-settings";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { copyChatFolder } from "./copy-chat-folder";
import { TypedError } from "./errors";
import { getCurrentDate } from "./get-current-date";
import { pathExists } from "./path-exists";
import { forgetChat, placeChat } from "./record-folders";
import { updateChatSettings } from "./chat-settings";
import { workDir } from "./work-dir";

type InitialSettings = Omit<
  ChatSettingsUpdate,
  "chatSessionId" | "createdWithAppVersion"
>;

/** Makes a chat under `chats/`, holding `sessionId` as its one session. */
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
    workspaceConfig,
  });
}

async function initializeRecord({
  initialSettings,
  place,
  chatId,
  workspaceConfig,
}: {
  initialSettings: Omit<ChatSettingsUpdate, "createdWithAppVersion">;
  place: () => ChatDir;
  chatId: ChatId;
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

    yield* scaffoldWorkFolder(dir, workspaceConfig);

    return ok({ chatId });
  }).mapErr((error) => {
    release?.();
    return error;
  });
}

/**
 * What a working folder starts with: the template's package root, and the
 * folders the agent is told it has. `work` normally arrives with the template;
 * made here too, so the pair is a guarantee of the folder rather than a
 * template detail (venv creation, pnpm guidance, and skill installs all
 * assume it exists).
 */
function scaffoldWorkFolder(dir: ChatDir, workspaceConfig: WorkspaceConfig) {
  return safeTry(async function* () {
    yield* copyChatFolder({
      includePrivateFolder: false,
      sourceDir: workspaceConfig.chatTemplateDir,
      targetDir: dir,
    });
    for (const dirName of [
      CHAT_FOLDER_NAMES.attachments,
      CHAT_FOLDER_NAMES.work,
    ]) {
      yield* ResultAsync.fromPromise(
        fs.mkdir(absolutePathJoin(dir, dirName), { recursive: true }),
        (error) =>
          new TypedError.FileSystem(
            error instanceof Error ? error.message : "Unknown error",
            { cause: error },
          ),
      );
    }
    return ok(undefined);
  });
}

/**
 * Scaffolds the folder a chat works in when it has none: a chat made
 * before chats did their own work holds only its record, and its agent
 * expects a package root to install into. A folder with a `package.json`
 * already is left as it is.
 */
export async function ensureWorkFolder(
  chatId: ChatId,
  workspaceConfig: WorkspaceConfig,
) {
  const dir = workDir(chatId);
  if (await pathExists(absolutePathJoin(dir, "package.json"))) {
    return;
  }
  const scaffolded = await scaffoldWorkFolder(dir, workspaceConfig);
  if (scaffolded.isErr()) {
    workspaceConfig.captureException(scaffolded.error);
  }
}
