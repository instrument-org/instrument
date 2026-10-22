import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { type AbsolutePath, AbsolutePathSchema } from "../schemas/paths";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { pathExists } from "./path-exists";
import { runtimeLayout } from "./runtime-dir";
import { BUNDLED_SOURCE_IDS, getSkillSources } from "./skills";

type PreparedSkillsConfig = Pick<
  WorkspaceConfig,
  "registryDir" | "rootDir" | "runtimeDir" | "systemSkillsDir"
>;

/** The latest preparation, which the next one waits for. */
let latest: Promise<void> = Promise.resolve();

/**
 * Copies the skills the app ships into the runtime folder's `skills/`, the
 * one folder the bundled skills mount reads them from: the app bundle is
 * signed and replaced whole by the updater, so nothing reads from it in place.
 *
 * Copied fresh at every launch, as copy-on-write clones where the file
 * system makes them (`copySkill`), so the folder always holds the build
 * that is running and a skill dropped from the app is gone from
 * it. The copy is made beside the folder and swapped in, so an agent shell
 * reading the folder meanwhile sees the whole old set or the whole new one.
 * Where two bundled sources hold a skill of one name, the first source wins,
 * as it does when a task loads one.
 */
export function prepareBundledSkills(
  config: PreparedSkillsConfig,
): Promise<void> {
  // One at a time: two would build in the same staging folder.
  const run = latest.catch(() => undefined).then(() => prepare(config));
  latest = run;
  return run;
}

/**
 * Where a skill the app ships is read: its folder in the runtime folder's
 * `skills/`, once the preparation running now has put it there, or made
 * now where none has (a first use racing the launch's, a test), or
 * undefined where it could not be made.
 */
export async function preparedBundledSkill(
  config: PreparedSkillsConfig,
  name: string,
): Promise<AbsolutePath | undefined> {
  const dir = AbsolutePathSchema.parse(
    path.join(runtimeLayout(config.runtimeDir).skills, name),
  );
  await latest.catch(() => undefined);
  if (!(await pathExists(absolutePathJoin(dir, "SKILL.md")))) {
    await prepareBundledSkills(config).catch(() => undefined);
  }
  return (await pathExists(dir)) ? dir : undefined;
}

async function prepare(config: PreparedSkillsConfig): Promise<void> {
  const target = AbsolutePathSchema.parse(
    runtimeLayout(config.runtimeDir).skills,
  );
  // Named for this process, so two instances sharing a machine's folder
  // never build into the same one.
  const staging = `${target}.preparing-${process.pid}`;
  const previous = `${target}.previous-${process.pid}`;
  await rm(staging, { force: true, recursive: true });
  await mkdir(staging, { recursive: true });

  const bundled = getSkillSources(config).filter((source) =>
    BUNDLED_SOURCE_IDS.has(source.id),
  );
  const copied = new Set<string>();
  for (const source of bundled) {
    const entries = await readdir(source.dir, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (!entry.isDirectory() || copied.has(entry.name)) {
        continue;
      }
      copied.add(entry.name);
      await copySkill(
        path.join(source.dir, entry.name),
        path.join(staging, entry.name),
      );
    }
  }

  if (await pathExists(target)) {
    await rename(target, previous);
  }
  await rename(staging, target);
  await rm(previous, { force: true, recursive: true });
}

/**
 * A skill folder copied with its links followed, as clones that share the
 * source's blocks until either side changes: a development build's skills
 * carry their own virtualenvs and packages, a gigabyte copied at every
 * launch otherwise. Node's clone flag is a plain copy on macOS, so there
 * `cp -c` makes them, which copies where the volume cannot clone. Elsewhere
 * the flag clones where the file system can and copies where it cannot.
 */
async function copySkill(from: string, to: string): Promise<void> {
  if (process.platform === "darwin") {
    try {
      await promisify(execFile)("/bin/cp", ["-cRL", from, to]);
      return;
    } catch {
      await rm(to, { force: true, recursive: true });
    }
  }
  await cp(from, to, {
    dereference: true,
    mode: constants.COPYFILE_FICLONE,
    recursive: true,
  });
}
