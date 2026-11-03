import {
  readProjectsSync,
  type Project,
  writeProjectSync,
} from "../chat/projects";
import { listedFolderPaths } from "../chat/project-file";
import { readJsonRecordSync, updateJsonRecordSync } from "../json-record-file";
import { permissionSettingsOf, permissionsFileIn } from "./rules";
import { addedProjectFolders } from "./project-folders";

/**
 * The mark in this computer's permission settings that the folders a project's
 * `AGENTS.md` listed were taken in here. Outside the settings' schema, so no
 * write of the settings, a reset included, drops it.
 */
const MOVED_MARK = "projectFoldersMoved";

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
  machineDir,
  rootDir,
}: {
  machineDir: string;
  rootDir: string;
}): { moved: number } {
  const file = permissionsFileIn(machineDir);
  const read = readJsonRecordSync(file);
  if (read.kind === "read" && read.record[MOVED_MARK] === true) {
    return { moved: 0 };
  }
  // No settings here means no build before this one ran the workspace on
  // this computer, so the folders a file lists were granted somewhere else,
  // or written by the agent: none is taken in, and the files are left alone
  // for the computer that granted them to take in its own.
  if (read.kind === "missing") {
    updateJsonRecordSync(file, () => ({ [MOVED_MARK]: true }));
    return { moved: 0 };
  }
  const listing = readProjectsSync(rootDir).flatMap((project) => {
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
    writeProjectSync(rootDir, withoutFolders(project));
  }
  return {
    moved: listing.filter(({ paths }) => paths.length > 0).length,
  };
}

function withoutFolders(project: Project): Project {
  const { others, ...rest } = project;
  const { folders: _folders, ...kept } = others ?? {};
  return Object.keys(kept).length > 0 ? { ...rest, others: kept } : rest;
}
