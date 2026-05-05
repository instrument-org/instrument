import { StudioSidebar } from "@/client/components/studio-sidebar";
import { StudioToolbar } from "@/client/components/studio-toolbar";
import { SidebarProvider } from "@/client/components/ui/sidebar";
import { SIDEBAR_WIDTH } from "@/shared/constants";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity } from "react";

import { rpcClient } from "../rpc/client";

export const Route = createFileRoute("/shell")({
  component: ShellPage,
});

function ShellPage() {
  const { data: sidebarState } = useQuery(
    rpcClient.sidebar.live.state.experimental_liveOptions({}),
  );
  const isOpen = sidebarState?.isOpen ?? true;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden select-none">
      <StudioToolbar />
      <div className="flex min-h-0 flex-1 overflow-hidden [-webkit-app-region:no-drag]">
        <Activity mode={isOpen ? "visible" : "hidden"}>
          <div
            className="flex h-full flex-col overflow-hidden overflow-x-hidden border-r border-border"
            data-testid="shell-page"
            style={
              {
                "--sidebar-width": `${SIDEBAR_WIDTH}px`,
                width: `${SIDEBAR_WIDTH}px`,
              } as React.CSSProperties
            }
          >
            <SidebarProvider className="min-h-0 flex-1">
              <StudioSidebar className="h-full" />
            </SidebarProvider>
          </div>
        </Activity>
      </div>
    </div>
  );
}
