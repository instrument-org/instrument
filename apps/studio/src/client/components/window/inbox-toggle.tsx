import { sidebarOpenAtom } from "@/client/atoms/tab-groups";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useAtom } from "jotai";

/**
 * The control at the toolbar's left, or ahead of a chat's title where a
 * group has no tabs: puts the sidebar of tab groups away and brings it back.
 */
export function InboxToggle() {
  const [isOpen, setOpen] = useAtom(sidebarOpenAtom);
  const label = isOpen ? "Hide the sidebar" : "Show the sidebar";
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
