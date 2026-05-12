import { ArrowLineDownIcon } from "@phosphor-icons/react";

import { FileIcon } from "./file-icon";
import { Button } from "./ui/button";

export function FilePreviewFallback({
  fallbackExtension,
  filename,
  onDownload,
}: {
  fallbackExtension?: string;
  filename: string;
  onDownload?: () => void;
}) {
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
          {onDownload
            ? "Download this file to view it"
            : "This file cannot be previewed"}
        </p>
      </div>
      {onDownload && (
        <Button onClick={onDownload} size="sm">
          <ArrowLineDownIcon className="size-4" />
          Download
        </Button>
      )}
    </div>
  );
}
