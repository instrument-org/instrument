import { APP_NAME } from "@instrument-org/shared";
import { dedent } from "radashi";

import { type FolderAttachment } from "../schemas/folder-attachment";
import { TOOL_NAMES } from "../tools/name";
import { folderLabel, folderParentLabel } from "./folder-parent-label";
import { TASK_COMMAND } from "./shell-commands/task-command";

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
  guidance = true,
  intro,
  writes = "here",
}: {
  folders: {
    access: FolderAttachment.Access;
    /** Attached, but no longer on disk when the list was built. */
    missing?: boolean;
    mountPoint: string;
    path: string;
    /**
     * Read-only as a whole because the workspace lives inside it, while a
     * folder inside it takes the write grant the user gave: the home folder.
     */
    writableInside?: boolean;
  }[];
  /**
   * Whether the rules for reading and writing these folders follow the list.
   * A session reads them once, under the first folders it hears of; a folder
   * announced after that is a list entry under rules already read.
   */
  guidance?: boolean;
  intro: string;
  /**
   * Who writes a file's contents into a folder: the reader of this text, with
   * its file tools, or a task the reader hands the folder to. The orchestrator
   * has no file tools and a shell that refuses to write, so telling it about
   * `write_file` sends it looking for a tool it has not got.
   */
  writes?: "here" | "through-tasks";
}) {
  const displayNames = folders.map((folder) => folderLabel(folder.path));
  const nameCounts = new Map<string, number>();
  for (const name of displayNames) {
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  const folderList = folders
    .map(({ access, missing, mountPoint, path, writableInside }, index) => {
      const name = displayNames[index] ?? path;
      const parent =
        (nameCounts.get(name) ?? 0) > 1 ? folderParentLabel(path) : undefined;
      const where = parent ? ` (in ${parent})` : "";
      const state = [
        access === "read-write"
          ? "read and write"
          : writableInside
            ? "read-only as a whole, read and write inside"
            : "read-only",
        missing ? "no longer exists" : null,
      ]
        .filter((part) => part !== null)
        .join(", ");
      return `- "${name}"${where} -> \`${mountPoint}\` (${state})`;
    })
    .join("\n");

  if (!guidance) {
    return dedent`
      <attached_folders>
      ${intro}
      ${folderList}
      </attached_folders>
    `;
  }

  const writable = folders.some(({ access }) => access === "read-write");
  const readOnly = folders.some(
    ({ access, writableInside }) => access !== "read-write" && !writableInside,
  );
  const writableInside = folders.some((folder) => folder.writableInside);

  // Lines, not a `- ` list: the folder list above already is one, and a second
  // list under it reads as more folders.
  const rules = (
    writes === "through-tasks"
      ? [
          `Call a folder by its quoted name when you write to the user. The mount path is its address, not its name.`,
          `Look inside by mount path with bash (\`ls\`, \`cat\`, \`head\`, \`find\`), like any other directory.`,
          writable
            ? `Writing a file's contents into a read-and-write folder is a task's: hand it the folder with --folder (:rw when it should write). A finished file you put where it belongs yourself, with \`cp\` and \`mv\`, but only into a folder listed above as read and write for you: one that is read-only as a whole refuses your copy with \`EROFS\`, however writable a task finds the folder inside it. To land a file anywhere else, give the task that folder with \`${TASK_COMMAND.name} folder <id> --add <mount>\` and have it write there itself. These are the user's real files: every change is immediate and there is no undo, so prefer moving and renaming over deleting, and tell them what you changed.`
            : null,
          readOnly
            ? `Writing into a read-only folder fails, for you and for a task. It mirrors the user's real files and is not yours to change.`
            : null,
          writableInside
            ? `A folder that is read-only as a whole keeps ${APP_NAME}'s own data somewhere inside it: you read it and never write it, and a task is handed a folder inside it (--folder <mount>/<folder>) and writes there.`
            : null,
        ]
      : [
          `Call a folder by its quoted name when you write to the user. The mount path is its address, not its name.`,
          `Read, list, and search by mount path with \`${TOOL_NAMES.readFile}\` or bash (\`ls\`, \`rg\`, \`find\`), like any other directory. On a large folder \`rg\` is the one that finishes: \`rg --files -g '<glob>'\` lists and \`rg -l\` searches a whole home folder in seconds, where \`find\` stops part way with a traversal limit and returns nothing. Narrow it to a glob or a subdirectory either way, since an unfiltered \`rg --files\` over a home folder is millions of lines.`,
          writable
            ? `In the read-and-write folders you may also create, edit, move, rename, and delete, with \`${TOOL_NAMES.writeFile}\`, \`${TOOL_NAMES.editFile}\`, and bash. These are the user's real files: every change is immediate and there is no undo, so prefer moving and renaming over deleting, and tell them what you changed.`
            : null,
          readOnly
            ? `Writing into a read-only folder fails. It mirrors the user's real files and is not yours to change.`
            : null,
          process.platform === "darwin"
            ? `\`EPERM\` or "Operation not permitted" inside one of these means macOS refused ${APP_NAME} the folder when it asked the user. Stop and say so rather than trying again; they can allow ${APP_NAME} under System Settings, Privacy & Security, Files and Folders.`
            : null,
          `\`cp\`, \`mv\`, and the file tools reach a mount directly, one mount to another included, so reading a file or putting one where it belongs takes no copy through the task. A real subprocess (python, node, ffmpeg, pnpm, git) is the exception: it cannot see a mount at all, so copy in first and run it on the copy: \`cp '<mount path>/file' attachments/\`${writable ? `, then \`mv\` the result back if it belongs in the folder` : ""}.`,
          `That includes \`git\`: copy the whole repository (\`cp -R '<mount path>' work/\`), not just \`.git\`, which without a working tree beside it reports every file as deleted.`,
        ]
  )
    .filter((line) => line !== null)
    .join("\n");

  return dedent`
    <attached_folders>
    ${intro}
    ${folderList}

    ${rules}
    </attached_folders>
  `;
}
