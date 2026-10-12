// The committed description of a workspace, and the reader that turns it into
// something the seeder can act on.
//
// Three kinds of thing live in a fixture, and they get opposite treatment:
//
// - The manifest and the session transcripts are text, reviewable in a diff.
// - `files/` holds ordinary inert inputs (a PDF, a spreadsheet, a deliberately
//   malformed document). Nothing about them migrates, so they are committed
//   as-is rather than regenerated.
// - The task database is never committed. It is rebuilt from the above by the
//   seeder, through the app's own code paths, so it survives schema changes.

import fs from "node:fs/promises";
import path from "node:path";
import superjson from "superjson";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { RelativeTaskPathSchema } from "../../src/schemas/paths";
import { Session } from "../../src/schemas/session";
import { SubdomainPartSchema } from "../../src/schemas/subdomain-part";

const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  "../../../../fixtures/workspaces",
);

const SESSION_FILE_NAME = "session.json";
const TASK_FILES_DIR_NAME = "files";

const FixtureFileSchema = z.object({
  // Path inside the fixture's `files/` dir.
  from: RelativeTaskPathSchema,
  // Where it lands inside the seeded task, e.g. `work/report.pdf`.
  to: RelativeTaskPathSchema,
});

const FixtureChatTaskSchema = z.object({
  // Minutes between the transcript's last message and seed time. The whole
  // transcript shifts by the same amount, so recorded spacing is preserved and
  // the sidebar's relative dates ("5 minutes ago") stay put across seeds.
  // Distinct values across tasks also fix the task list's sort order.
  agedMinutes: z.number().int().min(0).default(0),
  files: FixtureFileSchema.array().default([]),
  // Doubles as the fixture's task directory name and the seeded task's id, so
  // a driving script can address a task by a name that is in the diff.
  // The chat's folders this task was handed, by mount name.
  folders: z.string().array().default([]),
  key: SubdomainPartSchema,
  name: z.string().trim().min(1),
});

// One of the user's folders a chat was granted, which the seeder makes as a
// real folder beside the workspace: where a task today hands over what it made,
// as `/mnt/<mount>/…`, rather than inside its own folder.
const FixtureFolderSchema = z.object({
  // Paths inside the chat's `files/` dir, and where each lands in the folder.
  files: FixtureFileSchema.array().default([]),
  // The name it is mounted under, as the recorded transcripts spell it, and
  // the folder's own name on disk: one path segment.
  mount: z
    .string()
    .regex(/^(?!\.{1,2}$)[^/\\]+$/, "A mount is one folder name"),
});

// A task no chat owns: what a 1.x build made, and so what boot adopts into a
// chat of its own. Kept for exercising that migration; a task that stands for
// what the app makes today belongs under a chat.
const FixtureTaskSchema = FixtureChatTaskSchema.omit({ folders: true }).extend({
  // A 1.x pin, which the migration turns into a starred chat.
  pinned: z.boolean().default(false),
});

// A chat and the tasks it started, each with its own recorded transcript. The
// tasks are seeded inside the chat, the way the chat's agent would have made
// them, and the chat's transcript names them by their keys.
const FixtureChatSchema = z.object({
  // As for a task: minutes between the chat's last message and seed time.
  agedMinutes: z.number().int().min(0).default(0),
  folders: FixtureFolderSchema.array().default([]),
  // The chat's folder name and id once seeded.
  key: SubdomainPartSchema,
  name: z.string().trim().min(1),
  starred: z.boolean().default(false),
  tasks: FixtureChatTaskSchema.array().default([]),
});

// Anything the app persists under `userData`, keyed by store file name. Only
// what a fixture actually depends on belongs here: a fixture that pins every
// setting breaks every time a default moves. Values are written verbatim and
// validated by the app's own store schemas at load, which is the only place
// that knows them.
//
// The key becomes a file name in the target directory, so it is constrained to
// one here rather than trusted to be one.
const StoreNameSchema = z
  .string()
  .regex(/^[a-z][\da-z-]*$/, "Store name must be a lowercase file name stem");

const FixtureSettingsSchema = z
  .record(StoreNameSchema, z.record(z.string(), z.unknown()))
  .default({});

const FixtureManifestSchema = z
  .object({
    chats: FixtureChatSchema.array().default([]),
    description: z.string().trim().min(1),
    settings: FixtureSettingsSchema,
    tasks: FixtureTaskSchema.array().default([]),
  })
  .refine((manifest) => manifest.chats.length + manifest.tasks.length > 0, {
    message: "A fixture declares at least one chat or task",
  });

export type FixtureChat = z.output<typeof FixtureChatSchema>;
export type FixtureChatTask = z.output<typeof FixtureChatTaskSchema>;
export type FixtureTask = z.output<typeof FixtureTaskSchema>;

export interface WorkspaceFixture {
  chats: {
    chat: FixtureChat;
    folders: { files: { from: string; to: string }[]; mount: string }[];
    session: Session.WithMessagesAndParts;
    tasks: LoadedTask<FixtureChatTask>[];
  }[];
  description: string;
  dir: string;
  name: string;
  settings: Record<string, Record<string, unknown>>;
  tasks: LoadedTask<FixtureTask>[];
}

interface LoadedTask<T> {
  files: { from: string; to: string }[];
  session: Session.WithMessagesAndParts;
  task: T;
}

