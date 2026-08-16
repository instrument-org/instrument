import { Kbd } from "@/client/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";

/**
 * The way back, on every screen that has one.
 *
 * The tooltip carries the key rather than the footer: Escape does this
 * everywhere in the panel, and a hint repeated on every screen is one nobody
 * reads. Here it is only in the way of someone already reaching for the mouse.
 */
export function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label="Back"
        className="ml-2 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeftIcon className="size-4" />
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-1.5">
        Back
        <Kbd>esc</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
