import { dedent } from "radashi";

export function buildAttachedFoldersText({
  folders,
  intro,
}: {
  folders: { mountPoint: string; name: string }[];
  intro: string;
}) {
  const folderList = folders
    .map(({ mountPoint, name }) => `- ${name} -> \`${mountPoint}\``)
    .join("\n");
  return dedent`
    <attached_folders>
    ${intro}
    ${folderList}

    These folders are mounted read-only at the paths above. Read, list, and
    search them by their mount path with your normal file tools (read_file, glob,
    grep) or the bash tool (\`ls\`, \`cat\`, \`grep\`/\`rg\`, \`find\`), just like any
    other directory. To work on a file (edit, run, or process it with a script or
    a tool like ffmpeg), first copy it into the task with bash
    (e.g. \`cp '<mount path>/file' attachments/\`), then operate on the copy.
    Writing into a mounted folder fails because it is read-only -- it reflects the
    user's real files on disk and is not yours to change.
    </attached_folders>
  `;
}
