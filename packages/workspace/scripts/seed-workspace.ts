// Build a disposable workspace from committed fixtures, for `ELECTRON_USER_DATA_DIR`.
//
//   pnpm workspace:seed --out <dir> --fixture documents
//   pnpm workspace:seed --out <dir> --fixture documents --fresh
//   pnpm workspace:seed --out <dir> --fixture documents --check
//   pnpm workspace:seed --list
//
// Idempotent, and cheap enough to run before every boot: a workspace whose
// marker matches the fixtures' current contents and the seeder's own is left
// alone. `--home` is the folder standing for the home folder, where the
// chats' work folders and their own folders go (`<out>-home` unless named),
// which the instance booted on it gets as `INSTRUMENT_DATA_HOME`. `--check`
// changes nothing and says whether the workspace is current. Prints a JSON
// summary on stdout (`studio-drive.mjs boot --purpose <purpose> --workspace`
// reads it), so progress goes to stderr.

import "./lib/define-globals-apply";

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { type SeededTask, seedWorkspace } from "./lib/seed-workspace";
import {
  fixtureKeys,
  listFixtureNames,
  loadWorkspaceFixture,
  type WorkspaceFixture,
} from "./lib/workspace-fixture";

const MARKER_FILE_NAME = ".seeded-workspace.json";

/**
 * The seeder's own source, which decides the layout it writes: a change to it
 * has to reseed a workspace built by the one before, as a fixture's does.
 */
const SEEDER_SOURCES = [
  path.join(import.meta.dirname, "lib", "seed-workspace.ts"),
  path.join(import.meta.dirname, "lib", "workspace-fixture.ts"),
];

const { values } = parseArgs({
  options: {
    check: { default: false, type: "boolean" },
    fixture: { multiple: true, type: "string" },
    fresh: { default: false, type: "boolean" },
    home: { type: "string" },
    list: { default: false, type: "boolean" },
    out: { type: "string" },
  },
});

await main();

/**
 * Two fixtures seeded together must not both want the same chat or task folder. The
 * second would silently get a dated fallback name instead, which is exactly the
 * kind of "the id is not what the fixture says" surprise a driving script then
 * has to debug.
 */
function assertNoDuplicateTaskKeys(loaded: WorkspaceFixture[]) {
  const owners = new Map<string, string>();
  for (const fixture of loaded) {
    for (const key of fixtureKeys(fixture)) {
      const existing = owners.get(key);
      if (existing) {
        throw new Error(
          `Fixtures "${existing}" and "${fixture.name}" both define "${key}"`,
        );
      }
      owners.set(key, fixture.name);
    }
  }
}

/**
 * A content hash over everything committed for these fixtures and the
 * seeder's own source. Cheaper and more honest than an mtime check: editing a
 * manifest, re-recording a transcript or changing what the seeder writes has
 * to force a reseed, and nothing else should.
 */
async function digestFixtures(loaded: WorkspaceFixture[]): Promise<string> {
  const hash = createHash("sha256");
  for (const file of SEEDER_SOURCES) {
    hash.update(await fs.readFile(file));
  }
  for (const fixture of loaded) {
    hash.update(fixture.name);
    for (const file of await listFilesRecursively(fixture.dir)) {
      hash.update(path.relative(fixture.dir, file));
      hash.update(await fs.readFile(file));
    }
  }
  return hash.digest("hex");
}

async function listFilesRecursively(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

async function main() {
  if (values.list) {
    for (const name of await listFixtureNames()) {
      const fixture = await loadWorkspaceFixture(name);
      process.stdout.write(`${name}\t${fixture.description}\n`);
    }
    return;
  }

  if (!values.out) {
    throw new TypeError(
      "Usage: pnpm workspace:seed --out <dir> --fixture <name> [--fixture <name>] [--home <dir>] [--fresh | --check]",
    );
  }

  const fixtureNames = values.fixture ?? [];
  if (fixtureNames.length === 0) {
    throw new TypeError("Pass at least one --fixture (see --list)");
  }

  const userDataDir = path.resolve(values.out);
  const home = path.resolve(values.home ?? `${userDataDir}-home`);
  const fixtures = await Promise.all(fixtureNames.map(loadWorkspaceFixture));

  assertNoDuplicateTaskKeys(fixtures);

  const digest = await digestFixtures(fixtures);

  const marker = await readMarker(userDataDir);
  const current = marker?.digest === digest && marker.home === home;
  if (values.check) {
    report({ current, home, tasks: marker?.tasks ?? [], userDataDir });
    return;
  }
  if (!values.fresh && current) {
    process.stderr.write(`Workspace already seeded at ${userDataDir}\n`);
    report({ home, reused: true, tasks: marker.tasks, userDataDir });
    return;
  }

  // Anything still here was built from a description that has since changed, so
  // it goes. Seeding on top would leave the old tasks in place and hand the new
  // ones fallback folder names, which is the one thing a fixture's ids must not
  // do: they are how a driving script addresses a task.
  await removeSeededWorkspace(userDataDir);
  await removeSeededWorkspace(home);
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.mkdir(home, { recursive: true });

  // Claim the directory before filling it. A seed interrupted part-way would
  // otherwise leave tasks behind with no marker, and every later run --
  // including the `--fresh` that is supposed to be the recovery -- would refuse
  // to clear a directory it could no longer tell it had created. The claim
  // carries no digest, so it never reads as a finished seed.
  await writeMarker(userDataDir, { fixtures: fixtureNames, home, tasks: [] });
  await writeMarker(home, { fixtures: fixtureNames, home, tasks: [] });

  const tasks = [];
  for (const fixture of fixtures) {
    process.stderr.write(`Seeding ${fixture.name}...\n`);
    tasks.push(...(await seedWorkspace({ fixture, home, userDataDir })));
  }

  await writeMarker(userDataDir, {
    digest,
    fixtures: fixtureNames,
    home,
    tasks,
  });

  report({ home, reused: false, tasks, userDataDir });
}

async function readMarker(dir: string) {
  try {
    const raw = await fs.readFile(path.join(dir, MARKER_FILE_NAME), "utf8");
    return JSON.parse(raw) as {
      // Absent while a seed is in flight, so an interrupted run never reads as
      // a finished one.
      digest?: string;
      home?: string;
      tasks: SeededTask[];
    };
  } catch {
    return;
  }
}

/**
 * Only ever deletes a directory this script created, which it marks first.
 * `--out` ends up in `ELECTRON_USER_DATA_DIR` and `--home` in
 * `INSTRUMENT_DATA_HOME`, and the obvious typo in either is a real folder
 * holding someone's actual work.
 */
async function removeSeededWorkspace(dir: string) {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }

  if (entries.length > 0 && !entries.includes(MARKER_FILE_NAME)) {
    throw new Error(
      `Refusing to clear ${dir}: it has contents but no ${MARKER_FILE_NAME}, so this script did not create it.`,
    );
  }

  await fs.rm(dir, { force: true, recursive: true });
}

function report(result: {
  /** For `--check`: whether the workspace is what a seed would build now. */
  current?: boolean;
  home: string;
  reused?: boolean;
  tasks: SeededTask[];
  userDataDir: string;
}) {
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`);
}

async function writeMarker(
  dir: string,
  marker: {
    digest?: string;
    fixtures: string[];
    home: string;
    tasks: SeededTask[];
  },
) {
  await fs.writeFile(
    path.join(dir, MARKER_FILE_NAME),
    `${JSON.stringify({ ...marker, seededAt: new Date().toISOString() }, undefined, 2)}\n`,
  );
}
