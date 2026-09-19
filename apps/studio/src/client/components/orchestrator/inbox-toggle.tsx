import { inboxOpenAtom } from "@/client/atoms/orchestrator";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useAtom } from "jotai";

/**
 * The one control the window bar keeps at its left: puts the inbox column
 * away so a thread and its tabs have the window, and brings it back. Told
 * when nothing would be left on screen without the column, it stays put.
 */
export function InboxToggle({ isCollapsible }: { isCollapsible: boolean }) {
  const [isOpen, setOpen] = useAtom(inboxOpenAtom);
  const label = isOpen ? "Hide the inbox" : "Show the inbox";
  return (
    <ToolbarTooltip chord="toggleInbox" label={label}>
      <Button
        aria-label={label}
        className="size-7 shrink-0 text-foreground/80"
        disabled={isOpen && !isCollapsible}
        onClick={() => {
          setOpen(!isOpen);
        }}
        size="icon"
        variant="ghost-toolbar"
      >
        <SidebarSimpleIcon />
      </Button>
    </ToolbarTooltip>
  );
}
