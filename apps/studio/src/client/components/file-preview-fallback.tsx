import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useOpenTaskFile } from "@/client/hooks/use-open-task-file";
import { useTaskFileOpenTarget } from "@/client/hooks/use-task-file-open-target";
import { ArrowLineDownIcon } from "@phosphor-icons/react";

import { FileIcon } from "./file-icon";
import { OpenTargetIcon } from "./open-target-icon";
import { Button } from "./ui/button";

export function FilePreviewFallback({
  fallbackExtension,
  file,
  filename,
  onDownload,
}: {
  fallbackExtension?: string;
  file?: Pick<TaskFileViewerFile, "filePath" | "taskId">;
  filename: string;
  onDownload?: () => void;
}) {
  const openTaskFile = useOpenTaskFile();
  const { appName, openLabel } = useTaskFileOpenTarget(file);
  // Without a resolved app association, opening could dead-end in an OS
  // error, so only promote open over download when an app is known.
  const canOpen = file != null && appName != null;

  return (
    <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 p-8 text-center text-foreground">
      <div className="flex h-20 w-16 items-center justify-center rounded-lg bg-accent text-muted-foreground">
        <FileIcon
          className="size-5"
          fallbackExtension={fallbackExtension}
          filename={filename}
        />
      </div>
      <div>
        <p className="text-sm font-medium">Preview not available</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {canOpen
            ? `Open this file in ${appName} to view it`
            : onDownload
              ? "Download this file to view it"
              : "This file cannot be previewed"}
        </p>
      </div>
      {canOpen ? (
        <Button
          onClick={() => {
            openTaskFile(file);
          }}
          size="sm"
        >
          <OpenTargetIcon className="size-4" file={file} />
          {openLabel}
        </Button>
      ) : (
        onDownload && (
          <Button onClick={onDownload} size="sm">
            <ArrowLineDownIcon className="size-4" />
            Download
          </Button>
        )
      )}
    </div>
  );
}
