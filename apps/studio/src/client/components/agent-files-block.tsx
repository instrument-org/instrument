import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { parseFilesBlock } from "@/client/lib/parse-files-block";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { ATTACHED_FOLDERS_MOUNT_ROOT } from "@instrument-org/workspace/client";
import { useQueries } from "@tanstack/react-query";
import { useContext } from "react";

import { FileIcon } from "./file-icon";
import { FilesGrid } from "./files-grid";
import { MarkdownTaskContext } from "./markdown-task-context";
import { useCurrentTaskFiles } from "./task/current-task-files";

/**
 * Renders a ```files fence: the files the agent chose to show, in the order it
 * listed them.
 *
 * This is the agent's own presentation, so it is not the change list. It shows
 * what the agent named and nothing it did not, wherever the file lives -- which
 * is the point, now that a shared folder is somewhere the agent can write and
 * the task-directory watcher cannot see.
 *
 * A path that resolves to nothing is shown as missing rather than dropped. A
 * fence is a record of what the reply said it was handing over, and a file that
 * has since been moved or deleted -- which a shared folder's files can be, by
 * the user, at any time -- should read as gone rather than as never mentioned.
 */
export function AgentFilesBlock({ content }: { content: string }) {
  const { assetBaseUrl, isStreaming, taskId } = useContext(MarkdownTaskContext);
  const indexedFiles = useCurrentTaskFiles();
  const paths = parseFilesBlock(content);

  // The live index covers the task directory only, so a shared folder's files
  // are resolved one at a time against the task's mounts instead. Same route
  // the artifact panel takes, and the same answer: name, type, and mtime.
  const unresolvedInputs =
    taskId === undefined
      ? []
      : paths
          .filter((path) => !indexedFiles?.has(path) && isResolvablePath(path))
          .map((filePath) => ({ filePath, taskId }));

  const fileInfoQueries = useQueries({
    queries: unresolvedInputs.map((input) =>
      rpcClient.workspace.task.files.fileInfo.queryOptions({ input }),
    ),
  });

  const resolvedByPath = new Map(
    unresolvedInputs.flatMap(({ filePath }, index) => {
      const data = fileInfoQueries[index]?.data;
      return data ? [[filePath, data] as const] : [];
    }),
  );
  const pendingPaths = new Set(
    unresolvedInputs.flatMap(({ filePath }, index) =>
      fileInfoQueries[index]?.isPending === true ? [filePath] : [],
    ),
  );

  const files =
    taskId === undefined || assetBaseUrl === undefined
      ? []
      : paths.flatMap<TaskFileViewerFile>((filePath) => {
          const file =
            indexedFiles?.get(filePath) ?? resolvedByPath.get(filePath);
          if (!file) {
            return [];
          }
          return [
            {
              filename: file.filename,
              filePath,
              mimeType: file.mimeType,
              modifiedAt: file.modifiedAt,
              taskId,
              url: getAssetUrl({
                assetBase: assetBaseUrl,
                filePath,
                version: file.modifiedAt,
              }),
            },
          ];
        });

  // Nothing is missing until the fence has finished arriving: mid-stream, the
  // last line is a path the model is still typing, and every keystroke of it
  // would otherwise draw and discard a card. A path still being looked up is
  // undecided for the same reason.
  const missingPaths =
    isStreaming === true
      ? []
      : paths.filter(
          (path) =>
            !indexedFiles?.has(path) &&
            !resolvedByPath.has(path) &&
            !pendingPaths.has(path) &&
            looksLikeFileReference(path),
        );

  if (files.length === 0 && missingPaths.length === 0) {
    return null;
  }

  return (
    <div className="not-prose my-4 flex flex-col gap-2">
      {files.length > 0 && <FilesGrid files={files} preserveOrder />}
      {missingPaths.length > 0 && (
        <div className="flex flex-wrap items-start gap-2">
          {missingPaths.map((filePath) => (
            <MissingFileCard filePath={filePath} key={filePath} />
          ))}
        </div>
      )}
    </div>
  );
}

// Cheap structural check before a path costs a request: task-relative, or under
// the attached-folder mount root, and never traversing. Everything else is
// either a line the agent did not mean as a path or one the server rejects.
function isResolvablePath(path: string): boolean {
  if (path.includes("\\") || path.split("/").includes("..")) {
    return false;
  }
  return (
    !path.startsWith("/") || path.startsWith(`${ATTACHED_FOLDERS_MOUNT_ROOT}/`)
  );
}

// Whether a line that resolved to nothing is worth reporting as a missing file
// at all. A stray sentence inside the fence should be ignored, not drawn as a
// broken card naming it. No model in the evals has put one there; this is what
// keeps the first one that does from looking like a bug in the file itself.
function looksLikeFileReference(path: string): boolean {
  return path.includes("/") || /\.[a-z0-9]{1,8}$/i.test(path);
}

/**
 * A file the reply named that is not there.
 *
 * Named by its filename alone. The path it was written as is a sandbox path --
 * `/mnt/<folder>/...` for a folder the user shared -- and that prefix is ours,
 * not something they have ever seen; it belongs on hover, where someone looking
 * for it can find it, and nowhere a glance lands.
 */
function MissingFileCard({ filePath }: { filePath: string }) {
  const filename = filePath.split("/").at(-1) ?? filePath;

  return (
    <div
      className={cn(
        "flex h-12 max-w-48 min-w-0 items-center gap-x-2 overflow-hidden rounded-lg",
        "border border-dashed border-border px-3 text-muted-foreground",
      )}
      title={filePath}
    >
      <FileIcon className="size-5 shrink-0 opacity-60" filename={filename} />
      <div className="min-w-0">
        <div className="truncate text-xs/tight">{filename}</div>
        <div className="truncate text-[0.625rem]/tight opacity-70">
          Not found
        </div>
      </div>
    </div>
  );
}
