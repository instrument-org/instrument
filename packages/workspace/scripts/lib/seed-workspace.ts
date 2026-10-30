// Builds a workspace on disk from a committed fixture description.
//
// Everything here goes through the workspace's own libraries -- `placeChat`
// for the directory, `ChatWrites` for the conversation -- rather than writing chat
// files directly. That is deliberate and load-bearing: task storage is moving
// (see docs/plans/user-chosen-working-folder.md and
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
} from "@instrument-org/shared";
import { ok, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { LEGACY_TASK_DB_FILE_NAME, TASKS_DIR_NAME } from "../../src/constants";
import { resolvePathWithinChatDir } from "../../src/lib/resolve-path-within-chat-dir";
import { ChatWrites } from "../../src/lib/chat-writes";
import {
  ChatRecords,
  installChatRecords,
  writingChatRecords,
} from "../../src/lib/records/chat-records";
import { writeDeviceFile } from "../../src/lib/records/device-file";
import { chatDir, chatIdTaken, placeChat } from "../../src/lib/record-folders";
import { workDir } from "../../src/lib/work-dir";
import { updateJsonRecord } from "../../src/lib/json-record-file";
import { addChildTask } from "../../src/lib/chat/children";
import { grantFolder } from "../../src/lib/chat/grants";
import { WORKSPACE_LAYOUT_VERSION } from "../../src/lib/migrate-workspace-layout";
import { StorageKey } from "../../src/lib/storage-key";
import { writeStoreRowsSync } from "../../src/lib/store-table";
import { claimWorkFolders } from "../../src/lib/work-folders";
import { setWorkspaceConfig } from "../../src/lib/workspace-config";
import { workspaceLayout } from "../../src/lib/workspace-layout";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  RelativePathSchema,
} from "../../src/schemas/paths";
import { type Session } from "../../src/schemas/session";
import { type SessionMessage } from "../../src/schemas/session/message";
import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { StoreId } from "../../src/schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../src/schemas/chat-id";
import { type WorkspaceConfig } from "../../src/types";
import { createStubWorkspaceConfig } from "./stub-workspace-config";
import {
  type FixtureChat,
  type FixtureChatTask,
  type FixtureTask,
  type WorkspaceFixture,
} from "./workspace-fixture";

/**
 * The local id the app gives the first workspace on a computer, which names
 * its machine folder, `<userData>/machine/default/` (`DEFAULT_WORKSPACE_ID`
 * in Studio's `workspaces.ts`).
 */
const DEFAULT_WORKSPACE_ID = "default";

/** What the seeding device calls itself to every reader of the workspace. */
const SEEDER_DEVICE_NAME = "Fixture seeder";

