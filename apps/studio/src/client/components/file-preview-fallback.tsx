import { type ViewerFile } from "@/client/atoms/viewer-file";
import { useFileActionVisibility } from "@/client/hooks/use-file-action-visibility";
import { useFileOpenControl } from "@/client/hooks/use-file-open-control";
import { cn } from "@/client/lib/utils";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";
import { createContext, type ReactNode, useContext } from "react";

import {
  describeViewerError,
  ViewerErrorContext,
} from "./document-viewers/viewer-error";
import { FileTypeIcon, formatByteSize } from "./extend/file-system";
import { FileActionsMenuItems } from "./file-actions-menu";
import { OpenFileButton } from "./open-file-button";
import { SystemPicture } from "./system-picture";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { contextMenuComponents } from "./ui/menu-components";
import { VersionTag } from "./version-tag";

/**
 * The version of a file a card stands for, where a chat's pane has one up
 * in place of the file: its number, its line in the versions list, its size,
 * and the name of the file it is a version of.
 */
export const ShownVersionContext = createContext<
  { line: string; name: string; number: number; size: number } | undefined
>(undefined);

export function FilePreviewFallback({
  fallbackExtension,
  file,
  filename,
  onDownload,
}: {
  fallbackExtension?: string;
  file?: ViewerFile;
  filename: string;
  onDownload?: () => void;
}) {
  const openControl = useFileOpenControl(file);
  // Without a resolved app association, opening could dead-end in an OS
  // error, so only promote open over save-as when an app is known.
  const canOpen = openControl.showOpen;
  // Set when a document viewer threw and this card stands in for it.
  const description = describeViewerError(useContext(ViewerErrorContext));
  // A version shows what tells it from the others: the system's picture of
  // it where there is one, its number and line, and its size.
  const version = useContext(ShownVersionContext);
  const icon = (
    <div className="flex h-20 w-16 items-center justify-center rounded-lg bg-accent text-muted-foreground">
      <FileTypeIcon
        className="size-5"
        fallbackExtension={fallbackExtension}
        fileName={filename}
      />
    </div>
  );

  const content = (
    <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 p-8 text-center text-foreground">
      {version && file ? (
        <SystemPicture
          className="max-h-36 max-w-60 rounded-lg shadow-xs ring-1 ring-border"
          fallback={icon}
          hostPath={file.hostPath}
        />
      ) : (
        icon
      )}
      <div>
        <p className="max-w-72 text-sm font-medium break-all">
          {version?.name ?? filename}
        </p>
        {version && (
          <p className="mt-1 flex max-w-72 items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <VersionTag className="h-4 text-[11px]" number={version.number} />
            <span className="truncate">{version.line}</span>
          </p>
        )}
        <p
          className={cn(
            "text-xs text-muted-foreground",
            version ? "mt-0.5" : "mt-1",
          )}
        >
          {version
            ? `${formatByteSize(version.size) ?? ""} · ${description}`
            : description}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {canOpen ? (
          <OpenFileButton
            control={
              version
                ? {
                    ...openControl,
                    openLabel: openControl.appName
                      ? `Open v${String(version.number)} in ${openControl.appName}`
                      : `Open v${String(version.number)}`,
                  }
                : openControl
            }
            file={file}
            iconClassName="size-5"
            size="sm"
          />
        ) : (
          onDownload && (
            <Button onClick={onDownload} size="sm">
              <ArrowLineDownIcon className="size-4" />
              Save as…
            </Button>
          )
        )}
      </div>
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
// regardless of mime type, while file-level actions (save as, reveal, open) still
// operate on the underlying bytes and remain available.
function FilePreviewFallbackContextMenu({
  children,
  file,
}: {
  children: ReactNode;
  file: ViewerFile;
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
