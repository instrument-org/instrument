// Build a disposable workspace from committed fixtures, for `ELECTRON_USER_DATA_DIR`.
//
//   pnpm workspace:seed --out <dir> --fixture documents
//   pnpm workspace:seed --out <dir> --fixture documents --fresh
//   pnpm workspace:seed --list
//
// Idempotent, and cheap enough to run before every boot: a workspace whose
// marker matches the fixtures' current contents is left alone. Prints a JSON
// summary on stdout (`studio-drive.mjs boot --purpose <purpose> --workspace`
// reads it), so progress goes to stderr.

import "./lib/define-globals-apply";

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { seedWorkspace } from "./lib/seed-workspace";
import {
  listFixtureNames,
  loadWorkspaceFixture,
  type WorkspaceFixture,
} from "./lib/workspace-fixture";

const MARKER_FILE_NAME = ".seeded-workspace.json";

const { values } = parseArgs({
  options: {
    fixture: { multiple: true, type: "string" },
    fresh: { default: false, type: "boolean" },
    list: { default: false, type: "boolean" },
    out: { type: "string" },
  },
});

await main();

/**
 * Two fixtures seeded together must not both want the same task folder. The
 * second would silently get a dated fallback name instead, which is exactly the
 * kind of "the id is not what the fixture says" surprise a driving script then
 * has to debug.
 */
function assertNoDuplicateTaskKeys(loaded: WorkspaceFixture[]) {
  const owners = new Map<string, string>();
  for (const fixture of loaded) {
    for (const { task } of fixture.tasks) {
      const existing = owners.get(task.key);
      if (existing) {
        throw new Error(
          `Fixtures "${existing}" and "${fixture.name}" both define task "${task.key}"`,
        );
      }
      owners.set(task.key, fixture.name);
    }
  }
}

/**
 * A content hash over everything committed for these fixtures. Cheaper and more
 * honest than an mtime check: editing a manifest or re-recording a transcript
 * has to force a reseed, and nothing else should.
 */
async function digestFixtures(loaded: WorkspaceFixture[]): Promise<string> {
  const hash = createHash("sha256");
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
      "Usage: pnpm workspace:seed --out <dir> --fixture <name> [--fixture <name>] [--fresh]",
    );
  }

  const fixtureNames = values.fixture ?? [];
  if (fixtureNames.length === 0) {
    throw new TypeError("Pass at least one --fixture (see --list)");
  }

  const userDataDir = path.resolve(values.out);
  const fixtures = await Promise.all(fixtureNames.map(loadWorkspaceFixture));

  assertNoDuplicateTaskKeys(fixtures);

  const digest = await digestFixtures(fixtures);

  const marker = await readMarker(userDataDir);
  if (!values.fresh && marker?.digest === digest) {
    process.stderr.write(`Workspace already seeded at ${userDataDir}\n`);
    report({ reused: true, tasks: marker.tasks, userDataDir });
    return;
  }

  // Anything still here was built from a description that has since changed, so
  // it goes. Seeding on top would leave the old tasks in place and hand the new
  // ones fallback folder names, which is the one thing a fixture's ids must not
  // do: they are how a driving script addresses a task.
  await removeSeededWorkspace(userDataDir);
  await fs.mkdir(userDataDir, { recursive: true });

  // Claim the directory before filling it. A seed interrupted part-way would
  // otherwise leave tasks behind with no marker, and every later run --
  // including the `--fresh` that is supposed to be the recovery -- would refuse
  // to clear a directory it could no longer tell it had created. The claim
  // carries no digest, so it never reads as a finished seed.
  await writeMarker(userDataDir, { fixtures: fixtureNames, tasks: [] });

  const tasks = [];
  for (const fixture of fixtures) {
    process.stderr.write(`Seeding ${fixture.name}...\n`);
    tasks.push(...(await seedWorkspace({ fixture, userDataDir })));
  }

  await writeMarker(userDataDir, { digest, fixtures: fixtureNames, tasks });

  report({ reused: false, tasks, userDataDir });
}

async function readMarker(dir: string) {
  try {
    const raw = await fs.readFile(path.join(dir, MARKER_FILE_NAME), "utf8");
    return JSON.parse(raw) as {
      // Absent while a seed is in flight, so an interrupted run never reads as
      // a finished one.
      digest?: string;
      tasks: { id: string; key: string; name: string }[];
    };
  } catch {
    return;
  }
}

/**
 * Only ever deletes a directory this script created. `--out` ends up in
 * `ELECTRON_USER_DATA_DIR`, and the obvious typo there is a real application
 * data directory holding someone's actual tasks.
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
  reused: boolean;
  tasks: { id: string; key: string; name: string }[];
  userDataDir: string;
}) {
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`);
}

async function writeMarker(
  dir: string,
  marker: {
    digest?: string;
    fixtures: string[];
    tasks: { id: string; key: string; name: string }[];
  },
) {
  await fs.writeFile(
    path.join(dir, MARKER_FILE_NAME),
    `${JSON.stringify({ ...marker, seededAt: new Date().toISOString() }, undefined, 2)}\n`,
  );
}
