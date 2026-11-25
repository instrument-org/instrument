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
function TrafficLightsWithSidebar() {
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

/** The window's top left corner: the traffic lights on a Mac, the app's menu elsewhere. */
export function WindowCorner() {
  return isMacOS() ? <TrafficLightsWithSidebar /> : <AppMenuButton />;
}

/**
 * The app's menu, off the Mac, where no menu bar shows it, past the system's
 * caption buttons where a Linux desktop keeps them on the left.
 */
function AppMenuButton() {
  return (
    <button
      aria-label="Menu"
      className="absolute top-0.5 z-30 grid size-7 shrink-0 place-items-center rounded-md text-foreground/80 hover:bg-foreground/5 [-webkit-app-region:no-drag]"
      onClick={({ currentTarget }) => {
        const { bottom, left } = currentTarget.getBoundingClientRect();
        void rpcClient.window.showAppMenu.call({ x: left, y: bottom });
      }}
      style={{
        left: "calc(env(titlebar-area-x, 0px) / var(--app-zoom, 1) + 10px)",
      }}
      title="Menu"
      type="button"
    >
      <span className="text-base leading-none">≡</span>
    </button>
  );
}

/**
 * How far the sidebar's top row starts from the window's left edge: past
 * the window's corner, whose system buttons keep their size whatever the
 * app's zoom.
 */
export function sidebarTopInset() {
  return isMacOS()
    ? "calc(4.5rem / var(--app-zoom, 1))"
    : "calc(env(titlebar-area-x, 0px) / var(--app-zoom, 1) + 42px)";
}
