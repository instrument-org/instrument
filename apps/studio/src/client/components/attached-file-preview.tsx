import { formatBytes } from "@instrument-org/workspace/client";

import { AttachedItemPreview } from "./attached-item-preview";
import { AttachmentRemoveButton } from "./attachment-remove-button";
import { FileTypeIcon } from "./extend/file-system";
import { ImageWithFallback } from "./image-with-fallback";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function AttachedFilePreview({
  filename,
  mimeType,
  onClick,
  onPutInMessage,
  onRemove,
  size,
  url,
}: {
  filename: string;
  mimeType?: string;
  onClick?: () => void;
  /** For words pasted in as a file: takes the file away and puts the words in the message. */
  onPutInMessage?: () => void;
  onRemove?: () => void;
  size?: number;
  url?: string;
}) {
  const isImage = mimeType?.startsWith("image/");
  const hasPreview = Boolean(url);

  const tooltipContent = (
    <div className="flex items-center gap-2">
      <p>{filename}</p>
      {size && <Badge variant="secondary">{formatBytes(size)}</Badge>}
    </div>
  );

  if (hasPreview && isImage && url) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="group relative size-12 shrink-0">
            <Button
              className="size-12 overflow-hidden p-0"
              onClick={onClick}
              type="button"
              variant="outline"
            >
              <ImageWithFallback
                alt={filename}
                className="size-full object-cover"
                fallbackClassName="size-full"
                filename={filename}
                showCheckerboard
                src={url}
              />
            </Button>
            {onRemove && <AttachmentRemoveButton onRemove={onRemove} />}
          </div>
        </TooltipTrigger>
        <TooltipContent
          className="wrap-break-word"
          collisionPadding={10}
          maxWidth="500px"
        >
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <AttachedItemPreview
      icon={
        <FileTypeIcon
          className="size-5 shrink-0 text-muted-foreground"
          fileName={filename}
        />
      }
      label={filename}
      onClick={onClick}
      onPutInMessage={onPutInMessage}
      onRemove={onRemove}
      tooltip={tooltipContent}
    />
  );
}
