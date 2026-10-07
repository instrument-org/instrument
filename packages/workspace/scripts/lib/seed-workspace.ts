// Builds a workspace on disk from a committed fixture description.
//
// Everything here goes through the workspace's own libraries -- `initializeTask`
// for the directory, `Store` for the conversation -- rather than writing task
// files directly. That is deliberate and load-bearing: task storage is moving
// (see docs/plans/completed/user-chosen-working-folder.md and
// conversation-storage.md), and a seeder that lays out `tasks/<id>/.instrument`
// itself would keep producing plausible-looking workspaces the app can no longer
// read. Reach for a library or a route; never for `fs.writeFile` into a task.
//
// Recorded transcripts are inserted as they were captured rather than re-run
// through the agent loop. Re-running each tool call would need the whole
// runtime (bash sandbox, browser, model) and make the result depend on it. Seeding has to work in CI with no provider
// credentials and finish in seconds, so the recorded tool outputs stand, and
// the artifacts a tool would have written come from the fixture's `files/`.

import {
  TASK_PRIVATE_FOLDER_NAME,
  TASK_SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import { ok, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";

import { TASKS_DIR_NAME } from "../../src/constants";
import { copyTask } from "../../src/lib/copy-task";
import { initializeChat, initializeTask } from "../../src/lib/initialize-task";
import { newTaskId } from "../../src/lib/new-task-id";
import { resolvePathWithinTaskDir } from "../../src/lib/resolve-path-within-task-dir";
import { disposeSessionsStoreStorage } from "../../src/lib/session-store-storage";
import { Store } from "../../src/lib/store";
import { taskDir } from "../../src/lib/task-dir-utils";
import { setTaskState } from "../../src/lib/task-record";
import { updateTaskSettings } from "../../src/lib/task-settings";
import { placeTaskAt } from "../../src/lib/record-folders";
import { setWorkspaceConfig } from "../../src/lib/workspace-config";
import { FolderAttachment } from "../../src/schemas/folder-attachment";
import {
  AbsolutePathSchema,
  RelativePathSchema,
  TaskDirSchema,
} from "../../src/schemas/paths";
import { type Session } from "../../src/schemas/session";
import { type SessionMessage } from "../../src/schemas/session/message";
import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { StoreId } from "../../src/schemas/store-id";
import { SubdomainPartSchema } from "../../src/schemas/subdomain-part";
import { type TaskId } from "../../src/schemas/task-id";
import { type WorkspaceConfig } from "../../src/types";
import { createStubWorkspaceConfig } from "./stub-workspace-config";
import {
  type FixtureChat,
  type FixtureChatTask,
  type FixtureTask,
  type WorkspaceFixture,
} from "./workspace-fixture";
import { type ChatId, ChatIdSchema } from "../../src/schemas/chat-id";

// Where a chat's folders are made: in the user-data directory beside the
// workspace, not inside it, as a user's own folders are.
const FOLDERS_DIR_NAME = "folders";

const DEFAULT_TASK_TEMPLATE_DIR = path.resolve(
  import.meta.dirname,
  "../../templates/default",
);

export interface SeededTask {
  /** The chat it is inside, for a task a chat started. */
  chat?: TaskId;
  id: TaskId;
  key: string;
  /** A chat's record, or a task. */
  kind: "chat" | "task";
  name: string;
}

interface FixtureFile {
  from: string;
  to: string;
}

/**
 * `userDataDir` is what `ELECTRON_USER_DATA_DIR` will point at, so the layout
 * written here has to be the one the app expects to find: the workspace under
 * `workspace/`, the electron-store files beside it.
 */
export async function seedWorkspace({
  fixture,
  now = new Date(),
  userDataDir,
}: {
  fixture: WorkspaceFixture;
  now?: Date;
  userDataDir: string;
}): Promise<SeededTask[]> {
  const rootDir = path.join(userDataDir, "workspace");
  const tasksDir = path.join(rootDir, TASKS_DIR_NAME);

  await fs.mkdir(tasksDir, { recursive: true });

  const workspaceConfig = createStubWorkspaceConfig({
    overrides: {
      // The one stub path the seeder reads through rather than merely names:
      // task creation copies this template into every task it makes.
      defaultTaskTemplateDir: AbsolutePathSchema.parse(
        DEFAULT_TASK_TEMPLATE_DIR,
      ),
    },
    rootDir,
    tasksDir,
  });
  // `taskDir()` and everything under `Store` read the config from this
  // singleton rather than taking it as an argument.
  setWorkspaceConfig(workspaceConfig);

  const seeded: SeededTask[] = [];
  for (const { files, session, task } of fixture.tasks) {
    const id = await seedTask({ files, now, session, task, workspaceConfig });
    if (task.pinned) {
      await pinLegacyTask(id, session.createdAt);
    }
    seeded.push({ id, key: task.key, kind: "task", name: task.name });
  }
  for (const { chat, folders, session, tasks } of fixture.chats) {
    // The record `seedTask` made from a chat's fixture is a chat.
    const chatId = ChatIdSchema.parse(
      await seedTask({
        files: [],
        now,
        session,
        task: chat,
        workspaceConfig,
      }),
    );
    const granted = await makeFolders({ folders, now, userDataDir });
    await setTaskState(taskDir(chatId), { attachedFolders: granted });
    seeded.push({ id: chatId, key: chat.key, kind: "chat", name: chat.name });
    for (const { files, session: taskSession, task } of tasks) {
      const id = await seedTask({
        files,
        chatId,
        now,
        session: taskSession,
        task,
        workspaceConfig,
      });
      await setTaskState(taskDir(id), {
        attachedFolders: Object.fromEntries(
          Object.entries(granted).filter(([mount]) =>
            task.folders.includes(mount),
          ),
        ),
      });
      seeded.push({
        chat: chatId,
        id,
        key: task.key,
        kind: "task",
        name: task.name,
      });
    }
  }

  await writeSettings({ settings: fixture.settings, userDataDir });

  return seeded;
}

function collectTimestamps(session: Session.WithMessagesAndParts): Date[] {
  const dates: Date[] = [session.createdAt];
  if (session.updatedAt) {
    dates.push(session.updatedAt);
  }
  for (const message of session.messages) {
    dates.push(...datesIn(message.metadata));
    for (const part of message.parts) {
      dates.push(...datesIn(part.metadata));
    }
  }
  return dates;
}

async function copyFixtureFiles({
  files,
  id,
}: {
  files: FixtureFile[];
  id: TaskId;
}) {
  const dir = taskDir(id);

  for (const file of files) {
    const destination = resolvePathWithinTaskDir({
      dir,
      filePath: RelativePathSchema.parse(file.to),
    });
    if (!destination) {
      throw new Error(`"${file.to}" resolves outside the task directory`);
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(file.from, destination);
  }
}

function datesIn(metadata: Record<string, unknown>): Date[] {
  return Object.values(metadata).filter((value) => value instanceof Date);
}

/**
 * Makes a chat's folders beside the workspace, the way a user's own folders sit
 * outside it, with their files, and returns them as the grants the chat holds.
 */
async function makeFolders({
  folders,
  now,
  userDataDir,
}: {
  folders: { files: FixtureFile[]; mount: string }[];
  now: Date;
  userDataDir: string;
}): Promise<Record<string, FolderAttachment.Type>> {
  const granted: Record<string, FolderAttachment.Type> = {};
  for (const folder of folders) {
    const dir = path.join(userDataDir, FOLDERS_DIR_NAME, folder.mount);
    await fs.mkdir(dir, { recursive: true });
    for (const file of folder.files) {
      const destination = path.resolve(dir, file.to);
      if (!destination.startsWith(`${dir}${path.sep}`)) {
        throw new Error(`"${file.to}" resolves outside ${dir}`);
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(file.from, destination);
    }
    granted[folder.mount] = {
      access: "read-write",
      createdAt: now.getTime(),
      id: FolderAttachment.IdSchema.parse(ulid()),
      mountName: folder.mount,
      path: AbsolutePathSchema.parse(dir),
      source: "user",
    };
  }
  return granted;
}

/**
 * Pins a task the way a 1.x build did, by a key in its settings file that the
 * current settings schema no longer carries: what the boot migration reads to
 * star the chat it makes. Written raw for that reason, the one place the
 * seeder writes a task file itself.
 */
async function pinLegacyTask(id: TaskId, pinnedAt: Date) {
  const file = path.join(
    taskDir(id),
    TASK_PRIVATE_FOLDER_NAME,
    TASK_SETTINGS_FILE_NAME,
  );
  const settings = JSON.parse(await fs.readFile(file, "utf8")) as Record<
    string,
    unknown
  >;
  await fs.writeFile(
    file,
    `${JSON.stringify({ ...settings, pinnedAt: pinnedAt.toISOString() }, undefined, 2)}\n`,
  );
}

/**
 * Shifts a transcript so its newest message lands `agedMinutes` before now,
 * keeping the recorded spacing between messages. The alternative, replaying the
 * absolute recorded timestamps, renders as "2 years ago" in the sidebar and
 * drifts further every month; anchoring to seed time keeps a fixture showing the
 * relative dates it was captured with. Anything asserting on pixels still has to
 * mask the timestamps.
 */
function rebaseTimestamps<T extends Record<string, unknown>>(
  metadata: T,
  deltaMs: number,
): T {
  const shifted: Record<string, unknown> = { ...metadata };
  for (const [key, value] of Object.entries(shifted)) {
    if (value instanceof Date) {
      shifted[key] = new Date(value.getTime() + deltaMs);
    }
  }
  return shifted as T;
}

/**
 * Seeds one record: a task inside the chat named by `chatId`, a chat's own
 * record when `task` is a chat, which holds its session as the chat's and
 * takes no task scaffold, or, with neither, a task flat under `tasks/` as 1.x
 * left one, which the layout migration moves into a chat of its own at the
 * app's next boot.
 */
async function seedTask({
  chatId,
  files,
  now,
  session,
  task,
  workspaceConfig,
}: {
  chatId?: ChatId;
  files: FixtureFile[];
  now: Date;
  session: Session.WithMessagesAndParts;
  task: FixtureChat | FixtureChatTask | FixtureTask;
  workspaceConfig: WorkspaceConfig;
}): Promise<TaskId> {
  const isChat = "tasks" in task;
  // The fixture's own key becomes the folder name, so a seeded task has an id
  // that is readable, stable across seeds, and findable in the fixture.
  const id = await newTaskId({
    preferredFolderName: SubdomainPartSchema.parse(task.key),
    workspaceConfig,
  });

  // `newTaskId` falls back to a dated name when the folder is taken, which for
  // a fixture is silent corruption rather than a convenience: the seeded id
  // stops matching the one the manifest promises and every script addressing
  // the task by name breaks. Seeding is only ever meant to run against a clean
  // directory, so say so instead of producing a workspace that looks fine.
  if (id !== task.key) {
    throw new Error(
      `${isChat ? "chats" : "tasks"}/${task.key} already exists in this workspace. Seed into an empty directory, or pass --fresh to rebuild.`,
    );
  }

  // Open SQLite handles are cached by task id, and a fixture's ids are the same
  // in every workspace built from it. Drop any handle held over from an earlier
  // seed so this one cannot write through a database belonging to another
  // workspace.
  await disposeSessionsStoreStorage(id);

  const latest = Math.max(
    ...collectTimestamps(session).map((date) => date.getTime()),
  );
  const rebased = withFreshIdsAndTimes(session, {
    deltaMs: now.getTime() - task.agedMinutes * 60_000 - latest,
    title: task.name,
  });
  const chatSession: Session.Type = isChat
    ? {
        ...rebased.session,
        ...(task.starred ? { starredAt: rebased.session.createdAt } : {}),
        // Named by the manifest, so the app never renames it.
        titleSettledAt: rebased.session.createdAt,
      }
    : rebased.session;

  const result = await safeTry(async function* () {
    if (isChat) {
      yield* await initializeChat({
        chatId: ChatIdSchema.parse(id),
        initialSettings: { name: task.name },
        sessionId: chatSession.id,
        workspaceConfig,
      });
    } else if (chatId !== undefined) {
      yield* await initializeTask(
        {
          chatId,
          initialSettings: { name: task.name },
          taskId: id,
          workspaceConfig,
        },
        {},
      );
    } else {
      yield* seedLegacyTaskFolder({ id, name: task.name, workspaceConfig });
    }

    yield* Store.saveSession(chatSession, id);
    for (const message of rebased.messages) {
      yield* Store.saveMessageWithParts(message, id);
    }

    return ok(undefined);
  });
  if (result.isErr()) {
    throw result.error;
  }

  await copyFixtureFiles({ files, id });

  // Every task holds an open SQLite handle in a module-level cache. Release it
  // so the WAL is flushed and the process can exit on its own.
  await disposeSessionsStoreStorage(id);

  return id;
}

/**
 * A task's folder flat under `tasks/`, laid down the way 1.x made one: the
 * default scaffold and its settings. The app never makes one now, so it is
 * placed in this process's index by hand, for the store writes that follow.
 */
function seedLegacyTaskFolder({
  id,
  name,
  workspaceConfig,
}: {
  id: TaskId;
  name: string;
  workspaceConfig: WorkspaceConfig;
}) {
  const dir = TaskDirSchema.parse(path.join(workspaceConfig.tasksDir, id));
  placeTaskAt(id, LEGACY_SEED_CHAT_ID, dir);
  return copyTask({
    includePrivateFolder: false,
    sourceDir: workspaceConfig.defaultTaskTemplateDir,
    targetDir: dir,
  }).andThen(() =>
    updateTaskSettings(id, {
      createdAt: new Date(),
      createdWithAppVersion: workspaceConfig.appVersion,
      name,
    }),
  );
}

/** The chat a 1.x task is filed under while it is seeded; it has no folder. */
const LEGACY_SEED_CHAT_ID = ChatIdSchema.parse("legacy-seed");

/**
 * Fresh ids for the session, its messages and its parts, plus the timestamp
 * shift. Ids are ULIDs, which sort by the time they were minted, and the store
 * orders by key -- so reusing the recorded ids would order a transcript by when
 * it was captured while its timestamps claim something else.
 */
function withFreshIdsAndTimes(
  session: Session.WithMessagesAndParts,
  { deltaMs, title }: { deltaMs: number; title: string },
) {
  const sessionId = StoreId.newSessionId();

  const messages = session.messages.map((message) => {
    const messageId = StoreId.newMessageId();
    const parts = message.parts.map(
      (part) =>
        ({
          ...part,
          metadata: {
            ...rebaseTimestamps(part.metadata, deltaMs),
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
        }) as SessionMessagePart.Type,
    );

    return {
      ...message,
      id: messageId,
      metadata: {
        ...rebaseTimestamps(message.metadata, deltaMs),
        sessionId,
      },
      parts,
    } as SessionMessage.WithParts;
  });

  return {
    messages,
    session: {
      ...session,
      createdAt: new Date(session.createdAt.getTime() + deltaMs),
      id: sessionId,
      // A recorded title reflects whatever the run that produced it was called.
      // The manifest is where a fixture says what it is, so the task's name is
      // also its session's.
      title,
      updatedAt: session.updatedAt
        ? new Date(session.updatedAt.getTime() + deltaMs)
        : undefined,
    } satisfies Session.Type,
  };
}

/**
 * The electron-store files the app reads from `userData`. Written verbatim: the
 * schemas that know these keys live in Studio, and the app re-validates on load
 * with a default for anything missing or wrong. So a fixture pins what it
 * depends on and inherits the rest, which is what keeps it from breaking every
 * time a default moves.
 */
async function writeSettings({
  settings,
  userDataDir,
}: {
  settings: Record<string, Record<string, unknown>>;
  userDataDir: string;
}) {
  for (const [store, values] of Object.entries(settings)) {
    const file = path.join(userDataDir, `${store}.json`);
    // Merged rather than replaced: seeding several fixtures into one workspace
    // runs this once per fixture, and writing the whole file each time would
    // leave only the last fixture's keys.
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await fs.readFile(file, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      // First fixture to pin this store.
    }

    await fs.writeFile(
      file,
      `${JSON.stringify({ ...existing, ...values }, undefined, 2)}\n`,
    );
  }
}
