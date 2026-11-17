import fs from "node:fs/promises";

import { type ChatId } from "../../schemas/chat-id";
import { keptByNameOnly } from "../workspace-files";
import { chatLinkedInText, LINK_HEAD_BYTES } from "./chat-transcript";

/** What reading the head of a transcript found. */
export type ChatLink =
  /** Nothing has the name. */
  | { kind: "absent" }
  /** A transcript the app wrote, for this chat. */
  | { chat: ChatId; kind: "chat" }
  /** A file that names no chat, so not one of ours. */
  | { kind: "none" }
  /** A file whose head could not be read: kept by name only, or held. */
  | { kind: "unreadable"; reason: string };

/**
 * The chat a transcript names, from the head of the file: the front matter
 * and the line under it, however the rest of it reads. A file that names no
 * chat is not one of ours, which is what makes this the test of whether a
 * file in a chat's folder is a transcript the app wrote.
 *
 * A file a cloud service keeps by name only is unreadable here: reading its
 * head would download it.
 */
export async function readChatLink(file: string): Promise<ChatLink> {
  let head: string;
  try {
    const handle = await fs.open(file, "r");
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        return { kind: "none" };
      }
      if (keptByNameOnly(stats)) {
        return { kind: "unreadable", reason: "kept by name only" };
      }
      const read = await handle.read({
        buffer: Buffer.alloc(LINK_HEAD_BYTES),
        position: 0,
      });
      head = read.buffer.toString("utf8", 0, read.bytesRead);
    } finally {
      await handle.close();
    }
  } catch (error) {
    return isMissing(error)
      ? { kind: "absent" }
      : { kind: "unreadable", reason: String(error) };
  }
  const chat = chatLinkedInText(head);
  return chat === undefined ? { kind: "none" } : { chat, kind: "chat" };
}

/** The chat a transcript names, or nothing for any file that does not name one or cannot be read. */
export async function chatLinkedInFile(
  file: string,
): Promise<ChatId | undefined> {
  const link = await readChatLink(file);
  return link.kind === "chat" ? link.chat : undefined;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
