// Builds a workspace on disk from a committed fixture description.
//
// Everything here goes through the workspace's own libraries -- `initializeChat`
// for the directory, `ChatWrites` for the conversation -- rather than writing task
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
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";
import { ok, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { CHAT_DB_FILE_NAME, TASKS_DIR_NAME } from "../../src/constants";
import { initializeChat } from "../../src/lib/initialize-chat";
import { newChatId } from "../../src/lib/new-chat-id";
import { resolvePathWithinChatDir } from "../../src/lib/resolve-path-within-chat-dir";
import { ChatWrites } from "../../src/lib/chat-writes";
import {
  ChatRecords,
  installChatRecords,
  writingChatRecords,
} from "../../src/lib/records/chat-records";
import { chatDir, placeChat } from "../../src/lib/record-folders";
import { workDir } from "../../src/lib/work-dir";
import { updateJsonRecord } from "../../src/lib/json-record-file";
import { addChildTask } from "../../src/lib/chat/children";
import { grantFolder } from "../../src/lib/chat/grants";
import { setWorkspaceConfig } from "../../src/lib/workspace-config";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  RelativePathSchema,
} from "../../src/schemas/paths";
import { type Session } from "../../src/schemas/session";
import { type SessionMessage } from "../../src/schemas/session/message";
import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { StoreId } from "../../src/schemas/store-id";
import { SubdomainPartSchema } from "../../src/schemas/subdomain-part";
import { type ChatId, ChatIdSchema } from "../../src/schemas/chat-id";
import { type WorkspaceConfig } from "../../src/types";
import { createStubWorkspaceConfig } from "./stub-workspace-config";
import {
  type FixtureChat,
  type FixtureChatTask,
  type FixtureTask,
  type WorkspaceFixture,
} from "./workspace-fixture";

// Where a chat's folders are made: in the user-data directory beside the
// workspace, not inside it, as a user's own folders are.
const FOLDERS_DIR_NAME = "folders";

export interface SeededTask {
  /** The chat it is inside, for a task a chat started. */
  chat?: ChatId;
  /** A record's id, or for a task a chat started, its session in the chat's store. */
  id: StoreId.Session | ChatId;
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
 * `workspace/`, the electron-store files beside it, and each chat's work
 * folder in the machine folder of the first workspace, which the app names
 * `default`.
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
  const machineDir = path.join(userDataDir, "machine", "default");

  await fs.mkdir(tasksDir, { recursive: true });