/** Where a chat's transcript is recorded to and read from. */
export function fixtureChatSessionPath(fixtureName: string, chatKey: string) {
  return path.join(
    FIXTURES_DIR,
    fixtureName,
    "chats",
    chatKey,
    SESSION_FILE_NAME,
  );
}

/** Every chat and task key a fixture seeds, which are its folder names. */
export function fixtureKeys(fixture: WorkspaceFixture): string[] {
  return [
    ...fixture.tasks.map(({ task }) => task.key),
    ...fixture.chats.flatMap(({ chat, tasks }) => [
      chat.key,
      ...tasks.map(({ task }) => task.key),
    ]),
  ];
}

/**
 * Where `record-fixture-session` writes a task's transcript, and
 * `loadWorkspaceFixture` reads it: under its chat when it has one.
 */
export function fixtureSessionPath(
  fixtureName: string,
  taskKey: string,
  chatKey?: string,
) {
  return path.join(
    FIXTURES_DIR,
    fixtureName,
    ...(chatKey ? ["chats", chatKey] : []),
    "tasks",
    taskKey,
    SESSION_FILE_NAME,
  );
}

export async function listFixtureNames(): Promise<string[]> {
  const entries = await fs.readdir(FIXTURES_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function loadWorkspaceFixture(
  name: string,
): Promise<WorkspaceFixture> {
  const dir = path.join(FIXTURES_DIR, name);
  const manifestPath = path.join(dir, "manifest.yaml");

  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf8");
  } catch {
    const available = await listFixtureNames();
    throw new Error(
      `No fixture named "${name}". Available: ${available.join(", ")}`,
    );
  }

  const parsed = FixtureManifestSchema.safeParse(parseYaml(raw));
  if (!parsed.success) {
    throw new Error(
      `${manifestPath} is not a valid fixture manifest:\n${z.prettifyError(parsed.error)}`,
    );
  }
  const manifest = parsed.data;

  // One namespace: a chat and a task are both folders the record index
  // addresses by name.
  const keys = new Set<string>();
  for (const key of [
    ...manifest.tasks.map((task) => task.key),
    ...manifest.chats.flatMap((chat) => [
      chat.key,
      ...chat.tasks.map((task) => task.key),
    ]),
  ]) {
    if (keys.has(key)) {
      throw new Error(`${manifestPath} declares "${key}" twice`);
    }
    keys.add(key);
  }

  const loadTask = async <T extends FixtureChatTask | FixtureTask>(
    task: T,
    chatDir: string,
  ): Promise<LoadedTask<T>> => ({
    files: await resolveTaskFiles({ dir: chatDir, task }),
    session: await readFixtureSession(path.join(chatDir, SESSION_FILE_NAME)),
    task,
  });

  const tasks = [];
  for (const task of manifest.tasks) {
    tasks.push(await loadTask(task, path.join(dir, "tasks", task.key)));
  }

  const chats = [];
  for (const chat of manifest.chats) {
    const chatDir = path.join(dir, "chats", chat.key);
    const mounts = new Set<string>(chat.folders.map((folder) => folder.mount));
    const chatTasks = [];
    for (const task of chat.tasks) {
      const unknown = task.folders.filter((mount) => !mounts.has(mount));
      if (unknown.length > 0) {
        throw new Error(
          `${manifestPath}: task "${task.key}" is handed ${unknown.join(", ")}, which chat "${chat.key}" does not declare`,
        );
      }
      chatTasks.push(
        await loadTask(task, path.join(chatDir, "tasks", task.key)),
      );
    }
    const folders = [];
    for (const folder of chat.folders) {
      folders.push({
        files: await resolveTaskFiles({
          dir: chatDir,
          task: { files: folder.files, key: chat.key },
        }),
        mount: folder.mount,
      });
    }
    chats.push({
      chat,
      folders,
      session: await readFixtureSession(path.join(chatDir, SESSION_FILE_NAME)),
      tasks: chatTasks,
    });
  }

  return {
    chats,
    description: manifest.description,
    dir,
    name,
    settings: manifest.settings,
    tasks,
  };
}

/**
 * Transcripts are stored as superjson so the `Date` fields the session schemas
 * require survive the round trip through a text file. Parsing through the real
 * schema here rather than at save time means a transcript recorded before a
 * schema change fails at seed with a readable error, instead of producing a
 * task the app cannot open.
 */
async function readFixtureSession(
  sessionPath: string,
): Promise<Session.WithMessagesAndParts> {
  let raw: string;
  try {
    raw = await fs.readFile(sessionPath, "utf8");
  } catch {
    throw new Error(
      `Missing transcript ${sessionPath}. Record one with \`pnpm --filter @instrument-org/workspace script:record-fixture-session\`.`,
    );
  }

  const parsed = Session.WithMessagesAndPartsSchema.safeParse(
    superjson.parse(raw),
  );
  if (!parsed.success) {
    throw new Error(
      `${sessionPath} no longer matches the session schema:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

async function resolveTaskFiles({
  dir,
  task,
}: {
  dir: string;
  task: Pick<FixtureChatTask, "files" | "key">;
}) {
  const filesDir = path.join(dir, TASK_FILES_DIR_NAME);
  const files = [];

  for (const file of task.files) {
    const from = path.join(filesDir, file.from);
    try {
      await fs.access(from);
    } catch {
      throw new Error(
        `Task "${task.key}" declares ${file.from}, which is not in ${filesDir}`,
      );
    }
    files.push({ from, to: file.to });
  }

  return files;
}
