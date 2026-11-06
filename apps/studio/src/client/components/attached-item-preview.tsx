import type { MouseEvent, ReactNode } from "react";

import { useFileDrag } from "@/client/hooks/use-file-drag";
import { ITEM_IN } from "@/client/lib/motion";
import { cn } from "@/client/lib/utils";
import { motion, useIsPresent } from "motion/react";
import { TextTIcon } from "@phosphor-icons/react/TextT";
import { XIcon } from "@phosphor-icons/react/X";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The look every chip over a composer's words shares, what was attached and
 * what goes with the message alike: one quiet line on a faint fill with a
 * hairline ring, its mark and its name, and an x inside its end.
 */
export const COMPOSER_CHIP_CLASSNAME =
  "inline-flex h-7 max-w-[min(100%,14rem)] min-w-0 shrink-0 items-center gap-1.5 rounded-[9px] bg-foreground/4 pl-1.5 text-[12.5px] text-foreground ring-1 ring-border";

/** The look of the chip that is up, among chips that are a band's tabs. */
export const COMPOSER_CHIP_SELECTED_CLASSNAME =
  "bg-foreground/[0.09] font-medium ring-foreground/20";

/**
 * One chip over a composer's words arriving and leaving: it grows into place
 * and shrinks away, the way a tab does, so what is added and what is taken
 * off is seen to be. Under an `AnimatePresence`, keyed by what it names. It
 * takes no press on its way out, which would act on what is already gone.
 */
export function ChipPresence({ children }: { children: ReactNode }) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      animate={{ opacity: 1, scale: 1 }}
      className="flex max-w-full min-w-0"
      exit={{ opacity: 0, scale: 0.9 }}
      inert={!isPresent}
      initial={{ opacity: 0, scale: 0.9 }}
      transition={ITEM_IN}
    >
      {children}
    </motion.div>
  );
}

/**
 * Something attached to the message, as a chip: its mark (a file's type, a
 * folder, a picture's own thumbnail) and its name, pressed to look at it, and
 * an x that takes it out.
 */
export function AttachedItemPreview({
  hostPath,
  icon,
  isSelected = false,
  label,
  onClick,
  onPutInMessage,
  onRemove,
  tooltip,
}: {
  /** Where it is on disk, which dragging it out of the window carries; none for words pasted in. */
  hostPath?: string;
  icon: ReactNode;
  /** Whether what it names is the one shown under the composer or beside it. */
  isSelected?: boolean;
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
      aria-pressed={onClick ? isSelected : undefined}
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
      className={cn(
        COMPOSER_CHIP_CLASSNAME,
        onRemove ? "pr-1" : "pr-2",
        isSelected && COMPOSER_CHIP_SELECTED_CLASSNAME,
      )}
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
