import { inboxOpenAtom } from "@/client/atoms/window";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useAtom } from "jotai";

/**
 * The control at the head of the window's bar: puts the inbox column away so
 * the chat and its tabs have the window, and brings it back. It does so only
 * while a chat is up, since the column is the whole of the inbox and no other
 * screen has one.
 */
export function InboxToggle({ isChatUp }: { isChatUp: boolean }) {
  const [isOpen, setOpen] = useAtom(inboxOpenAtom);
  const label = isOpen ? "Hide the inbox" : "Show the inbox";
  return (
    <ToolbarTooltip chord="toggleInbox" label={label}>
      <Button
        aria-label={label}
        className="size-7 shrink-0 text-muted-foreground/70"
        disabled={!isChatUp}
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
