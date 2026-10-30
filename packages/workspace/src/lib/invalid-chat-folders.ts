import { err, type Result, ResultAsync } from "neverthrow";
import fs from "node:fs";
import path from "node:path";

import { AbsolutePathSchema } from "../schemas/paths";
import { ChatIdSchema } from "../schemas/chat-id";
import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";
import { chatReadProblem } from "./chat/chats";
import { pathExists } from "./path-exists";
import {
  chatSessionIn,
  chatsDir,
  forgetChat,
  sessionOfChat,
} from "./record-folders";

interface InvalidChatFolder {
  /** The folder's name under `chats/`. */
  name: string;
  reason: string;
}

/** Why a folder is listed, said to the person in Settings > Storage. */
const REASONS = {
  "bad-name": "Its folder name isn’t one a chat can use.",
  "no-session": "It doesn’t have a conversation of its own.",
  "unreadable-messages": "Its messages can’t be read.",
  "unreadable-session": "Its conversation can’t be read.",
} as const;

/**
 * Folders under `chats/` that the chat list leaves out: a chat whose folder
 * name is not a record id, whose records hold no session of its own, or
 * whose session or messages cannot be read. The list skips them without a trace, so they
 * are surfaced here for Settings > Storage instead of reported one by one.
 */
export async function listInvalidChatFolders(): Promise<InvalidChatFolder[]> {
  const root = chatsDir();
  const invalid: InvalidChatFolder[] = [];
  for (const name of listDirs(root)) {
    const id = ChatIdSchema.safeParse(name);
    if (!id.success) {
      invalid.push({ name, reason: REASONS["bad-name"] });
      continue;
    }
    const sessionId = await chatSessionIn(path.join(root, name));
    if (sessionId === undefined) {
      invalid.push({ name, reason: REASONS["no-session"] });
      continue;
    }
    // The records are reached through the index, which knows the chat by
    // this session once it has read the folder.
    if (sessionOfChat(id.data) === sessionId) {
      const problem = await chatReadProblem(id.data, sessionId);
      if (problem) {
        invalid.push({ name, reason: REASONS[problem] });
      }
    }
  }
  return invalid;
}

/**
 * Sends one folder the scan reports to the OS trash, with the work folder of
 * the same name where there is one. Only a name the scan reports right now is
 * taken, which keeps a chat the list can show, and any path out of `chats/`,
 * out of reach. A chat leaves the index once its folder is gone.
 */
export async function trashInvalidChatFolder(
  name: string,
  workspaceConfig: WorkspaceConfig,
): Promise<Result<void, TypedError.FileSystem | TypedError.Parse>> {
  const invalid = await listInvalidChatFolders();
  if (!invalid.some((folder) => folder.name === name)) {
    return err(
      new TypedError.Parse(`Not a chat folder the app cannot read: ${name}`),
    );
  }
  const recordId = ChatIdSchema.safeParse(name);
  return ResultAsync.fromPromise(
    (async () => {
      const work = AbsolutePathSchema.parse(
        path.join(workspaceConfig.workFoldersDir, name),
      );
      if (await pathExists(work)) {
        await workspaceConfig.trashItem(work);
      }
      await workspaceConfig.trashItem(
        AbsolutePathSchema.parse(path.join(chatsDir(), name)),
      );
      if (recordId.success) {
        forgetChat(recordId.data);
      }
    })(),
    (error) =>
      new TypedError.FileSystem(
        error instanceof Error ? error.message : "Unknown error",
        { cause: error },
      ),
  );
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
