import os from "node:os";

import { type ChatGrant } from "../../schemas/chat-settings";
import { MountedFolder } from "../../schemas/mounted-folder";
import { AbsolutePathSchema } from "../../schemas/paths";
import { pathExists } from "../path-exists";
import { WINDOW_ID } from "../../schemas/window-id";
import { sessionOfChat } from "../record-folders";
import { Store } from "../store";
import { chatGrants } from "./grants";
import { type PlaceId, placePaths } from "../permissions/places";
import { readPermissionSettings } from "../permissions/rules";
import { outputFolderPath } from "./output-folder";
import { listTopics } from "./topics";
import { type ChatId } from "../../schemas/chat-id";

/**
 * The folders a chat reaches: the home
 * folder and the workspace folder always, the folders granted in the chat,
 * the folders of the topics it is filed under while it is, and the folders
 * Settings › Permissions allows everywhere. Only the
 * grants are written to the chat. Worked out on every read, so a topic's
 * folder comes and goes with the topic and a folder granted in one chat
 * stays in that chat. Every session of the chat reaches the same folders.
 *
 * The window, which no chat is, reaches the two standing folders alone.
 *
 * Keyed by path, in a fixed order: the two standing folders, then the
 * grants by when each was granted, then the topics' folders, then the
 * folders allowed everywhere.
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
        path: grant.path,
      });
    }
    for (const folderPath of await topicFolderPaths(chatId)) {
      add(standingFolder(folderPath));
    }
    // Folders allowed in Settings › Permissions, for every chat, after the
    // chat's own so a name it already uses never moves: a folder's own
    // rule, and the folders of a place of work set to Allowed (Documents,
    // or the drives, which no other folder the chat reaches holds).
    const settings = await readPermissionSettings();
    const allowed = [
      ...settings.folders
        .filter((folder) => folder.level === "allow")
        .map((folder) => folder.path),
      ...placePaths()
        .filter(
          (place) =>
            place.id !== "output" &&
            WORK_PLACES.has(place.id) &&
            settings.places[place.id] === "allow",
        )
        .flatMap((place) =>
          place.paths.map((placePath) => AbsolutePathSchema.parse(placePath)),
        ),
    ];
    for (const folderPath of allowed) {
      if (await pathExists(folderPath)) {
        add(standingFolder(folderPath));
      }
    }
  }

  return Object.fromEntries(folders.map((folder) => [folder.path, folder]));
}

/**
 * The places that hold the person's work, which Allowed in Settings makes
 * folders every chat reaches. Other apps' files and the sign-in folders
 * stay reachable only through the home folder.
 */
const WORK_PLACES = new Set<PlaceId>([
  "desktop",
  "documents",
  "downloads",
  "drives",
  "icloud",
]);

/**
 * A folder a chat reaches without holding it, named by its path so the same
 * folder has the same id on every read.
 */
function standingFolder(folderPath: string): MountedFolder.Type {
  return {
    access: "read-write",
    id: MountedFolder.IdSchema.parse(`reach:${folderPath}`),
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
