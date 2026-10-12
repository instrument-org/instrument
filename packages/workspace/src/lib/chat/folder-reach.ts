import os from "node:os";

import { type ChatGrant } from "../../schemas/chat-settings";
import { MountedFolder } from "../../schemas/mounted-folder";
import { AbsolutePathSchema } from "../../schemas/paths";
import { assignMountNames } from "../assign-mount-names";
import { pathExists } from "../path-exists";
import { WINDOW_ID } from "../../schemas/window-id";
import { sessionOfChat } from "../record-folders";
import { Store } from "../store";
import { chatGrants } from "./grants";
import { outputFolderPath } from "./output-folder";
import { listTopics } from "./topics";
import { type ChatId } from "../../schemas/chat-id";

/**
 * The folders a chat reaches, by the name each is mounted under: the home
 * folder and the workspace folder always, the folders granted in the chat,
 * and the folders of the topics it is filed under while it is. Only the
 * grants are written to the chat. Worked out on every read, so a topic's
 * folder comes and goes with the topic and a folder granted in one chat
 * stays in that chat. Every session of the chat reaches the same folders.
 *
 * The window, which no chat is, reaches the two standing folders alone.
 *
 * Names are derived, never stored, and assigned in a fixed order: the two
 * standing folders, then the grants by when each was granted, then the
 * topics' folders. A folder takes its plain name where it is free, so an
 * earlier grant keeps its name and only a later one that collides with it is
 * qualified, and a path the chat already used never moves when a folder is
 * granted after it.
 */
export async function folderReach(
  chatId: ChatId,
  grants?: ChatGrant[],
): Promise<Record<string, MountedFolder.Type>> {
  const isWindow = chatId === WINDOW_ID;
  const folders: MountedFolder.Type[] = [];
  const add = (folder: MountedFolder.Type) => {
    if (!folders.some((known) => known.path === folder.path)) {
      folders.push(folder);
    }
  };
  add(standingFolder(os.homedir()));
  add(standingFolder(outputFolderPath()));
  if (!isWindow) {
    const granted = (grants ?? (await chatGrants(chatId))).toSorted(
      (a, b) => a.grantedAt.getTime() - b.grantedAt.getTime(),
    );
    for (const grant of granted) {
      add({
        access: "read-write",
        id: MountedFolder.IdSchema.parse(`grant:${grant.path}`),
        mountName: "",
        path: grant.path,
      });
    }
    for (const folderPath of await topicFolderPaths(chatId)) {
      add(standingFolder(folderPath));
    }
  }

  const names = assignMountNames(folders);
  // Every folder a chat reaches is its to read and write, short of what
  // effectiveFolderAccess keeps read-only: anything holding the workspace.
  return Object.fromEntries(
    folders.map((folder) => {
      const mountName = names.get(folder.id) ?? folder.id;
      return [mountName, { ...folder, mountName }];
    }),
  );
}

/**
 * A folder a chat reaches without holding it, named by its path so the same
 * folder has the same id on every read.
 */
function standingFolder(folderPath: string): MountedFolder.Type {
  return {
    access: "read-write",
    id: MountedFolder.IdSchema.parse(`reach:${folderPath}`),
    mountName: "",
    path: AbsolutePathSchema.parse(folderPath),
  };
}

/**
 * The folders of every topic the chat is filed under, in the order it was
 * filed, leaving out any no longer on disk so the agent is not pointed at
 * nothing.
 */
async function topicFolderPaths(chatId: ChatId): Promise<string[]> {
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    return [];
  }
  const session = await Store.getSession(sessionId, chatId);
  const tagged = session.isOk() ? (session.value.topics ?? []) : [];
  if (tagged.length === 0) {
    return [];
  }
  const known = await listTopics();
  const paths: string[] = [];
  for (const id of tagged) {
    const topic = known.find((entry) => entry.id === id);
    for (const folder of topic?.folders ?? []) {
      const onDisk = AbsolutePathSchema.safeParse(folder.path);
      if (onDisk.success && (await pathExists(onDisk.data))) {
        paths.push(onDisk.data);
      }
    }
  }
  return paths;
}
