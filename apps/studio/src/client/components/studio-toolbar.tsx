import { InternalLink } from "@/client/components/internal-link";
import { NavControls } from "@/client/components/nav-controls";
import TabBar from "@/client/components/tab-bar";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { UpdateStatusIndicator } from "@/client/components/update-status-indicator";
import { WindowControls } from "@/client/components/window-controls";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { toggleSidebar, useSidebarOpen } from "@/client/hooks/use-sidebar";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { lazy, Suspense } from "react";

// Matches the sidebar rail's slide, so the button and the sidebar move together.
const SLIDE_TRANSITION = {
  damping: 42,
  stiffness: 520,
  type: "spring",
} as const;
const FADE_TRANSITION = { duration: 0.14, ease: "easeOut" } as const;

const DevPanel = lazy(() =>
  import("@/client/components/dev-panel").then((m) => ({
    default: m.DevPanel,
  })),
);

export function StudioToolbar() {
  const isSidebarOpen = useSidebarOpen();

  const { data: exceptions } = useQuery(
    rpcClient.utils.live.serverExceptions.experimental_liveOptions({}),
  );

  const isDeveloperMode = useDeveloperMode();
  const hasExceptions = (exceptions?.length ?? 0) > 0;

  const prefersReducedMotion = useReducedMotion();
  // Reduced motion snaps the slot open/closed and only crossfades; otherwise the
  // button grows out of the nav group on the spring the sidebar slides on.
  const revealTransition = prefersReducedMotion
    ? { duration: 0, opacity: { duration: 0.1 } }
    : { ...SLIDE_TRANSITION, opacity: FADE_TRANSITION };

  return (
    <div
      className="flex w-full items-end overflow-hidden bg-gray-200 select-none dark:bg-gray-800"
      style={{ height: `${TOOLBAR_HEIGHT}px` }}
    >
      {/* Toolbar controls region shares the tab background. */}
      <div
        className={cn(
          "flex h-full shrink-0 items-center [-webkit-app-region:drag]",
          isMacOS() ? undefined : "pl-4",
        )}
        // The macOS traffic-light gutter must stay a fixed visual width, so divide
        // it by the main-window zoom: the zoomed root scales it back to a constant
        // 5rem and the OS-drawn buttons (real pixels, unzoomed) always fit. That is
        // the 12px cluster inset plus the 52px cluster, leaving the sidebar icon the
        // same 22px from the lights that the row keeps between its own icons.
        style={
          isMacOS()
            ? { paddingLeft: "calc(5rem / var(--app-zoom, 1))" }
            : undefined
        }
      >
        {/* Every control here is a 28px hit box around a 16px icon, so each gap in
            the row is the intended icon-to-icon distance less the 6px of padding a
            box adds on each side: 8px here reads as 20px between icons, and the
            -4px trailing offset lands the last icon 14px from the tab bar. */}
        <div className="-mr-1 flex items-center gap-2 [-webkit-app-region:no-drag]">
          <ToolbarTooltip shortcut="toggleSidebar">
            <Button
              className="relative size-7 shrink-0 text-foreground/80"
              onClick={() => {
                toggleSidebar();
              }}
              size="icon"
              variant="ghost-toolbar"
            >
              <SidebarSimpleIcon />
              {/* An open sidebar shows the exceptions alert itself, so the badge
                  is only its closed-state stand-in. */}
              {!isSidebarOpen && hasExceptions && (
                <span className="absolute top-1 right-1 size-2 rounded-full bg-destructive" />
              )}
            </Button>
          </ToolbarTooltip>
          <div className="flex items-center">
            <NavControls />
            {/* The sidebar carries its own New task button, so this only fills in
                for it while the sidebar is hidden. Its slot opens and closes on the
                sidebar's own slide spring. */}
            <AnimatePresence initial={false}>
              {!isSidebarOpen && (
                <motion.div
                  animate={{ marginLeft: 8, opacity: 1, scale: 1, width: 28 }}
                  className="flex shrink-0 items-center"
                  exit={{ marginLeft: 0, opacity: 0, scale: 0.8, width: 0 }}
                  initial={{ marginLeft: 0, opacity: 0, scale: 0.8, width: 0 }}
                  transition={revealTransition}
                >
                  <ToolbarTooltip shortcut="newTask">
                    <Button
                      asChild
                      className="size-7 text-foreground/80"
                      size="icon"
                      variant="ghost-toolbar"
                    >
                      <InternalLink openInCurrentTab to="/new-tab">
                        <NotePencilIcon />
                      </InternalLink>
                    </Button>
                  </ToolbarTooltip>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      {/* Main toolbar region: tab bar */}
      <header className="flex h-full min-w-0 flex-1 items-center">
        <div className="flex h-full min-w-0 flex-1 items-stretch">
          <TabBar />
        </div>
        <div className="flex h-full shrink-0 items-center gap-x-2 px-3 [-webkit-app-region:no-drag]">
          {isDeveloperMode && (
            <Suspense fallback={null}>
              <DevPanel />
            </Suspense>
          )}
          <UpdateStatusIndicator />
        </div>
        <WindowControls />
      </header>
    </div>
  );
}
