import { rightAreaOpenAtom } from "@/client/atoms/orchestrator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useAtom } from "jotai";

/**
 * The one control that puts the right area away as a whole and brings it
 * back, at the window bar's end: leaving a thread is one press, the inbox
 * takes the width, and the tabs keep what they have for the next time
 * something opens. Opening anything brings the area back on its own.
 */
export function RightAreaToggle() {
  const [isOpen, setOpen] = useAtom(rightAreaOpenAtom);
  const label = isOpen ? "Close the right area" : "Show the right area";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={!isOpen}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md hover:bg-foreground/5 hover:text-foreground",
            isOpen
              ? "text-muted-foreground"
              : "bg-foreground/8 text-foreground",
          )}
          onClick={() => {
            setOpen(!isOpen);
          }}
          type="button"
        >
          {/* The sidebar mark mirrored: the area on the right is the one it stands for. */}
          <SidebarSimpleIcon className="size-4 -scale-x-100" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
