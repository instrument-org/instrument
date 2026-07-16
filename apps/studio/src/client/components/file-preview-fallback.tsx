import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useFileActionVisibility } from "@/client/hooks/use-file-action-visibility";
import { useTaskFileOpenControl } from "@/client/hooks/use-task-file-open-control";
import { ArrowLineDownIcon } from "@phosphor-icons/react";
import { type ReactNode } from "react";

import { FileActionsMenuItems } from "./file-actions-menu";
import { FileIcon } from "./file-icon";
import { OpenTaskFileButton } from "./open-task-file-button";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { contextMenuComponents } from "./ui/menu-components";

export function FilePreviewFallback({
  fallbackExtension,
  file,
  filename,
  onDownload,
}: {
  fallbackExtension?: string;
  file?: TaskFileViewerFile;
  filename: string;
  onDownload?: () => void;
}) {
  const openControl = useTaskFileOpenControl(file);
  // Without a resolved app association, opening could dead-end in an OS
  // error, so only promote open over download when an app is known.
  const canOpen = openControl.showOpen;

  const content = (
    <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 p-8 text-center text-foreground">
      <div className="flex h-20 w-16 items-center justify-center rounded-lg bg-accent text-muted-foreground">
        <FileIcon
          className="size-5"
          fallbackExtension={fallbackExtension}
          filename={filename}
        />
      </div>
      <div>
        <p className="max-w-72 break-all text-sm font-medium">{filename}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Preview unavailable in Instrument
        </p>
      </div>
      {canOpen ? (
        <OpenTaskFileButton
          control={openControl}
          file={file}
          iconClassName="size-5"
          size="sm"
        />
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

  if (!file) {
    return content;
  }

  return (
    <FilePreviewFallbackContextMenu file={file}>
      {content}
    </FilePreviewFallbackContextMenu>
  );
}

// Rendering this component already means no preview could be produced, so there is
// no decoded image/text data to put on the clipboard -- Copy stays hidden here
// regardless of mime type, while file-level actions (download, reveal, open) still
// operate on the underlying bytes and remain available.
function FilePreviewFallbackContextMenu({
  children,
  file,
}: {
  children: ReactNode;
  file: TaskFileViewerFile;
}) {
  const fileActions = useFileActionVisibility(file);
  const hasFileActions = fileActions.showDownload || fileActions.showReveal;

  if (!hasFileActions) {
    return children;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <FileActionsMenuItems
          canCopy={false}
          file={file}
          menuComponents={contextMenuComponents}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
