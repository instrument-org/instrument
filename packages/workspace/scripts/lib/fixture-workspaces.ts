// What a check of seeded workspaces needs from this package: the seeder, the
// committed fixtures, and a read of a workspace through the app's own
// readers. Studio's guard over the fixtures imports it, since only Studio can
// run the launch steps between the seed and the read.

import path from "node:path";

import { TASKS_DIR_NAME } from "../../src/constants";
import { ChatReads } from "../../src/lib/chat-reads";
import { listChats } from "../../src/lib/chat/chats";
import { listChildTasks } from "../../src/lib/chat/children";
import { chatGrants } from "../../src/lib/chat/grants";
import { newDeviceId } from "../../src/lib/records/device-id";
import {
  ChatRecords,
  installChatRecords,
} from "../../src/lib/records/chat-records";
import { chatDir, loadChatIndex } from "../../src/lib/record-folders";
import { workDir } from "../../src/lib/work-dir";
import { setWorkspaceActorRef } from "../../src/lib/workspace-actor-ref";
import { setWorkspaceConfig } from "../../src/lib/workspace-config";
import { type WorkspaceActorRef } from "../../src/machines/workspace";
import { AbsolutePathSchema } from "../../src/schemas/paths";
import { createStubWorkspaceConfig } from "./stub-workspace-config";

export { seedWorkspace, type SeededTask } from "./seed-workspace";
export {
  listFixtureNames,
  loadWorkspaceFixture,
  type WorkspaceFixture,
} from "./workspace-fixture";

/** One chat as the app reads it back. */
export interface ReadChat {
  /** The folders granted to it, from this computer's permission settings. */
  grants: string[];
  id: string;
  tasks: {
    handle: string;
    /** How many of its parent's messages it reads as its own history. */
    inherited: number;
    /** How many messages are its own. */
    own: number;
    title: string;
  }[];
  title: string;
  /** Its work folder (`workDir`). */
  workDir: string;
}

/**
 * A workspace with no agent running, which is what the chat list asks of the
 * workspace's actor: a chat's row says whether one of its agents is alive.
 * Cast because a reader asks only for the sessions running, and an actor
 * cannot be made without the whole runtime.
 */
const idleWorkspace = {
  getSnapshot: () => ({ context: { sessionRefsByChatId: new Map() } }),
} as unknown as WorkspaceActorRef;

/**
 * Reads a workspace the way the app does once it has launched on it: the
 * chat list, each chat's tasks and their histories, its work folder and its
 * granted folders, each through the reader the app uses. The folders are
 * the ones the launch settled for it.
 */
export async function readWorkspace({
  machineDir,
  rootDir,
  userDataDir,
  workFoldersDir,
}: {
  machineDir: string;
  rootDir: string;
  userDataDir: string;
  workFoldersDir: string;
}): Promise<ReadChat[]> {
  const config = createStubWorkspaceConfig({
    overrides: {
      userDataDir: AbsolutePathSchema.parse(userDataDir),
      workFoldersDir: AbsolutePathSchema.parse(workFoldersDir),
      workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
    },
    rootDir,
    tasksDir: path.join(rootDir, TASKS_DIR_NAME),
  });
  setWorkspaceConfig(config);
  setWorkspaceActorRef(idleWorkspace);
  // In place of the chats of another workspace this process read.
  await loadChatIndex();
  const records = new ChatRecords({
    app: config.appVersion,
    device: newDeviceId(),
    dirOf: chatDir,
  });
  installChatRecords(records);
  try {
    const read: ReadChat[] = [];
    for (const chat of await listChats()) {
      const tasks = [];
      for (const task of await listChildTasks(chat.id)) {
        const history = (
          await ChatReads.history({ chatId: chat.id, sessionId: task.id })
        )._unsafeUnwrap();
        const own = (
          await ChatReads.messageIds({ chatId: chat.id, sessionId: task.id })
        )._unsafeUnwrap();
        tasks.push({
          handle: task.handle,
          inherited: history.length - own.length,
          own: own.length,
          title: task.title,
        });
      }
      read.push({
        grants: (await chatGrants(chat.id)).map((grant) => grant.path),
        id: chat.id,
        tasks: tasks.toSorted((a, b) => a.handle.localeCompare(b.handle)),
        title: chat.title,
        workDir: workDir(chat.id),
      });
    }
    return read;
  } finally {
    await records.dispose();
    installChatRecords(undefined);
  }
}
