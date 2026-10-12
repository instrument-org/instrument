import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { type WorkspaceConfig } from "../types";
import { pathExists } from "./path-exists";
import { BUNDLED_SOURCE_IDS, getSkillSources } from "./skills";

/**
 * Copies the skills the app ships into `preparedSkillsDir`, the one folder
 * the `/skills/instrument/` mount reads them from: the app bundle is signed
 * and replaced whole by the updater, so nothing reads from it in place.
 *
 * Copied fresh at every launch, a few megabytes, so the folder always holds
 * the build that is running and a skill dropped from the app is gone from
 * it. The copy is made beside the folder and swapped in, so an agent shell
 * reading the folder meanwhile sees the whole old set or the whole new one.
 * Where two bundled sources hold a skill of one name, the first source wins,
 * as it does when a task loads one.
 */
export async function prepareBundledSkills(
  config: Pick<
    WorkspaceConfig,
    "preparedSkillsDir" | "registryDir" | "rootDir" | "systemSkillsDir"
  >,
): Promise<void> {
  const target = config.preparedSkillsDir;
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
      await cp(
        path.join(source.dir, entry.name),
        path.join(staging, entry.name),
        {
          dereference: true,
          recursive: true,
        },
      );
    }
  }

  if (await pathExists(target)) {
    await rename(target, previous);
  }
  await rename(staging, target);
  await rm(previous, { force: true, recursive: true });
}
