import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { useCurrentProjectFile } from "@/client/components/project/current-project-files";
import { getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";

import { FileIcon } from "./file-icon";
import { ImageWithFallback } from "./image-with-fallback";
import { PreviewListItem } from "./preview-list-item";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function FilePreviewListItem({
  file,
  isSelected = false,
  onClick,
}: {
  file: ProjectFileViewerFile;
  isSelected?: boolean;
  onClick: () => void;
}) {
  const { filename, filePath, mimeType, url } = file;
  const fileType = getFileType(file);
  const currentFile = useCurrentProjectFile(filePath);
  const isStale =
    currentFile !== undefined && currentFile.modifiedAt !== file.modifiedAt;

  if (url && fileType === "image") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              "relative size-12 shrink-0 overflow-hidden p-0",
              isSelected &&
                "ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
            onClick={onClick}
            type="button"
            variant="outline"
          >
            <ImageWithFallback
              alt={filename}
              className="size-12 object-cover"
              fallbackClassName="size-12 rounded-lg"
              filename={filename}
              showCheckerboard
              src={url}
            />
            {isStale && (
              <span className="absolute inset-x-0 bottom-0 bg-background/90 py-0.5 text-[9px] font-medium">
                Updated
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent
          className="max-w-[min(500px,90vw)] wrap-break-word"
          collisionPadding={10}
        >
          {filePath}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <PreviewListItem
      icon={
        <FileIcon
          className="size-5 shrink-0 text-muted-foreground"
          filename={filename}
          mimeType={mimeType}
        />
      }
      isSelected={isSelected}
      label={isStale ? `${filename} (updated)` : filename}
      onClick={onClick}
      tooltipContent={filePath}
    />
  );
}
