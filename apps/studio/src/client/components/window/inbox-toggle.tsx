import { sidebarOpenAtom } from "@/client/atoms/tab-groups";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useAtom, useAtomValue } from "jotai";
import { type ReactNode, useEffect } from "react";

/** Puts the sidebar of tab groups away and brings it back. */
function InboxToggle() {
  const [isOpen, setOpen] = useAtom(sidebarOpenAtom);
  const label = isOpen ? "Hide the sidebar" : "Show the sidebar";
  return (
    <ToolbarTooltip chord="toggleSidebar" label={label}>
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
 * Where the sidebar toggle stands: first in the leftmost side's tab strip,
 * just before its first tab, the same spot whether the sidebar is out or
 * away, centered on the strip as its tabs are.
 */
export function SidebarToggleSlot({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center px-1">{children}</div>;
}

/** The sidebar toggle in its slot at the start of the leftmost tab strip. */
export function SidebarToggle() {
  return (
    <SidebarToggleSlot>
      <InboxToggle />
    </SidebarToggleSlot>
  );
}

/**
 * The Mac's traffic lights go and come back with the sidebar, so a window
 * whose sidebar is away has its top left to its tabs.
 */
export function TrafficLightsWithSidebar() {
  const isSidebarOpen = useAtomValue(sidebarOpenAtom);
  useEffect(() => {
    if (isMacOS()) {
      void safe(
        rpcClient.utils.showTrafficLights.call({ isShown: isSidebarOpen }),
      );
    }
  }, [isSidebarOpen]);
  return null;
}

/**
 * How far the sidebar's top row starts from the window's left edge: past
 * the traffic lights on a Mac, which keep their size whatever the app's
 * zoom, and 12px in elsewhere.
 */
export function sidebarTopInset() {
  return isMacOS() ? "calc(4.5rem / var(--app-zoom, 1))" : "12px";
}
