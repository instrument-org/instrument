import { parallel } from "radashi";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { readTopicsSync } from "../chat/topics";
import { workspaceLayout } from "../workspace-layout";
import { type ChatFolderWrite, writeChatFolder } from "./write-chat-folder";

/**
 * How many chats are written at once. Each is a read of a folder, a fold and
 * one write, so the limit is there to keep a workspace of hundreds of chats
 * from opening hundreds of handles rather than for the speed.
 */
const CHATS_AT_ONCE = 8;

/**
 * Gives the chats a launch migration just brought onto their records their
 * own folder and `CHAT.md`, once: the caller names only the chats that
 * migration converted this launch, which a later launch finds already
 * converted and never names again. Every other chat's folder is written when
 * its turn ends or the person sends it a message, so no launch reads a chat
 * it did not just convert.
 *
 * The topics are named as the workspace has them, and the days and times in
 * this computer's own zone, which is the zone the person reading the folder
 * is in. Reads the folder rather than the workspace's own state, so it runs
 * before the workspace starts.
 */
export async function giveChatsTheirFolders(
  rootDir: string,
  machineDir: string,
  /** The chats to write, by the name of each one's record folder. */
  chats: readonly string[],
): Promise<({ id: ChatId } & ChatFolderWrite)[]> {
  const ids = chats.flatMap((name) => {
    const id = ChatIdSchema.safeParse(name);
    return id.success ? [id.data] : [];
  });
  if (ids.length === 0) {
    return [];
  }
  const chatsDir = workspaceLayout(rootDir).chatsDir;
  const topicNames = new Map(
    readTopicsSync(rootDir).map((topic) => [topic.id, topic.name]),
  );
  return parallel({ limit: CHATS_AT_ONCE }, ids.toSorted(), async (id) => ({
    id,
    ...(await writeChatFolder({
      chatsDir,
      id,
      machineDir,
      rootDir,
      topicNames,
    })),
  }));
}
