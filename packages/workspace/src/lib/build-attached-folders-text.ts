import { dedent } from "radashi";

import { type FolderAttachment } from "../schemas/folder-attachment";
import { TOOL_NAMES } from "../tools/name";
import { folderParentLabel } from "./assign-folder-names";
import { folderDisplayName } from "./folder-display-name";

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
  const displayNames = folders.map((folder) => folderDisplayName(folder.path));
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

  const guidance = [
    `Call a folder by its quoted name when you write to the user -- that is what they call it. The mount path is where it is mounted for you, not what the folder is named, so never present one as the folder's name.`,
    `Read, list, and search them by their mount path with \`${TOOL_NAMES.readFile}\` or the bash tool (\`ls\`, \`rg\`, \`find\`), just like any other directory.`,
    writable
      ? `In the read-and-write folders you may also create, edit, move, rename, and delete files with \`${TOOL_NAMES.writeFile}\`, \`${TOOL_NAMES.editFile}\`, and bash (\`mv\`, \`cp\`, \`mkdir\`, \`rm\`). These are the user's own files, so every change is immediate and there is no undo: prefer moving and renaming over deleting, and tell the user what you changed.`
      : null,
    readOnly
      ? `Writing into a read-only folder fails -- it reflects the user's real files on disk and is not yours to change.`
      : null,
    `\`rg\` searches mount paths directly too. What cannot resolve one, at any access level, is a real interpreter process (python, node, ffmpeg, pnpm): to process a file with one, copy it into the task first (e.g. \`cp '<mount path>/file' attachments/\`) and work on the copy${writable ? `, then move the result back with \`mv\` if it belongs in the folder` : ""}.`,
  ]
    .filter((line) => line !== null)
    .join(" ");

  return dedent`
    <attached_folders>
    ${intro}
    ${folderList}

    ${guidance}
    </attached_folders>
  `;
}
