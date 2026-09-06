import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { isMediaFile } from "@/client/lib/get-file-type";
import { parseFilesBlock } from "@/client/lib/parse-files-block";
import { isAddressableTaskFilePath } from "@instrument-org/workspace/client";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { useContext } from "react";

import { FileIcon } from "./file-icon";
import { FileOpenContext } from "./file-open-context";
import { FilesGrid } from "./files-grid";
import { FilesLayoutContext } from "./files-layout-context";
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
 * Every card is drawn from its path and the id of the reply that named it,
 * without asking disk whether the file is there. A transcript is a record of
 * what a reply handed over, and whether those bytes still exist is a question
 * with a different answer every minute; the honest time to ask it is when
 * someone acts on the file. An image answers it for free -- the asset origin is
 * a static file server, so the thumbnail either loads or 404s onto the fallback
 * card.
 *
 * The id rides in the URL because two replies naming one path that was
 * rewritten between them would otherwise ask for the same URL, and the renderer
 * hands the second one the picture it already decoded for the first. That is
 * how a reply reporting a change draws the file as it was before it.
 */
export function AgentFilesBlock({ content }: { content: string }) {
  const { isStreaming } = useContext(MarkdownTaskContext);

  // A fence still arriving ends mid-path: the model has typed `output/ch` of
  // `output/chart.png`, and an optimistic card would be drawn and replaced on
  // every further keystroke. A line is finished once a newline follows it.
  const lineBreak = content.lastIndexOf("\n");
  const settledContent =
    isStreaming === true ? content.slice(0, lineBreak + 1) : content;
  const paths = parseFilesBlock(settledContent).filter(isDrawablePath);

  // The line still being typed, which the grid holds a place for without
  // drawing. Every fence has one until the message ends -- the code node drops
  // the newline before the closing fence, so the last path is unfinished by
  // this reckoning right up to the frame the message settles in, and that is
  // the frame it would otherwise arrive in unannounced.
  //
  // Only a path that already names media, since that is all the grid can
  // reserve an exact box for. It is also the only kind worth reserving: a
  // square tile is the tallest thing a fence draws, and the room it needs is
  // the room the reader would otherwise have to go and find.
  const pendingPath =
    isStreaming === true
      ? parseFilesBlock(content.slice(lineBreak + 1))
          .filter(isDrawablePath)
          .find(
            (path) => isMediaFile({ filename: path }) && !paths.includes(path),
          )
      : undefined;

  return <FilePathsGrid paths={paths} pendingFilePath={pendingPath} />;
}

/**
 * A list of paths, drawn as the grid a reply shows its files in.
 *
 * Shared rather than inlined because a second producer draws the same thing:
 * the retired `data-fileChanges` part, which is how a task from before the
 * fence still shows what a turn produced. Two grids that are meant to be
 * indistinguishable should not be two pieces of code.
 */
export function FilePathsGrid({
  paths,
  pendingFilePath,
}: {
  paths: string[];
  pendingFilePath?: string;
}) {
  const { assetBaseUrl, assetVersion, taskId } =
    useContext(MarkdownTaskContext);
  const layout = useContext(FilesLayoutContext);
  const openElsewhere = useContext(FileOpenContext);

  if (
    taskId === undefined ||
    assetBaseUrl === undefined ||
    (paths.length === 0 && pendingFilePath === undefined)
  ) {
    return null;
  }

  const files = paths.map<TaskFileViewerFile>((filePath) => ({
    filename: filePath.split("/").at(-1) ?? filePath,
    filePath,
    taskId,
    url: getAssetUrl({
      assetBase: assetBaseUrl,
      filePath,
      version: assetVersion,
    }),
  }));

  if (layout === "list") {
    return (
      <div className="not-prose my-2 flex flex-col gap-1">
        {files.map((file) => (
          <button
            className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-card px-2 text-left text-xs hover:bg-accent/50"
            key={file.filePath}
            onClick={() => {
              openElsewhere?.(file.filePath);
            }}
            type="button"
          >
            <FileIcon className="size-4 shrink-0" filename={file.filename} />
            <span className="min-w-0 flex-1 truncate">{file.filename}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {fileKind(file.filename)}
            </span>
            <ArrowUpRightIcon className="size-3 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="not-prose my-4">
      <FilesGrid
        files={files}
        pendingFilePath={pendingFilePath}
        preserveOrder
      />
    </div>
  );
}

/** The kind a row names beside the file: its extension, upper-cased, or "File". */
function fileKind(filename: string) {
  const extension = filename.includes(".") ? filename.split(".").at(-1) : "";
  return extension ? extension.toUpperCase() : "File";
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
