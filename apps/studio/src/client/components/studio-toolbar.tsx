import { NavControls } from "@/client/components/nav-controls";
import TabBar from "@/client/components/tab-bar";
import { Button } from "@/client/components/ui/button";
import { UpdateStatusIndicator } from "@/client/components/update-status-indicator";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { cn, isLinux, isMacOS, isWindows } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { SidebarSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";

const DevPanel = lazy(() =>
  import("@/client/components/dev-panel").then((m) => ({
    default: m.DevPanel,
  })),
);

export function StudioToolbar() {
  const { data: sidebarState } = useQuery(
    rpcClient.sidebar.live.state.experimental_liveOptions({}),
  );

  const { mutate: openSidebar } = useMutation(
    rpcClient.sidebar.open.mutationOptions(),
  );

  const { mutate: closeSidebar } = useMutation(
    rpcClient.sidebar.close.mutationOptions(),
  );

  const { data: exceptions } = useQuery(
    rpcClient.utils.live.serverExceptions.experimental_liveOptions({}),
  );

  const isDeveloperMode = useDeveloperMode();
  const hasExceptions = (exceptions?.length ?? 0) > 0;
  const isSidebarOpen = sidebarState?.isOpen ?? true;

  return (
    <div
      className="flex w-full items-end overflow-hidden bg-gray-200 dark:bg-gray-800"
      style={{ height: `${TOOLBAR_HEIGHT}px` }}
    >
      {/* Toolbar controls region shares the tab background. */}
      <div
        className={cn(
          "flex h-full shrink-0 items-center [-webkit-app-region:drag]",
          isMacOS() ? undefined : "pl-4",
        )}
        // The macOS traffic-light gutter must stay a fixed visual width, so divide
        // it by the shell zoom: the zoomed root scales it back to a constant 5rem
        // and the OS-drawn buttons (real pixels, unzoomed) always fit.
        style={
          isMacOS()
            ? { paddingLeft: "calc(5rem / var(--app-zoom, 1))" }
            : undefined
        }
      >
        <div className="flex items-center gap-4 [-webkit-app-region:no-drag]">
          {isSidebarOpen ? (
            <Button
              className="size-6 text-foreground/80"
              onClick={() => {
                closeSidebar();
              }}
              size="icon"
              variant="ghost"
            >
              <SidebarSimpleIcon />
            </Button>
          ) : (
            <Button
              className="relative size-6 shrink-0 text-foreground/80"
              onClick={() => {
                openSidebar();
              }}
              size="icon"
              title="Show sidebar"
              variant="ghost"
            >
              <SidebarSimpleIcon />
              {hasExceptions && (
                <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-destructive" />
              )}
            </Button>
          )}
          <NavControls />
        </div>
      </div>
      {/* Main toolbar region: tab bar */}
      <header
        className={cn(
          "flex h-full min-w-0 flex-1 items-center",
          isWindows() && "pr-36",
          isLinux() && "pr-24",
        )}
      >
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
      </header>
    </div>
  );
}
