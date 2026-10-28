import { inboxOpenAtom } from "@/client/atoms/window";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useAtom } from "jotai";

/**
 * The control ahead of a chat's title: puts the inbox column away so the
 * chat and its tabs have the window, and brings it back. Told when
 * nothing would be left on screen without the column, it stays put.
 */
export function InboxToggle({ isCollapsible }: { isCollapsible: boolean }) {
  const [isOpen, setOpen] = useAtom(inboxOpenAtom);
  const label = isOpen ? "Hide the inbox" : "Show the inbox";
  return (
    <ToolbarTooltip chord="toggleInbox" label={label}>
      <Button
        aria-label={label}
        // The grey of the glyph across the head that pops the chat out.
        className="size-7 shrink-0 text-muted-foreground/70"
        disabled={isOpen && !isCollapsible}
        onClick={() => {
          setOpen(!isOpen);
        }}
        size="icon"
        variant="ghost-toolbar"
      >
        <SidebarSimpleIcon className="size-4" />
      </Button>
    </ToolbarTooltip>
  );
}