export interface SeededTask {
  /** The chat it is inside, for a task a chat started. */
  chat?: ChatId;
  /**
   * A chat's id, a task's session in its chat's store, or for a 1.x task,
   * its folder's name until the launch makes it a chat.
   */
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
 * `userDataDir` is what `ELECTRON_USER_DATA_DIR` will point at and `home` what
 * `INSTRUMENT_DATA_HOME` will, so the layout written here has to be the one
 * the app expects to find: the workspace under `workspace/`, its machine
 * folder at `machine/default/`, each chat's work folder in the workspace's
 * folder under `home`'s data folder, settled the way a launch settles it
 * (`claimWorkFolders`), and the chat's own folders in `home`, outside the
 * app's data, as a person's folders are.
 */
export async function seedWorkspace({
  fixture,
  home,
  now = new Date(),
  userDataDir,
}: {
  fixture: WorkspaceFixture;
  home: string;
  now?: Date;
  userDataDir: string;
}): Promise<SeededTask[]> {
  if (fixture.tasks.length > 0 && fixture.chats.length > 0) {
    // A 1.x workspace is swept into this build's layout at launch, and the
    // sweep reads every chat it finds as one an earlier build left.
    throw new Error(
      `${fixture.name} has both 1.x tasks and chats, which no workspace holds at once. Make them two fixtures.`,
    );
  }
  const rootDir = path.join(userDataDir, "workspace");
  const tasksDir = path.join(rootDir, TASKS_DIR_NAME);
  const machineDir = path.join(userDataDir, "machine", DEFAULT_WORKSPACE_ID);

  await fs.mkdir(tasksDir, { recursive: true });

  const { workFoldersDir } = claimWorkFolders({
    home,
    label: () => fixture.name,
    machineDir,
    // Minted by the app's first launch on the workspace, after this.
    workspaceId: () => undefined,
  });

  const workspaceConfig = createStubWorkspaceConfig({
    overrides: {
      // The machine folder's paths, which the seeder writes into rather than
      // merely names: the chats' folder grants are in it.
      userDataDir: AbsolutePathSchema.parse(userDataDir),
      workFoldersDir: AbsolutePathSchema.parse(workFoldersDir),
      workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
    },
    rootDir,
    tasksDir,
  });
  // `chatDir()` and everything that writes a chat read the config from this
  // singleton rather than taking it as an argument.
  setWorkspaceConfig(workspaceConfig);

  const seeded: SeededTask[] = [];
  for (const { files, session, task } of fixture.tasks) {
    seeded.push(
      await seedLegacyTask({
        files,
        now,
        session,
        task,
        tasksDir,
        workspaceConfig,
      }),
    );
  }

  if (fixture.chats.length > 0) {
    seeded.push(
      ...(await seedChats({ fixture, home, now, rootDir, workspaceConfig })),
    );
  }

  await writeSettings({ machineDir, settings: fixture.settings });

  return seeded;
}

/**
 * Seeds the fixture's chats through the records writer, and marks the
 * workspace as already in this build's layout: the launch's layout sweep
 * reads a chat in a workspace below it as one an earlier build left, and
 * takes its records for its work.
 */
async function seedChats({
  fixture,
  home,
  now,
  rootDir,
  workspaceConfig,
}: {
  fixture: WorkspaceFixture;
  home: string;
  now: Date;
  rootDir: string;
  workspaceConfig: WorkspaceConfig;
}): Promise<SeededTask[]> {
  await updateJsonRecord(
    path.join(workspaceLayout(rootDir).dataDir, "workspace.json"),
    () => ({
      layoutVersion: WORKSPACE_LAYOUT_VERSION,
      legacyProjectsMigrated: true,
    }),
  );

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
  // Every reader of the workspace names a record's device by this.
  await writeDeviceFile({
    device: records.device,
    devicesDir: workspaceLayout(rootDir).devicesDir,
    file: { name: SEEDER_DEVICE_NAME, platform: process.platform },
  });

  const seeded: SeededTask[] = [];
  for (const { chat, folders, session, tasks } of fixture.chats) {
    // A chat's parts name its tasks by session (a task event, a hand-off), so
    // each task's fresh id is settled before the chat is written.
    for (const { session: taskSession } of tasks) {
      freshIds.set(taskSession.id, StoreId.newSessionId());
    }
    const chatId = await seedChat({ chat, now, session });
    for (const folderPath of await makeFolders({ folders, home })) {
      await grantFolder({ chatId, path: folderPath, source: "attached" });
    }
    seeded.push({ id: chatId, key: chat.key, kind: "chat", name: chat.name });
    for (const { files, session: taskSession, task } of tasks) {
      const id = await seedChatTask({
        chatId,
        chatSession: session,
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
 * Makes a chat's folders in `home`, where a person's own folders are, with
 * their files, and returns them as the grants the chat holds. Outside the
 * app's data, which the app's viewers refuse.
 */
async function makeFolders({
  folders,
  home,
}: {
  folders: { files: FixtureFile[]; mount: string }[];
  home: string;
}): Promise<string[]> {
  const made: string[] = [];
  for (const folder of folders) {
    const dir = path.join(home, folder.mount);
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

/** The transcript with fresh ids, shifted so it ends `agedMinutes` before now. */
function rebased(
  session: Session.WithMessagesAndParts,
  { agedMinutes, name, now }: { agedMinutes: number; name: string; now: Date },
) {
  const latest = Math.max(
    ...collectTimestamps(session).map((date) => date.getTime()),
  );
  return withFreshIdsAndTimes(session, {
    deltaMs: now.getTime() - agedMinutes * 60_000 - latest,
    title: name,
  });
}

/**
 * Seeds a chat: its folder among the chats, named by the fixture's key, and
 * its own session written first, so the log's header carries the session's
 * recorded start rather than the moment it was seeded.
 */
async function seedChat({
  chat,
  now,
  session,
}: {
  chat: FixtureChat;
  now: Date;
  session: Session.WithMessagesAndParts;
}): Promise<ChatId> {
  const id = ChatIdSchema.parse(chat.key);
  const { messages, session: fresh } = rebased(session, {
    agedMinutes: chat.agedMinutes,
    name: chat.name,
    now,
  });
  const chatSession: Session.Type = {
    ...fresh,
    ...(chat.starred ? { starredAt: fresh.createdAt } : {}),
    // Named by the manifest, so the app never renames it.
    titleSettledAt: fresh.createdAt,
  };

  // The fixture's own key is the folder name, so a seeded chat has an id
  // that is readable, stable across seeds, and findable in the fixture.
  // Seeding is only ever meant to run against a clean directory, so a
  // folder already there is said rather than given another name.
  const taken = chatIdTaken(id);
  try {
    const dir = placeChat(id, chatSession.id);
    await fs.mkdir(path.dirname(dir), { recursive: true });
    await fs.mkdir(dir);
  } catch (error) {
    if (
      taken ||
      (error instanceof Error && "code" in error && error.code === "EEXIST")
    ) {
      throw new Error(
        `chats/${chat.key} already exists in this workspace. Seed into an empty directory, or pass --fresh to rebuild.`,
        { cause: error },
      );
    }
    throw error;
  }

  const result = await safeTry(async function* () {
    yield* ChatWrites.saveSession(chatSession, id);
    for (const message of messages) {
      yield* ChatWrites.saveMessageWithParts(message, id);
    }
    return ok(undefined);
  });
  if (result.isErr()) {
    throw result.error;
  }
  return id;
}

/**
 * Seeds a task a chat started, which is a session in the chat's store: the
 * chat's session its parent, forked at the chat's last message before the
 * task started, so it reads the chat's messages up to there as its history,
 * its recorded transcript its own, and its files in the chat's work folder,
 * where a task works. Returns its session.
 */
async function seedChatTask({
  chatId,
  chatSession,
  files,
  now,
  session,
  task,
}: {
  chatId: ChatId;
  /** The chat's recorded session, to find where the task forked from it. */
  chatSession: Session.WithMessagesAndParts;
  files: FixtureFile[];
  now: Date;
  session: Session.WithMessagesAndParts;
  task: FixtureChatTask;
}): Promise<StoreId.Session> {
  const { messages, session: fresh } = rebased(session, {
    agedMinutes: task.agedMinutes,
    name: task.name,
    now,
  });
  const forkedAt = chatSession.messages.findLast(
    (message) =>
      message.metadata.createdAt.getTime() <= session.createdAt.getTime(),
  );
  const forkedAtMessageId =
    forkedAt === undefined ? undefined : freshMessageIds.get(forkedAt.id);
  await addChildTask(chatId, {
    ...fresh,
    ...(forkedAtMessageId === undefined
      ? {}
      : {
          forkedAtMessageId: StoreId.MessageSchema.parse(forkedAtMessageId),
        }),
  });
  const result = await safeTry(async function* () {
    for (const message of messages) {
      yield* ChatWrites.saveMessageWithParts(message, chatId);
    }
    return ok(undefined);
  });
  if (result.isErr()) {
    throw result.error;
  }
  await copyFixtureFiles({ dir: workDir(chatId), files });
  return fresh.id;
}

/**
 * A 1.x task as 1.x left it, flat under `tasks/`: its conversation in the
 * `task.db` of its `.instrument/`, the store's rows as the boot migration
 * reads them (`migrate-legacy-tasks.ts`), its settings beside it, and its
 * files in its own folder. The launch makes it a chat under a name of its
 * own, so its key names only its folder here.
 */
async function seedLegacyTask({
  files,
  now,
  session,
  task,
  tasksDir,
  workspaceConfig,
}: {
  files: FixtureFile[];
  now: Date;
  session: Session.WithMessagesAndParts;
  task: FixtureTask;
  tasksDir: string;
  workspaceConfig: WorkspaceConfig;
}): Promise<SeededTask> {
  const dir = path.join(tasksDir, task.key);
  try {
    await fs.mkdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        `tasks/${task.key} already exists in this workspace. Seed into an empty directory, or pass --fresh to rebuild.`,
        { cause: error },
      );
    }
    throw error;
  }
  const privateDir = path.join(dir, PRIVATE_FOLDER_NAME);
  await fs.mkdir(privateDir, { recursive: true });

  const { messages, session: fresh } = rebased(session, {
    agedMinutes: task.agedMinutes,
    name: task.name,
    now,
  });
  const rows: [string, unknown][] = [[StorageKey.session(fresh.id), fresh]];
  for (const { parts, ...message } of messages) {
    rows.push([StorageKey.message(fresh.id, message.id), message]);
    for (const part of parts) {
      rows.push([
        StorageKey.part(fresh.id, message.id, part.metadata.id),
        part,
      ]);
    }
  }
  writeStoreRowsSync(path.join(privateDir, LEGACY_TASK_DB_FILE_NAME), rows);

  // 1.x kept a task's name, its start and a pin in its settings file, which
  // the boot migration reads; the current settings schema carries none of
  // them, so the file is written as 1.x wrote it.
  await updateJsonRecord(path.join(privateDir, SETTINGS_FILE_NAME), () => ({
    createdAt: fresh.createdAt.toISOString(),
    createdWithAppVersion: workspaceConfig.appVersion,
    name: task.name,
    ...(task.pinned ? { pinnedAt: fresh.createdAt.toISOString() } : {}),
  }));

  await copyFixtureFiles({
    dir: AbsolutePathSchema.parse(dir),
    files,
  });

  return {
    id: ChatIdSchema.parse(task.key),
    key: task.key,
    kind: "task",
    name: task.name,
  };
}

/**
 * The fresh id each recorded session took, by the recorded one, so a part
 * naming another session (a task event, a hand-off) names the one seeded.
 */
const freshIds = new Map<string, string>();

/**
 * The fresh id each recorded message took, by the recorded one, so a task
 * names the message of its chat it forked at.
 */
const freshMessageIds = new Map<string, string>();

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
  const sessionId = StoreId.SessionSchema.parse(
    freshIds.get(session.id) ?? StoreId.newSessionId(),
  );

  const messages = session.messages.map((message) => {
    const messageId = StoreId.newMessageId();
    freshMessageIds.set(message.id, messageId);
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
 * The workspace's stores the fixture pins, each `<store>.json` in its machine
 * folder, where the app reads a workspace's preferences, flags and state.
 * Written verbatim: the schemas that know these keys live in Studio, and the
 * app re-validates on load with a default for anything missing or wrong. So
 * a fixture pins what it depends on and inherits the rest, which is what
 * keeps it from breaking every time a default moves.
 */
async function writeSettings({
  machineDir,
  settings,
}: {
  machineDir: string;
  settings: Record<string, Record<string, unknown>>;
}) {
  for (const [store, values] of Object.entries(settings)) {
    // Merged rather than replaced: seeding several fixtures into one workspace
    // runs this once per fixture, and writing the whole file each time would
    // leave only the last fixture's keys.
    await updateJsonRecord(
      path.join(machineDir, `${store}.json`),
      () => values,
    );
  }
}
