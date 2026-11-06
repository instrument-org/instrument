import { formatBytes } from "@instrument-org/workspace/client";

import { AttachedItemPreview } from "./attached-item-preview";
import { FileTypeIcon } from "./extend/file-system";
import { ImageWithFallback } from "./image-with-fallback";
import { Badge } from "./ui/badge";

/**
 * A file attached to the message, as a chip: a picture's own thumbnail as its
 * mark, or the file's type, and its name. Pressed, a picture opens large.
 */
export function AttachedFilePreview({
  filename,
  hostPath,
  mimeType,
  onClick,
  onPutInMessage,
  onRemove,
  size,
  url,
}: {
  filename: string;
  /** Where it is on disk, which dragging it out of the window carries; none for words pasted in. */
  hostPath?: string;
  mimeType?: string;
  onClick?: () => void;
  /** For words pasted in as a file: takes the file away and puts the words in the message. */
  onPutInMessage?: () => void;
  onRemove?: () => void;
  size?: number;
  url?: string;
}) {
  const isImage = mimeType?.startsWith("image/") === true && Boolean(url);
  return (
    <AttachedItemPreview
      icon={
        isImage && url ? (
          <ImageWithFallback
            alt={filename}
            className="size-4 object-cover"
            fallbackClassName="size-4"
            filename={filename}
            src={url}
          />
        ) : (
          <FileTypeIcon
            className="size-4 shrink-0 text-muted-foreground"
            fileName={filename}
          />
        )
      }
      {...(hostPath ? { hostPath } : {})}
      label={filename}
      onClick={onClick}
      onPutInMessage={onPutInMessage}
      onRemove={onRemove}
      tooltip={
        <div className="flex items-center gap-2">
          <p>{filename}</p>
          {size && <Badge variant="secondary">{formatBytes(size)}</Badge>}
        </div>
      }
    />
  );
}
