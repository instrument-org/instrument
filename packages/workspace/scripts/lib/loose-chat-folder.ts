import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { WORKSPACE_DATA_ENTRIES } from "../../src/lib/workspace-layout";

/**
 * A chat's record folder as the workspace reads it: the folder itself when it
 * is a workspace's `.instrument/chats/<chat>`, otherwise a link to it from a
 * temporary workspace, named for the chat its session logs record. That
 * reads a chat folder rebuilt from a feedback report, or copied off another
 * computer, the same as one in place.
 */
export function chatFolderInWorkspace(recordDir: string): string {
  const parts = path.resolve(recordDir).split(path.sep);
  if (
    parts.at(-2) === WORKSPACE_DATA_ENTRIES.chats &&
    parts.at(-3) === PRIVATE_FOLDER_NAME
  ) {
    return recordDir;
  }
  const chat = fs
    .readdirSync(recordDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => chatOfLog(path.join(recordDir, name)))
    .find(Boolean);
  if (!chat) return recordDir;
  const chats = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "loose-chat-")),
    PRIVATE_FOLDER_NAME,
    WORKSPACE_DATA_ENTRIES.chats,
  );
  fs.mkdirSync(chats, { recursive: true });
  const linked = path.join(chats, chat);
  fs.symlinkSync(path.resolve(recordDir), linked, "dir");
  return linked;
}

/** The chat a session log's header names, if its first line is one. */
function chatOfLog(file: string): string | undefined {
  const first = fs.readFileSync(file, "utf8").split("\n", 1)[0] ?? "";
  try {
    const header: unknown = JSON.parse(first);
    return typeof header === "object" &&
      header !== null &&
      "chat" in header &&
      typeof header.chat === "string"
      ? header.chat
      : undefined;
  } catch {
    return undefined;
  }
}
