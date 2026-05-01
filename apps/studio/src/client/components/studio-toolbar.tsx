import { NavControls } from "@/client/components/nav-controls";
import TabBar from "@/client/components/tab-bar";
import { Button } from "@/client/components/ui/button";
import { cn, isLinux, isMacOS, isWindows } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { SidebarSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";

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

  const hasExceptions = (exceptions?.length ?? 0) > 0;
  const isSidebarOpen = sidebarState?.isOpen ?? true;

  return (
    <div
      className="flex w-full items-end overflow-hidden bg-secondary"
      style={{ height: `${TOOLBAR_HEIGHT}px` }}
    >
      {/* Toolbar controls region shares the tab background. */}
      <div
        className={cn(
          "flex h-full shrink-0 items-center [-webkit-app-region:drag]",
          isMacOS() ? "pl-20" : "pl-4",
        )}
      >
        <div className="flex items-center [-webkit-app-region:no-drag]">
          {isSidebarOpen ? (
            <Button
              className="size-6 pr-1 text-muted-foreground"
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
              className="relative size-6 shrink-0 pr-1 text-muted-foreground"
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
      </header>
    </div>
  );
}
