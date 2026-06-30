import { devToolsPanelAtom } from "@/client/atoms/dev-tools";
import { filePreviewAtom } from "@/client/atoms/file-preview";
import { taskFileViewerAtom } from "@/client/atoms/task-file-viewer";
import { StudioSidebar } from "@/client/components/studio-sidebar";
import { StudioToolbar } from "@/client/components/studio-toolbar";
import { SidebarProvider } from "@/client/components/ui/sidebar";
import { Toaster } from "@/client/components/ui/sonner";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useInvalidateRouterOnUserChange } from "@/client/hooks/use-invalidate-router-on-user-change";
import { rpcClient } from "@/client/rpc/client";
import { SIDEBAR_WIDTH } from "@/shared/constants";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { Activity, lazy, Suspense } from "react";

const StudioCommandMenu = lazy(() =>
  import("@/client/components/studio-command-menu").then((module) => ({
    default: module.StudioCommandMenu,
  })),
);

const LazyFilePreviewModal = lazy(() =>
  import("@/client/components/file-preview-modal").then((module) => ({
    default: module.FilePreviewModal,
  })),
);

const LazyTaskFileViewerModal = lazy(() =>
  import("@/client/components/task/file-viewer-modal").then((module) => ({
    default: module.TaskFileViewerModal,
  })),
);

export const Route = createFileRoute("/_app")({
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        content: "",
        name: "opaque-background",
      },
    ],
  }),
});

const DevTools = lazy(() =>
  import("@/client/components/dev-tools").then((module) => ({
    default: module.DevTools,
  })),
);

const Agentation = import.meta.env.DEV
  ? lazy(() =>
      import("agentation").then((m) => ({
        default: m.Agentation,
      })),
    )
  : null;

function RouteComponent() {
  const isDeveloperMode = useDeveloperMode();
  const activePanel = useAtomValue(devToolsPanelAtom);
  const isFilePreviewOpen = useAtomValue(filePreviewAtom).isOpen;
  const isTaskFileViewerOpen = useAtomValue(taskFileViewerAtom).isModalOpen;
  const { data: sidebarState } = useQuery(
    rpcClient.sidebar.live.state.experimental_liveOptions({}),
  );
  const isSidebarOpen = sidebarState?.isOpen ?? true;

  useInvalidateRouterOnUserChange();

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      data-testid="app-page"
    >
      <StudioToolbar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Activity mode={isSidebarOpen ? "visible" : "hidden"}>
          <div
            className="flex h-full flex-col overflow-hidden border-r border-border"
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
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>

      {isDeveloperMode && (
        <Suspense fallback={null}>
          <DevTools />
        </Suspense>
      )}

      {Agentation && isDeveloperMode && activePanel === "agentation" && (
        <Suspense fallback={null}>
          <Agentation />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <StudioCommandMenu />
      </Suspense>
      {isTaskFileViewerOpen && (
        <Suspense fallback={null}>
          <LazyTaskFileViewerModal />
        </Suspense>
      )}
      {isFilePreviewOpen && (
        <Suspense fallback={null}>
          <LazyFilePreviewModal />
        </Suspense>
      )}
      <Toaster position="top-center" />
    </div>
  );
}
