import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { KEY_FOLDER_NAMES } from "../constants";

/**
 * Renames a folder at the workspace's top level that is one of the six a
 * person opens (`KEY_FOLDER_NAMES`) under another case, `skills/` for
 * `Skills/`, to the name the app gives it.
 *
 * Only where the file system reads both names as one folder, as macOS and
 * Windows do by default: there the app already reads and writes the folder
 * under the other case, and every step that looks for `Skills/` finds it
 * there and keeps its name, so nothing else ever corrects it. Where the two
 * names are two folders, the other one is the person's and is left alone.
 *
 * In two renames, through a free name beside it, since a rename that changes
 * only the case is not one on every file system. Synchronous; a failure
 * leaves the folder as it is and is reported, and the next launch tries
 * again.
 */
export function settleKeyFolderCase(rootDir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(rootDir);
  } catch {
    return [];
  }
  const done: string[] = [];
  for (const name of KEY_FOLDER_NAMES) {
    if (names.includes(name)) {
      continue;
    }
    const other = names.find(
      (entry) => entry.toLowerCase() === name.toLowerCase(),
    );
    if (other === undefined) {
      continue;
    }
    const from = path.join(rootDir, other);
    const to = path.join(rootDir, name);
    if (!isSameFolder(from, to)) {
      continue;
    }
    const through = path.join(rootDir, `.${name}.${randomUUID()}`);
    try {
      fs.renameSync(from, through);
      fs.renameSync(through, to);
      done.push(`renamed ${other}/ to ${name}/`);
    } catch (error) {
      done.push(`could not rename ${other}/ to ${name}/ (${String(error)})`);
    }
  }
  return done;
}

function isSameFolder(a: string, b: string) {
  try {
    const first = fs.statSync(a);
    const second = fs.statSync(b);
    return (
      first.isDirectory() &&
      first.ino === second.ino &&
      first.dev === second.dev
    );
  } catch {
    return false;
  }
}
