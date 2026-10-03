import { ok, Result, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";

import { TASK_FOLDER_NAMES } from "../constants";
import { type TaskId } from "../schemas/task-id";
import { type TaskSettingsUpdate } from "../schemas/task-settings";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { copyTask } from "./copy-task";
import { TypedError } from "./errors";
import { getCurrentDate } from "./get-current-date";
import {
  chatsDir,
  chatTasksDir,
  forgetChat,
  forgetChatTask,
  isChatId,
  placeChat,
  placeChatTask,
} from "./record-folders";
import { taskDir } from "./task-dir-utils";
import { updateTaskSettings } from "./task-settings";

export async function initializeTask(
  {
    chatId,
    initialSettings,
    taskId,
    workspaceConfig,
  }: {
    /** The chat that starts the task, whose `tasks/` folder it goes in. */
    chatId?: TaskId;
    initialSettings: Omit<TaskSettingsUpdate, "createdWithAppVersion">;
    taskId: TaskId;
    workspaceConfig: WorkspaceConfig;
  },
  _options: { signal?: AbortSignal },
) {
  // Lets go of the id reserved below when any later step fails, so a chat or
  // task that was never made does not hold its name in the index.
  let release: (() => void) | undefined;
  return safeTry(async function* () {
    // A chat's folder goes under `chats/`, a task a chat started goes inside
    // that chat, and any other task goes flat under `tasks/`. Either id is
    // reserved in the index before its folder exists, which is what refuses
    // a name another chat just took.
    const { chatSessionId } = initialSettings;
    const isChat = chatSessionId !== undefined;
    const inChat = !isChat && chatId !== undefined;
    const reserved = yield* Result.fromThrowable(
      () => {
        if (inChat && !isChatId(chatId)) {
          throw new Error(`No chat has the id ${chatId}.`);
        }
        if (isChat) {
          placeChat(taskId, chatSessionId);
        } else if (inChat) {
          placeChatTask(taskId, chatId);
        }
        return isChat || inChat;
      },
      (error) =>
        new TypedError.Conflict(
          error instanceof Error ? error.message : String(error),
        ),
    )();
    const parentDir = isChat
      ? chatsDir()
      : inChat
        ? chatTasksDir(chatId)
        : workspaceConfig.tasksDir;
    release = () => {
      if (!reserved) {
        return;
      }
      if (isChat) {
        forgetChat(taskId);
      } else {
        forgetChatTask(taskId);
      }
    };

    // Ensure the parent dir exists (idempotent), then create the task
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
      fs.mkdir(taskDir(taskId), { recursive: false }),
      (error) =>
        error instanceof Error && "code" in error && error.code === "EEXIST"
          ? new TypedError.Conflict(
              `Task directory already exists: ${taskDir(taskId)}`,
            )
          : new TypedError.FileSystem(
              error instanceof Error ? error.message : "Unknown error",
              { cause: error },
            ),
    );

    // A chat runs no code of its own, so it takes none of a task's scaffold.
    if (!isChat) {
      yield* copyTask({
        includePrivateFolder: false,
        sourceDir: workspaceConfig.defaultTaskTemplateDir,
        targetDir: taskDir(taskId),
      });
    }

    const createdAt = getCurrentDate();

    yield* updateTaskSettings(taskId, {
      ...initialSettings,
      // Stamped from the start so a task that has never been messaged still
      // lists by when it was made rather than by whatever last touched a file
      // beneath it.
      createdAt,
      createdWithAppVersion: workspaceConfig.appVersion,
      lastActivityAt: createdAt,
    });

    // Create standard directories so they appear in the file tree. Avoids agent
    // spending a tool call to create them. `work` normally arrives via the
    // template copy above; creating it here too makes the agent-visible pair
    // a guarantee of task initialization rather than a template detail (venv
    // creation, pnpm guidance, and skill installs all assume it exists).
    const standardDirs = [
      TASK_FOLDER_NAMES.attachments,
      TASK_FOLDER_NAMES.work,
    ];
    for (const dirName of standardDirs) {
      yield* ResultAsync.fromPromise(
        fs.mkdir(absolutePathJoin(taskDir(taskId), dirName), {
          recursive: true,
        }),
        (error) =>
          new TypedError.FileSystem(
            error instanceof Error ? error.message : "Unknown error",
            { cause: error },
          ),
      );
    }

    return ok({ taskId });
  }).mapErr((error) => {
    release?.();
    return error;
  });
}
