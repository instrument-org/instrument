import fs from "node:fs";
import path from "node:path";

import { type DeviceId } from "../../schemas/device-id";
import {
  PROJECT_FILE_NAME,
  PROJECTS_FOLDER_NAME,
  readProjectsSync,
} from "../chat/projects";
import {
  listedFolderPaths,
  withoutFrontMatterKeys,
} from "../chat/project-file";
import { readJsonRecordSync, updateJsonRecordSync } from "../json-record-file";
import { rewriteFileSync } from "../rewrite-file";
import { permissionSettingsOf, permissionsFileIn } from "./rules";
import { addedProjectFolders } from "./project-folders";

/**
 * The mark in this computer's permission settings that the folders a project's
 * `AGENTS.md` listed were taken in here. Outside the settings' schema, so no
 * write of the settings, a reset included, drops it. Spelled as the build
 * that called projects topics wrote it: every computer that ran one holds
 * it under this name, and one that missed it would take in whatever a
 * project's file lists again.
 */
const MOVED_MARK = "topicFoldersMoved";

/**
 * Brings the folders granted under each project out of its `AGENTS.md` and into
 * this computer's permission settings, once per computer.
 *
 * Builds before this wrote them as front matter. The file travels with the
 * workspace, so a grant made on one computer opened the same-named path on
 * another, and where the workspace is the person's own folder the agent can
 * write the file, which widened what every chat under the project reaches
 * without a card.
 *
 * Only on a computer where a build before this one kept permission
 * settings for the workspace: a computer opening it for the first time with
 * this build takes in nothing, whatever the files list.
 *
 * Once, and never again: a `folders:` key in an `AGENTS.md` after this is a
 * key the build does not read, whoever wrote it, so an edit to the file
 * never opens a folder. What is held here already is kept, with the file's
 * folders after it.
 *
 * The key is then taken out of each file, after the settings hold it, so a
 * crash between the two leaves a key nothing reads rather than a grant lost.
 * Another computer that has not moved them yet finds the file without them
 * and asks again before opening any of them, which is the right answer for
 * folders granted on a different computer.
 */
export function moveProjectFolders({
  device,
  machineDir,
  rootDir,
}: {
  /** The device a project's record is written as; the running workspace's when left out. */
  device?: DeviceId;
  machineDir: string;
  rootDir: string;
}): { moved: number } {
  const file = permissionsFileIn(machineDir);
  if (markedWhereNoSettings(machineDir)) {
    return { moved: 0 };
  }
  const read = readJsonRecordSync(file);
  if (read.kind === "read" && read.record[MOVED_MARK] === true) {
    return { moved: 0 };
  }
  const listing = readProjectsSync(rootDir, { device }).flatMap((project) => {
    if (project.others === undefined || !("folders" in project.others)) {
      return [];
    }
    return [{ paths: listedFolderPaths(project.others.folders), project }];
  });
  updateJsonRecordSync(file, (record) => {
    let projects = permissionSettingsOf(record).projects;
    for (const { paths, project } of listing) {
      projects = addedProjectFolders(projects, project.id, paths, new Date());
    }
    return { [MOVED_MARK]: true, projects };
  });
  for (const { project } of listing) {
    stripKeySync(
      path.join(rootDir, PROJECTS_FOLDER_NAME, project.name, PROJECT_FILE_NAME),
    );
  }
  return {
    moved: listing.filter(({ paths }) => paths.length > 0).length,
  };
}

/**
 * Writes the mark where this computer has no permission settings for the
 * workspace, and says whether it did.
 *
 * No settings means no build before this one ran the workspace here, so the
 * folders a project's file lists were granted somewhere else, or written by
 * the agent: none is taken in, and the files are left alone for the computer
 * that granted them to take in its own.
 *
 * A launch calls this before any step that can write the settings, since a
 * step that carries a chat's grants or a 1.x project's folders makes the file,
 * and a file made at this launch would read as one a build before left.
 */
export function markedWhereNoSettings(machineDir: string): boolean {
  const file = permissionsFileIn(machineDir);
  if (readJsonRecordSync(file).kind !== "missing") {
    return false;
  }
  updateJsonRecordSync(file, () => ({ [MOVED_MARK]: true }));
  return true;
}

/** The front-matter key the folders were listed under. */
const FOLDERS_KEY: ReadonlySet<string> = new Set(["folders"]);

/**
 * Takes the `folders:` key out of a project's file, keeping the rest of it,
 * and the file itself where nothing else is in it.
 */
function stripKeySync(file: string): void {
  let held: string;
  try {
    // oxlint-disable-next-line studio/no-sync-content-read -- a launch step, synchronous like the settings write before it.
    held = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const next = withoutFrontMatterKeys(held, FOLDERS_KEY);
  if (next === undefined) {
    return;
  }
  if (next === "") {
    fs.rmSync(file, { force: true });
    return;
  }
  rewriteFileSync(
    file,
    (current) =>
      (current === undefined
        ? undefined
        : withoutFrontMatterKeys(current, FOLDERS_KEY)) ??
      current ??
      next,
  );
}
