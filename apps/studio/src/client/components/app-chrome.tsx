import { devToolsPanelAtom } from "@/client/atoms/dev-tools";
import { filePreviewAtom } from "@/client/atoms/file-preview";
import { taskFileViewerAtom } from "@/client/atoms/task-file-viewer";
import { StudioModals } from "@/client/components/studio-modals/studio-modals";
import { StudioSidebarRail } from "@/client/components/studio-sidebar-rail";
import { StudioToolbar } from "@/client/components/studio-toolbar";
import { Toaster } from "@/client/components/ui/sonner";
import { UpdateReminder } from "@/client/components/update-reminder";
import { UpdateRequiredScreen } from "@/client/components/update-required-screen";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { setSidebarOpen, useSidebarOpen } from "@/client/hooks/use-sidebar";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { lazy, type ReactNode, Suspense } from "react";

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

/**
 * The persistent window chrome (toolbar, tab bar, sidebar) and app-wide modals,
 * rendered once for the whole main window. It reads the active tab's router from
 * context (provided by MainWindow), so highlights and navigation follow the
 * foreground tab without the chrome remounting when tabs switch. `children` is
 * the kept-mounted stack of per-tab content.
 */
export function AppChrome({ children }: { children: ReactNode }) {
  const isDeveloperMode = useDeveloperMode();
  const activePanel = useAtomValue(devToolsPanelAtom);
  const isFilePreviewOpen = useAtomValue(filePreviewAtom).isOpen;
  const isTaskFileViewerOpen = useAtomValue(taskFileViewerAtom).isModalOpen;
  const isSidebarOpen = useSidebarOpen();

  const { data: updateRequirement } = useQuery(
    rpcClient.updates.live.requirement.experimental_liveOptions({}),
  );
  const isUpdateRequired = updateRequirement?.required === true;

  // The overlay below only intercepts pointer input, so while the block is up
  // the retained chrome also goes inert (unfocusable, unreachable by keyboard)
  // and tab shortcuts like Cmd+T / Cmd+W are suppressed as with any blocking
  // modal.
  useBlockTabNavigation(isUpdateRequired);

  return (
    <>
      <div
        className="flex h-full w-full flex-col overflow-hidden"
        data-testid="app-page"
        inert={isUpdateRequired}
      >
        <StudioToolbar />
        <UpdateReminder />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <StudioSidebarRail
            isOpen={isSidebarOpen}
            onCollapse={() => {
              setSidebarOpen(false);
            }}
          />
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {children}
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
        <StudioModals />
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
      {/* A build below the server-enforced minimum version is blocked: the
          required screen covers the chrome and every tab. An overlay (not an
          early return) keeps the tab stack mounted so a requirement flip loses
          no state, and it lives outside the inert chrome subtree; z-100 clears
          the z-50 dialog layer. */}
      {updateRequirement?.required && (
        <div className="fixed inset-0 z-100">
          <UpdateRequiredScreen
            downloadUrl={updateRequirement.downloadUrl}
            message={updateRequirement.message}
          />
        </div>
      )}
    </>
  );
}
