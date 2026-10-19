import { APP_NAME } from "@instrument-org/shared";
import { dedent } from "radashi";

import { TOOL_NAMES } from "../tools/name";
import { shellPath } from "./workspace-fs-layout";
import { folderLabel, folderParentLabel } from "./folder-parent-label";

/**
 * The list of folders the model reads: every folder the chat reaches.
 *
 * A folder is introduced by the name the user knows it by, taken from its path,
 * with its path beside it as an address rather than a label.
 *
 * The parent appears only where two folders share a name, which is the only
 * case where the user needs it to tell them apart.
 *
 * What the agent may do in each is left out: the list is written once for the
 * life of a session, and the permission rules answer that when it tries.
 */
export function buildFoldersText({
  folders,
  guidance = true,
  intro,
}: {
  folders: {
    /** Reached, but no longer on disk when the list was built. */
    missing?: boolean;
    path: string;
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
    .map(({ missing, path }, index) => {
      const name = displayNames[index] ?? path;
      const parent =
        (nameCounts.get(name) ?? 0) > 1 ? folderParentLabel(path) : undefined;
      const where = parent ? ` (in ${parent})` : "";
      const state = missing ? " (no longer exists)" : "";
      return `- "${name}"${where} -> \`${shellPath(path)}\`${state}`;
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

  // Lines, not a `- ` list: the folder list above already is one, and a second
  // list under it reads as more folders.
  const rules = [
    `Call a folder by its quoted name when you write to the user. The path is its address, not its name.`,
    `Read, list, and search by path with \`${TOOL_NAMES.readFile}\` or bash (\`ls\`, \`rg\`, \`find\`), like any other directory. On a large folder \`rg\` is the one that finishes: \`rg --files -g '<glob>'\` lists and \`rg -l\` searches a whole home folder in seconds, where \`find\` stops part way with a traversal limit and returns nothing. Narrow it to a glob or a subdirectory either way, since an unfiltered \`rg --files\` over a home folder is millions of lines.`,
    `Create, edit, move, rename, and delete with \`${TOOL_NAMES.writeFile}\`, \`${TOOL_NAMES.editFile}\`, and bash. These are the user's real files: every change is immediate and there is no undo, so prefer moving and renaming over deleting, and tell them what you changed.`,
    `Some of these folders, or folders inside them, need the person's yes before you read or change them, and some they closed to ${APP_NAME}: the refusal says which. Ask for one that needs a yes with \`${TOOL_NAMES.askPermission}\`; one they closed stays closed, so say what you couldn't reach. Never look for another way in.`,
    `Every command works on these folders in place, the native ones (\`python\`, \`node\`, \`ffmpeg\`) included, so reading a file, parsing it in a script, or putting one where it belongs takes no copy through your folder.`,
    `A repository in a folder is read in place: \`git -C '<folder>' log\`, or \`cd\` there first. Where you may only read, git may only read (log, show, diff, blame, status); committing or changing files there asks the person for the repository's own folder.`,
  ].join("\n");

  return dedent`
    <folders>
    ${intro}
    ${folderList}

    ${rules}
    </folders>
  `;
}
