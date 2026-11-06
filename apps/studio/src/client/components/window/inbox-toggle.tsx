import { inboxOpenAtom } from "@/client/atoms/window";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useAtom } from "jotai";

/**
 * The control ahead of a chat's title: puts the inbox column away so the chat
 * and its tabs have the window, and brings it back.
 */
export function InboxToggle() {
  const [isOpen, setOpen] = useAtom(inboxOpenAtom);
  const label = isOpen ? "Hide the inbox" : "Show the inbox";
  return (
    <ToolbarTooltip chord="toggleInbox" label={label}>
      <Button
        aria-label={label}
        className="size-7 shrink-0 text-muted-foreground/70"
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
