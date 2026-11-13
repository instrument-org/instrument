import { sidebarOpenAtom } from "@/client/atoms/tab-groups";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { isMacOS } from "@/client/lib/utils";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useAtom } from "jotai";

/** Puts the sidebar of tab groups away and brings it back. */
function InboxToggle() {
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

/**
 * How far the sidebar toggle stands from the window's left edge: just past
 * the traffic lights on a Mac, which keep their size whatever the app's
 * zoom, or 12px in elsewhere, where its mark stands on the sidebar's column
 * of icons.
 */
export function toggleLeft() {
  return isMacOS() ? "calc(4.5rem / var(--app-zoom, 1))" : "12px";
}

/**
 * The sidebar toggle in its one spot at the window's top left: first in the
 * sidebar's top row while the sidebar is out, and over the card's top row,
 * which leaves it room (`SidebarToggleRoom`), while it is away.
 */
export function SidebarToggleCorner() {
  return (
    <div
      className="absolute top-0 z-30 flex h-10 items-center [-webkit-app-region:no-drag]"
      style={{ left: toggleLeft() }}
    >
      <InboxToggle />
    </div>
  );
}

/**
 * The room a row at the card's top left leaves for the traffic lights and
 * the toggle while the sidebar is away: the toggle's spot and its 28px, less
 * the card's 8px inset, and a 4px gap.
 */
export function SidebarToggleRoom() {
  return (
    <div
      className="shrink-0"
      style={{ width: `calc(${toggleLeft()} + 1.5rem)` }}
    />
  );
}
