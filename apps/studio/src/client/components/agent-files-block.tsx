import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { parseFilesBlock } from "@/client/lib/parse-files-block";
import { isAddressableTaskFilePath } from "@/client/lib/task-file-path";
import { useContext } from "react";

import { FilesGrid } from "./files-grid";
import { MarkdownTaskContext } from "./markdown-task-context";

/**
 * Renders a ```files fence: the files the agent chose to show, in the order it
 * listed them.
 *
 * This is the agent's own presentation, so it is not the change list. It shows
 * what the agent named and nothing it did not, wherever the file lives -- which
 * is the point, now that a shared folder is somewhere the agent can write and
 * the task-directory watcher cannot see.
 *
 * Every card is drawn from its path alone, without asking whether the file is
 * there. A transcript is a record of what a reply handed over, and whether those
 * bytes still exist is a question with a different answer every minute; the
 * honest time to ask it is when someone acts on the file. An image answers it
 * for free -- the asset origin is a static file server, so the thumbnail either
 * loads or 404s onto the fallback card.
 */
export function AgentFilesBlock({ content }: { content: string }) {
  const { assetBaseUrl, isStreaming, taskId } = useContext(MarkdownTaskContext);

  // A fence still arriving ends mid-path: the model has typed `output/ch` of
  // `output/chart.png`, and an optimistic card would be drawn and replaced on
  // every further keystroke. A line is finished once a newline follows it.
  const settledContent =
    isStreaming === true
      ? content.slice(0, content.lastIndexOf("\n") + 1)
      : content;
  const paths = parseFilesBlock(settledContent).filter(isDrawablePath);

  if (
    taskId === undefined ||
    assetBaseUrl === undefined ||
    paths.length === 0
  ) {
    return null;
  }

  const files = paths.map<TaskFileViewerFile>((filePath) => ({
    filename: filePath.split("/").at(-1) ?? filePath,
    filePath,
    taskId,
    url: getAssetUrl({ assetBase: assetBaseUrl, filePath }),
  }));

  return (
    <div className="not-prose my-4">
      <FilesGrid files={files} preserveOrder />
    </div>
  );
}

// Whether a line in the fence is worth drawing a card for: a path this app can
// address, that also reads as a file reference at all.
//
// The second half is what a fence needs and a link does not. A link was written
// as a link, while a fence is a block of lines, so a stray sentence inside one
// should be ignored rather than drawn as a card naming it. No model in the
// evals has put one there; this is what keeps the first one that does from
// reading as a bug in the file itself.
function isDrawablePath(path: string): boolean {
  return (
    isAddressableTaskFilePath(path) &&
    (path.includes("/") || /\.[a-z0-9]{1,8}$/i.test(path))
  );
}
