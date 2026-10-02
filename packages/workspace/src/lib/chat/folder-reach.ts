import os from "node:os";

import { FolderAttachment } from "../../schemas/folder-attachment";
import { AbsolutePathSchema } from "../../schemas/paths";
import { type TaskId } from "../../schemas/task-id";
import { type TaskState } from "../../schemas/task-state";
import { assignMountNames } from "../assign-mount-names";
import { pathExists } from "../path-exists";
import { WINDOW_ID } from "../../schemas/window-id";
import { isChatId, sessionOfChat } from "../record-folders";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";
import { outputFolderPath } from "./output-folder";
import { listTopics } from "./topics";

/**
 * The folders a task reaches, by the name each is mounted under.
 *
 * A task reaches what it was handed, which is on its record. A chat reaches
 * more than it holds: the home folder and the workspace folder always, and the
 * folders of the topics it is filed under while it is, none of which is ever
 * written to the chat. Only the folders the user sent it are on its record,
 * and they are added beside those. Worked out on every read, so a topic's
 * folder comes and goes with the topic and a folder sent in one chat stays in
 * that chat.
 *
 * The window, which no chat is, reaches the two standing folders alone.
 *
 * Names are assigned in a fixed order (the two standing folders, then the
 * sent ones by when they were sent, then the topics' folders), so a folder
 * keeps its name while a later one comes and goes.
 */
export async function folderReach(
  taskId: TaskId,
  state?: TaskState,
): Promise<Record<string, FolderAttachment.Type>> {
  const isWindow = taskId === WINDOW_ID;
  const held = isWindow
    ? undefined
    : (state ?? (await getTaskState(taskDir(taskId)))).attachedFolders;
  if (!isWindow && !isChatId(taskId)) {
    return held ?? {};
  }

  // A folder on the record keeps the name it arrived under, which is the one
  // the chat's messages already use for it, including a standing folder an
  // older chat holds on its record.
  const onRecord = new Map(
    Object.values(held ?? {}).map((folder) => [folder.path, folder]),
  );
  const folders: FolderAttachment.Type[] = [];
  const add = (folder: FolderAttachment.Type) => {
    if (!folders.some((known) => known.path === folder.path)) {
      folders.push(onRecord.get(folder.path) ?? folder);
    }
  };
  add(standingFolder(os.homedir()));
  add(standingFolder(outputFolderPath()));
  for (const folder of [...onRecord.values()].toSorted(
    (a, b) => a.createdAt - b.createdAt,
  )) {
    add(folder);
  }
  for (const folderPath of isWindow ? [] : await topicFolderPaths(taskId)) {
    add(standingFolder(folderPath));
  }

  // Names on the record first, so one is never taken by a folder that came
  // later; the rest by today's rule around them.
  const assigned = assignMountNames(folders);
  const names = new Map<FolderAttachment.Type, string>();
  const used = new Set<string>();
  for (const folder of folders) {
    if (folder.mountName && !used.has(folder.mountName)) {
      names.set(folder, folder.mountName);
      used.add(folder.mountName);
    }
  }
  for (const folder of folders) {
    if (names.has(folder)) {
      continue;
    }
    const preferred = assigned.get(folder.id) ?? folder.id;
    let mountName = preferred;
    for (let suffix = 2; used.has(mountName); suffix += 1) {
      mountName = `${preferred}-${suffix}`;
    }
    names.set(folder, mountName);
    used.add(mountName);
  }
  // Every folder a chat reaches is its to read and write: what a task it
  // starts may do there is the chat's to say when it hands the folder over.
  return Object.fromEntries(
    folders.map((folder) => {
      const mountName = names.get(folder) ?? folder.mountName;
      return [
        mountName,
        { ...folder, access: "read-write" as const, mountName },
      ];
    }),
  );
}

/**
 * A folder a chat reaches without holding it, named by its path so the same
 * folder has the same id on every read.
 */
function standingFolder(folderPath: string): FolderAttachment.Type {
  return {
    access: "read-write",
    createdAt: 0,
    id: FolderAttachment.IdSchema.parse(`reach:${folderPath}`),
    mountName: "",
    path: AbsolutePathSchema.parse(folderPath),
    source: "user",
  };
}

/**
 * The folders of every topic the chat is filed under, in the order it was
 * filed, leaving out any no longer on disk so the agent is not pointed at
 * nothing.
 */
async function topicFolderPaths(chatId: TaskId): Promise<string[]> {
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
