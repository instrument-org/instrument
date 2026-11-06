import type { MouseEvent, ReactNode } from "react";

import { useFileDrag } from "@/client/hooks/use-file-drag";
import { cn } from "@/client/lib/utils";
import { TextTIcon } from "@phosphor-icons/react/TextT";
import { XIcon } from "@phosphor-icons/react/X";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The look every chip over a composer's words shares, what was attached and
 * what goes with the message alike: one quiet line on a faint fill with a
 * hairline ring, its mark and its name, and an x inside its end.
 */
export const COMPOSER_CHIP_CLASSNAME =
  "inline-flex h-7 max-w-56 min-w-0 shrink-0 items-center gap-1.5 rounded-[9px] bg-foreground/4 pl-1.5 text-[12.5px] text-foreground ring-1 ring-border";

/** The look of the chip that is up, among chips that are a band's tabs. */
export const COMPOSER_CHIP_SELECTED_CLASSNAME =
  "bg-foreground/[0.09] font-medium ring-foreground/20";

/**
 * Something attached to the message, as a chip: its mark (a file's type, a
 * folder, a picture's own thumbnail) and its name, pressed to look at it, and
 * an x that takes it out.
 */
export function AttachedItemPreview({
  hostPath,
  icon,
  label,
  onClick,
  onPutInMessage,
  onRemove,
  tooltip,
}: {
  /** Where it is on disk, which dragging it out of the window carries; none for words pasted in. */
  hostPath?: string;
  icon: ReactNode;
  label: string;
  /** A press on the chip, with what held keys say about where it opens. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Offered beside the remove button, for an attachment that is really words. */
  onPutInMessage?: () => void;
  onRemove?: () => void;
  tooltip?: ReactNode;
}) {
  const dragProps = useFileDrag(hostPath ? { hostPath } : undefined);
  const body = (
    <button
      {...dragProps}
      className="flex h-full min-w-0 cursor-default items-center gap-1.5 outline-none"
      onClick={onClick}
      type="button"
    >
      <span className="grid size-4 shrink-0 place-items-center overflow-hidden rounded-[3px] [&_img]:size-4 [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
  return (
    <span
      className={cn(COMPOSER_CHIP_CLASSNAME, onRemove ? "pr-1" : "pr-2")}
      data-slot="attached-chip"
    >
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{body}</TooltipTrigger>
          <TooltipContent
            className="wrap-break-word"
            collisionPadding={10}
            maxWidth="500px"
          >
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        body
      )}
      {onPutInMessage && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Put in message"
              className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
              onClick={onPutInMessage}
              type="button"
            >
              <TextTIcon className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Put in message</TooltipContent>
        </Tooltip>
      )}
      {onRemove && (
        <button
          aria-label={`Remove ${label}`}
          className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
          onClick={onRemove}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  );
}
