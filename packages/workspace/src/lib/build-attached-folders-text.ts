import { folderNameFromPath } from "@instrument-org/shared";
import { dedent } from "radashi";

import { type FolderAttachment } from "../schemas/folder-attachment";
import { TOOL_NAMES } from "../tools/name";
import { folderParentLabel } from "./folder-parent-label";

/**
 * The attached-folder list the model reads.
 *
 * A folder is introduced by the name the user knows it by, taken from its path,
 * with its mount path beside it as an address rather than a label. The two come
 * apart because the mount name has to be unique per task and the user's name for
 * a folder does not: told only "Documents-test", a model reports back that it
 * wrote to "the documents-test folder", naming something the user never created.
 *
 * The parent appears only where two attachments share a name, which is the only
 * case where the user needs it to tell them apart.
 */
export function buildAttachedFoldersText({
  folders,
  intro,
}: {
  folders: {
    access: FolderAttachment.Access;
    /** Attached, but no longer on disk when the list was built. */
    missing?: boolean;
    mountPoint: string;
    path: string;
  }[];
  intro: string;
}) {
  const displayNames = folders.map((folder) => folderNameFromPath(folder.path));
  const nameCounts = new Map<string, number>();
  for (const name of displayNames) {
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  const folderList = folders
    .map(({ access, missing, mountPoint, path }, index) => {
      const name = displayNames[index] ?? path;
      const parent =
        (nameCounts.get(name) ?? 0) > 1 ? folderParentLabel(path) : undefined;
      const where = parent ? ` (in ${parent})` : "";
      const state = [
        access === "read-write" ? "read and write" : "read-only",
        missing ? "no longer exists" : null,
      ]
        .filter((part) => part !== null)
        .join(", ");
      return `- "${name}"${where} -> \`${mountPoint}\` (${state})`;
    })
    .join("\n");

  const writable = folders.some(({ access }) => access === "read-write");
  const readOnly = folders.some(({ access }) => access !== "read-write");

  // Lines, not a `- ` list: the folder list above already is one, and a second
  // list under it reads as more folders.
  const guidance = [
    `Call a folder by its quoted name when you write to the user. The mount path is its address, not its name.`,
    `Read, list, and search by mount path with \`${TOOL_NAMES.readFile}\` or bash (\`ls\`, \`rg\`, \`find\`), like any other directory.`,
    writable
      ? `In the read-and-write folders you may also create, edit, move, rename, and delete, with \`${TOOL_NAMES.writeFile}\`, \`${TOOL_NAMES.editFile}\`, and bash. These are the user's real files: every change is immediate and there is no undo, so prefer moving and renaming over deleting, and tell them what you changed.`
      : null,
    readOnly
      ? `Writing into a read-only folder fails. It mirrors the user's real files and is not yours to change.`
      : null,
    `A real subprocess (python, node, ffmpeg, pnpm, git) cannot see a mount at all. Copy into the task first and work on the copy: \`cp '<mount path>/file' attachments/\`${writable ? `, then \`mv\` the result back if it belongs in the folder` : ""}.`,
    `That includes \`git\`: copy the whole repository (\`cp -R '<mount path>' work/\`), not just \`.git\`, which without a working tree beside it reports every file as deleted.`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return dedent`
    <attached_folders>
    ${intro}
    ${folderList}

    ${guidance}
    </attached_folders>
  `;
}