  const workspaceConfig = createStubWorkspaceConfig({
    overrides: {
      // The machine folder's paths, which the seeder writes into rather than
      // merely names: each chat's work folder is in it.
      workFoldersDir: AbsolutePathSchema.parse(
        path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.work),
      ),
      workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
    },
    rootDir,
    tasksDir,
  });
  // `chatDir()` and everything that writes a chat read the config from this
  // singleton rather than taking it as an argument.
  setWorkspaceConfig(workspaceConfig);
  // The writer every write to a chat goes through. The app installs it as the
  // workspace starts; a script that writes chats without a workspace has to
  // install one itself, or `ChatWrites` has no records to append to. One
  // already in place is left alone and left running: a test that installed
  // its own reads the chats back through it.
  const borrowed = writingChatRecords();
  const records =
    borrowed ??
    new ChatRecords({
      app: workspaceConfig.appVersion,
      device: workspaceConfig.deviceId,
      dirOf: chatDir,
    });
  if (borrowed === undefined) {
    installChatRecords(records);
  }

  const seeded: SeededTask[] = [];
  // A 1.x task's folder is flat under `tasks/`, which the chat index is
  // pointed at while they are seeded, so the store writes land there.
  setWorkspaceConfig({
    ...workspaceConfig,
    chatsDir: AbsolutePathSchema.parse(tasksDir),
  });
  for (const { files, session, task } of fixture.tasks) {
    const id = await seedTask({ files, now, session, task, workspaceConfig });
    if (task.pinned) {
      await pinLegacyTask(id, session.createdAt);
    }
    seeded.push({ id, key: task.key, kind: "task", name: task.name });
  }
  setWorkspaceConfig(workspaceConfig);
  for (const { chat, folders, session, tasks } of fixture.chats) {
    // A chat's parts name its tasks by session (a task event, a hand-off), so
    // each task's fresh id is settled before the chat is written.
    for (const { session: taskSession } of tasks) {
      freshIds.set(taskSession.id, StoreId.newSessionId());
    }
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
    for (const folderPath of await makeFolders({ folders, userDataDir })) {
      await grantFolder({ chatId, path: folderPath, source: "attached" });
    }
    seeded.push({ id: chatId, key: chat.key, kind: "chat", name: chat.name });
    for (const { files, session: taskSession, task } of tasks) {
      const id = await seedChatTask({
        chatId,
        files,
        now,
        session: taskSession,
        task,
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

  // Every append is flushed and the handles closed before the script ends, so
  // the folder it leaves is one the app reads rather than one mid-write. One
  // we borrowed is its owner's to close.
  if (borrowed === undefined) {
    await records.dispose();
    installChatRecords(undefined);
  }

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

/** A fixture's files, into a chat's work folder or a 1.x task's own. */
async function copyFixtureFiles({
  dir,
  files,
}: {
  dir: AbsolutePath;
  files: FixtureFile[];
}) {
  for (const file of files) {
    const destination = resolvePathWithinChatDir({
      dir,
      filePath: RelativePathSchema.parse(file.to),
    });
    if (!destination) {
      throw new Error(`"${file.to}" resolves outside the chat's folder`);
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
  userDataDir,
}: {
  folders: { files: FixtureFile[]; mount: string }[];
  userDataDir: string;
}): Promise<string[]> {
  const made: string[] = [];
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
    made.push(dir);
  }
  return made;
}

/**
 * Pins a task the way a 1.x build did, by a key in its settings file that the
 * current settings schema no longer carries: what the boot migration reads to
 * star the chat it makes. Written raw for that reason, the one place the
 * seeder writes a task file itself.
 */
async function pinLegacyTask(id: ChatId, pinnedAt: Date) {
  const file = path.join(chatDir(id), PRIVATE_FOLDER_NAME, SETTINGS_FILE_NAME);
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
 * Seeds one record: a chat's own record when `task` is a chat, which holds
 * its session as the chat's, or a task flat under `tasks/` as 1.x left one,
 * which the layout migration moves into a chat of its own at the app's next
 * boot.
 */
async function seedTask({
  files,
  now,
  session,
  task,
  workspaceConfig,
}: {
  files: FixtureFile[];
  now: Date;
  session: Session.WithMessagesAndParts;
  task: FixtureChat | FixtureChatTask | FixtureTask;
  workspaceConfig: WorkspaceConfig;
}): Promise<ChatId> {
  const isChat = "tasks" in task;
  // The fixture's own key becomes the folder name, so a seeded task has an id
  // that is readable, stable across seeds, and findable in the fixture.
  const id = newChatId({
    preferredFolderName: SubdomainPartSchema.parse(task.key),
  });

  // `newChatId` falls back to a dated name when the folder is taken, which for
  // a fixture is silent corruption rather than a convenience: the seeded id
  // stops matching the one the manifest promises and every script addressing
  // the task by name breaks. Seeding is only ever meant to run against a clean
  // directory, so say so instead of producing a workspace that looks fine.
  if (id !== task.key) {
    throw new Error(
      `${isChat ? "chats" : "tasks"}/${task.key} already exists in this workspace. Seed into an empty directory, or pass --fresh to rebuild.`,
    );
  }

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
        sessionId: chatSession.id,
      });
    } else {
      yield* seedLegacyTaskFolder({
        id,
        name: task.name,
        sessionId: chatSession.id,
        workspaceConfig,
      });
    }

    yield* ChatWrites.saveSession(chatSession, id);
    for (const message of rebased.messages) {
      yield* ChatWrites.saveMessageWithParts(message, id);
    }

    return ok(undefined);
  });
  if (result.isErr()) {
    throw result.error;
  }

  await copyFixtureFiles({
    dir: isChat ? workDir(id) : chatDir(id),
    files,
  });

  if (!isChat) {
    await keepRecordsPrivate(chatDir(id));
  }

  return id;
}

