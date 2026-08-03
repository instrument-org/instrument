// Builds a workspace on disk from a committed fixture description.
//
// Everything here goes through the workspace's own libraries -- `initializeTask`
// for the directory, `Store` for the conversation -- rather than writing task
// files directly. That is deliberate and load-bearing: task storage is moving
// (see docs/plans/active/user-chosen-working-folder.md and
// conversation-storage.md), and a seeder that lays out `tasks/<id>/.instrument`
// itself would keep producing plausible-looking workspaces the app can no longer
// read. Reach for a library or a route; never for `fs.writeFile` into a task.
//
// Recorded transcripts are inserted as they were captured rather than re-run
// through the agent loop. `workspace.debug.replaySession` re-executes each tool
// call, which needs the whole runtime (bash sandbox, browser, model) and makes
// the result depend on it. Seeding has to work in CI with no provider
// credentials and finish in seconds, so the recorded tool outputs stand, and
// the artifacts a tool would have written come from the fixture's `files/`.

import { ok, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { TASKS_DIR_NAME } from "../../src/constants";
import { initializeTask } from "../../src/lib/initialize-task";
import { newTaskId } from "../../src/lib/new-task-id";
import { resolvePathWithinTaskDir } from "../../src/lib/resolve-path-within-task-dir";
import { disposeSessionsStoreStorage } from "../../src/lib/session-store-storage";
import { Store } from "../../src/lib/store";
import { taskDir } from "../../src/lib/task-dir-utils";
import { updateTaskSettings } from "../../src/lib/task-settings";
import { setWorkspaceConfig } from "../../src/lib/workspace-config";
import {
  AbsolutePathSchema,
  RelativePathSchema,
} from "../../src/schemas/paths";
import { type Session } from "../../src/schemas/session";
import { type SessionMessage } from "../../src/schemas/session/message";
import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { StoreId } from "../../src/schemas/store-id";
import { SubdomainPartSchema } from "../../src/schemas/subdomain-part";
import { type TaskId } from "../../src/schemas/task-id";
import { type WorkspaceConfig } from "../../src/types";
import { createStubWorkspaceConfig } from "./stub-workspace-config";
import { type FixtureTask, type WorkspaceFixture } from "./workspace-fixture";

const DEFAULT_TASK_TEMPLATE_DIR = path.resolve(
  import.meta.dirname,
  "../../templates/default",
);

export interface SeededTask {
  id: TaskId;
  key: string;
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
    seeded.push({ id, key: task.key, name: task.name });
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
  task: FixtureTask;
  workspaceConfig: WorkspaceConfig;
}): Promise<TaskId> {
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
      `tasks/${task.key} already exists in this workspace. Seed into an empty directory, or pass --fresh to rebuild.`,
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

  const result = await safeTry(async function* () {
    yield* await initializeTask(
      { initialSettings: { name: task.name }, taskId: id, workspaceConfig },
      {},
    );

    yield* Store.saveSession(rebased.session, id);
    for (const message of rebased.messages) {
      yield* Store.saveMessageWithParts(message, id);
    }

    if (task.pinned) {
      yield* updateTaskSettings(id, { pinnedAt: rebased.session.createdAt });
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
    await fs.writeFile(
      path.join(userDataDir, `${store}.json`),
      `${JSON.stringify(values, undefined, 2)}\n`,
    );
  }
}
