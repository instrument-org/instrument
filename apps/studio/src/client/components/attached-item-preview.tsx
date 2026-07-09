import type { ReactNode } from "react";

import { AttachmentRemoveButton } from "./attachment-remove-button";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function AttachedItemPreview({
  icon,
  label,
  onClick,
  onRemove,
  tooltip,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  onRemove?: () => void;
  tooltip?: ReactNode;
}) {
  const button = (
    <Button
      className="size-full min-w-0 justify-start gap-x-2 overflow-hidden"
      onClick={onClick}
      type="button"
      variant="outline"
    >
      {icon}
      <span className="min-w-0 truncate text-xs">{label}</span>
    </Button>
  );

  return (
    <div className="group relative h-12 max-w-48 min-w-0">
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent
            className="max-w-[min(500px,90vw)] wrap-break-word"
            collisionPadding={10}
          >
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      {onRemove && <AttachmentRemoveButton onRemove={onRemove} />}
    </div>
  );
}