/**
 * A 1.x task's records where it kept them, in its folder's `.instrument/`,
 * which is where the boot migration reads them from. Written to the top of
 * its folder by the store, as a chat's are, then moved there.
 */
async function keepRecordsPrivate(dir: string) {
  const privateDir = path.join(dir, PRIVATE_FOLDER_NAME);
  await fs.mkdir(privateDir, { recursive: true });
  for (const name of await fs.readdir(dir)) {
    if (name === SETTINGS_FILE_NAME || name.startsWith(CHAT_DB_FILE_NAME)) {
      await fs.rename(path.join(dir, name), path.join(privateDir, name));
    }
  }
}

/**
 * Seeds a task a chat started, which is a session in the chat's store: the
 * chat's session its parent, its recorded transcript its own, and its files
 * in the chat's work folder, where a task works. Returns its session.
 */
async function seedChatTask({
  chatId,
  files,
  now,
  session,
  task,
}: {
  chatId: ChatId;
  files: FixtureFile[];
  now: Date;
  session: Session.WithMessagesAndParts;
  task: FixtureChatTask;
}): Promise<StoreId.Session> {
  const latest = Math.max(
    ...collectTimestamps(session).map((date) => date.getTime()),
  );
  const rebased = withFreshIdsAndTimes(session, {
    deltaMs: now.getTime() - task.agedMinutes * 60_000 - latest,
    title: task.name,
  });
  await addChildTask(chatId, rebased.session);
  const result = await safeTry(async function* () {
    for (const message of rebased.messages) {
      yield* ChatWrites.saveMessageWithParts(message, chatId);
    }
    return ok(undefined);
  });
  if (result.isErr()) {
    throw result.error;
  }
  await copyFixtureFiles({ dir: workDir(chatId), files });
  return rebased.session.id;
}

/**
 * A task's folder flat under `tasks/`, laid down the way 1.x made one, with
 * its settings. The app never makes one now, so it is put in this process's
 * index by hand, where the index is pointed at `tasks/`, for the store
 * writes that follow.
 */
function seedLegacyTaskFolder({
  id,
  name,
  sessionId,
  workspaceConfig,
}: {
  id: ChatId;
  name: string;
  sessionId: StoreId.Session;
  workspaceConfig: WorkspaceConfig;
}) {
  const dir = placeChat(id, sessionId);
  return ResultAsync.fromPromise(fs.mkdir(dir, { recursive: true }), (error) =>
    error instanceof Error ? error : new Error(String(error)),
  ).map(() =>
    // 1.x kept a task's name in its settings file, which the boot migration
    // reads, so the file is written raw as 1.x wrote it.
    updateJsonRecord(path.join(dir, SETTINGS_FILE_NAME), () => ({
      createdAt: new Date().toISOString(),
      createdWithAppVersion: workspaceConfig.appVersion,
      name,
    })),
  );
}

/**
 * Fresh ids for the session, its messages and its parts, plus the timestamp
 * shift. Ids are ULIDs, which sort by the time they were minted, and the store
 * orders by key -- so reusing the recorded ids would order a transcript by when
 * it was captured while its timestamps claim something else.
 */
/**
 * The fresh id each recorded session took, by the recorded one, so a part
 * naming another session (a task event, a hand-off) names the one seeded.
 */
const freshIds = new Map<string, string>();

/** A part's data with every recorded session id in it swapped for its fresh one. */
function withFreshSessionIds(value: unknown): unknown {
  if (typeof value === "string") {
    return freshIds.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map(withFreshSessionIds);
  }
  if (typeof value === "object" && value !== null && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        withFreshSessionIds(entry),
      ]),
    );
  }
  return value;
}

function withFreshIdsAndTimes(
  session: Session.WithMessagesAndParts,
  { deltaMs, title }: { deltaMs: number; title: string },
) {
  const sessionId = StoreId.SessionSchema.parse(
    freshIds.get(session.id) ?? StoreId.newSessionId(),
  );

  const messages = session.messages.map((message) => {
    const messageId = StoreId.newMessageId();
    const parts = message.parts.map(
      (part) =>
        ({
          ...part,
          ...("data" in part ? { data: withFreshSessionIds(part.data) } : {}),
          ...("output" in part && part.output
            ? { output: withFreshSessionIds(part.output) }
            : {}),
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
