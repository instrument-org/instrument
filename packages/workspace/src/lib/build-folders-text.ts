import { APP_NAME } from "@instrument-org/shared";
import { dedent } from "radashi";

import { type MountedFolder } from "../schemas/mounted-folder";
import { TOOL_NAMES } from "../tools/name";
import { folderLabel, folderParentLabel } from "./folder-parent-label";

/**
 * The list of folders the model reads: every folder the chat reaches.
 *
 * A folder is introduced by the name the user knows it by, taken from its path,
 * with its mount path beside it as an address rather than a label. The two come
 * apart because the mount name has to be unique per chat and the user's name for
 * a folder does not: told only "Documents-test", a model reports back that it
 * wrote to "the documents-test folder", naming something the user never created.
 *
 * The parent appears only where two folders share a name, which is the only
 * case where the user needs it to tell them apart.
 */
export function buildFoldersText({
  folders,
  guidance = true,
  intro,
}: {
  folders: {
    access: MountedFolder.Access;
    /** Reached, but no longer on disk when the list was built. */
    missing?: boolean;
    mountPoint: string;
    path: string;
    /**
     * Open to look through, while changing anything in it takes the person's
     * yes for the folder inside it: the home folder.
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
            ? `look through it; to change anything, ask for the folder inside it with \`${TOOL_NAMES.requestFolder}\``
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
      <folders>
      ${intro}
      ${folderList}
      </folders>
    `;
  }

  const writable = folders.some(({ access }) => access === "read-write");

  // Lines, not a `- ` list: the folder list above already is one, and a second
  // list under it reads as more folders.
  const rules = [
    `Call a folder by its quoted name when you write to the user. The mount path is its address, not its name.`,
    `Read, list, and search by mount path with \`${TOOL_NAMES.readFile}\` or bash (\`ls\`, \`rg\`, \`find\`), like any other directory. On a large folder \`rg\` is the one that finishes: \`rg --files -g '<glob>'\` lists and \`rg -l\` searches a whole home folder in seconds, where \`find\` stops part way with a traversal limit and returns nothing. Narrow it to a glob or a subdirectory either way, since an unfiltered \`rg --files\` over a home folder is millions of lines.`,
    writable
      ? `In the read-and-write folders you may also create, edit, move, rename, and delete, with \`${TOOL_NAMES.writeFile}\`, \`${TOOL_NAMES.editFile}\`, and bash. These are the user's real files: every change is immediate and there is no undo, so prefer moving and renaming over deleting, and tell them what you changed.`
      : null,
    `Some folders inside these need the person's yes, and some they closed to ${APP_NAME}. "Operation not permitted" says which: ask for the folder it names with \`${TOOL_NAMES.requestFolder}\`, set to its mount path, or tell the person what you couldn't reach. Never look for another way in.`,
    `\`cp\`, \`mv\`, the file tools, the sandboxed script runtimes (\`python\`, \`js-exec\`), and \`git\` reach a mount directly, one mount to another included, so reading a file, parsing it in a script, or putting one where it belongs takes no copy through the task. A real subprocess (python-native, node, ffmpeg, pnpm) is the exception: it cannot see a mount at all, so copy in first and run it on the copy: \`cp '<mount path>/file' attachments/\`${writable ? `, then \`mv\` the result back if it belongs in the folder` : ""}.`,
    `A repository in a folder is read in place: \`git -C '<mount path>' log\`, or \`cd\` there first. In a read-only folder git may only read (log, show, diff, blame, status); committing or changing files there needs the repository's own folder, which \`${TOOL_NAMES.requestFolder}\` asks for.`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return dedent`
    <folders>
    ${intro}
    ${folderList}

    ${rules}
    </folders>
  `;
}
