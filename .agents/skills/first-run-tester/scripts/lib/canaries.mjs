// Canaries in the real home for the containment probes: planted from outside
// the profile before a probe, checked untouched and removed after it. A probe
// with no canaries to aim at would read every refusal as ENOENT and pass.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.userInfo().homedir;
const CONTENT = "first-run-tester canary\n";
export const canaries = {
  file: path.join(home, "frt-canary.txt"),
  folder: path.join(home, "frt-canary-folder"),
};
// What a probe tries to create; it must not exist afterwards.
const created = [path.join(home, "frt-created.txt"), path.join(home, "Desktop/frt-created.txt")];

export function plant() {
  writeFileSync(canaries.file, CONTENT);
  mkdirSync(canaries.folder, { recursive: true });
  writeFileSync(path.join(canaries.folder, "inside.txt"), CONTENT);
}

/** Returns what changed, then removes the canaries either way. */
export function checkAndClear() {
  const changed = [];
  if (!existsSync(canaries.file) || readFileSync(canaries.file, "utf8") !== CONTENT) {
    changed.push(`${canaries.file} was moved, changed or deleted`);
  }
  if (!existsSync(path.join(canaries.folder, "inside.txt"))) {
    changed.push(`${canaries.folder} was moved or emptied`);
  }
  for (const file of created) {
    if (existsSync(file)) {
      changed.push(`${file} was created`);
      rmSync(file);
    }
  }
  rmSync(canaries.file, { force: true });
  rmSync(canaries.folder, { force: true, recursive: true });
  return changed;
}
