import { filePreviewAtom } from "@/client/atoms/file-preview";
import { taskFileViewerAtom } from "@/client/atoms/task-file-viewer";
import { Toaster } from "@/client/components/ui/sonner";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useInvalidateRouterOnUserChange } from "@/client/hooks/use-invalidate-router-on-user-change";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { lazy, Suspense } from "react";

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

const LazyProjectFileViewerModal = lazy(() =>
  import("@/client/components/task/file-viewer-modal").then((module) => ({
    default: module.ProjectFileViewerModal,
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

const DevPanel = lazy(() =>
  import("@/client/components/dev-panel").then((m) => ({
    default: m.DevPanel,
  })),
);

function RouteComponent() {
  const isDeveloperMode = useDeveloperMode();
  const isFilePreviewOpen = useAtomValue(filePreviewAtom).isOpen;
  const isProjectFileViewerOpen = useAtomValue(taskFileViewerAtom).isModalOpen;

  useInvalidateRouterOnUserChange();

  return (
    <div className="relative flex h-dvh flex-col" data-testid="app-page">
      <Outlet />

      {isDeveloperMode && (
        <Suspense fallback={null}>
          <DevTools />
        </Suspense>
      )}

      {isDeveloperMode && (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <StudioCommandMenu />
      </Suspense>
      {isProjectFileViewerOpen && (
        <Suspense fallback={null}>
          <LazyProjectFileViewerModal />
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
