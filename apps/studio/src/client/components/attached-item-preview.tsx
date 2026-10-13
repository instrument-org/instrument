import type { ReactNode } from "react";

import { TextTIcon } from "@phosphor-icons/react/TextT";

import { AttachmentRemoveButton } from "./attachment-remove-button";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function AttachedItemPreview({
  icon,
  label,
  onClick,
  onPutInMessage,
  onRemove,
  tooltip,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  /** Offered beside the remove button, for an attachment that is really words. */
  onPutInMessage?: () => void;
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
            className="wrap-break-word"
            collisionPadding={10}
            maxWidth="500px"
          >
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      {onPutInMessage && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Put in message"
              className="absolute -top-2 right-4 size-5 rounded-full border border-border opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100"
              onClick={onPutInMessage}
              size="icon-sm"
              type="button"
              variant="secondary"
            >
              <TextTIcon className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Put in message</TooltipContent>
        </Tooltip>
      )}
      {onRemove && <AttachmentRemoveButton onRemove={onRemove} />}
    </div>
  );
}
