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
  // Where it lands inside the seeded task, e.g. `output/report.pdf`.
  to: RelativeTaskPathSchema,
});

const FixtureTaskSchema = z.object({
  // Minutes between the transcript's last message and seed time. The whole
  // transcript shifts by the same amount, so recorded spacing is preserved and
  // the sidebar's relative dates ("5 minutes ago") stay put across seeds.
  // Distinct values across tasks also fix the task list's sort order.
  agedMinutes: z.number().int().min(0).default(0),
  files: FixtureFileSchema.array().default([]),
  // Doubles as the fixture's task directory name and the seeded task's id, so
  // a driving script can address a task by a name that is in the diff.
  key: SubdomainPartSchema,
  name: z.string().trim().min(1),
  pinned: z.boolean().default(false),
});

// Anything the app persists under `userData`, keyed by store file name. Only
// what a fixture actually depends on belongs here: a fixture that pins every
// setting breaks every time a default moves. Values are written verbatim and
// validated by the app's own store schemas at load, which is the only place
// that knows them.
const FixtureSettingsSchema = z
  .record(z.string(), z.record(z.string(), z.unknown()))
  .default({});

const FixtureManifestSchema = z.object({
  description: z.string().trim().min(1),
  settings: FixtureSettingsSchema,
  tasks: FixtureTaskSchema.array().min(1),
});

export type FixtureTask = z.output<typeof FixtureTaskSchema>;

export interface WorkspaceFixture {
  description: string;
  dir: string;
  name: string;
  settings: Record<string, Record<string, unknown>>;
  tasks: {
    files: { from: string; to: string }[];
    session: Session.WithMessagesAndParts;
    task: FixtureTask;
  }[];
}

/** Where `record-fixture-session` writes, and `loadWorkspaceFixture` reads. */
export function fixtureSessionPath(fixtureName: string, taskKey: string) {
  return path.join(
    FIXTURES_DIR,
    fixtureName,
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

  const keys = new Set<string>();
  for (const task of manifest.tasks) {
    if (keys.has(task.key)) {
      throw new Error(`${manifestPath} declares task "${task.key}" twice`);
    }
    keys.add(task.key);
  }

  const tasks = [];
  for (const task of manifest.tasks) {
    const taskDir = path.join(dir, "tasks", task.key);
    tasks.push({
      files: await resolveTaskFiles({ dir: taskDir, task }),
      session: await readFixtureSession(path.join(taskDir, SESSION_FILE_NAME)),
      task,
    });
  }

  return {
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
  task: FixtureTask;
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
