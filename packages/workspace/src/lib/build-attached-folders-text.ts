import { dedent } from "radashi";

import { type FolderAttachment } from "../schemas/folder-attachment";
import { TOOL_NAMES } from "../tools/name";

export function buildAttachedFoldersText({
  folders,
  intro,
}: {
  folders: {
    access: FolderAttachment.Access;
    mountPoint: string;
    name: string;
  }[];
  intro: string;
}) {
  const folderList = folders
    .map(
      ({ access, mountPoint, name }) =>
        `- ${name} -> \`${mountPoint}\` (${access === "read-write" ? "read and write" : "read-only"})`,
    )
    .join("\n");

  const writable = folders.some(({ access }) => access === "read-write");
  const readOnly = folders.some(({ access }) => access !== "read-write");

  const guidance = [
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
