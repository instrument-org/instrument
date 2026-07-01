import { devToolsPanelAtom } from "@/client/atoms/dev-tools";
import { filePreviewAtom } from "@/client/atoms/file-preview";
import { taskFileViewerAtom } from "@/client/atoms/task-file-viewer";
import { StudioModals } from "@/client/components/studio-modals/studio-modals";
import { StudioSidebarRail } from "@/client/components/studio-sidebar-rail";
import { StudioToolbar } from "@/client/components/studio-toolbar";
import { Toaster } from "@/client/components/ui/sonner";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import {
  setSidebarOpen,
  toggleSidebar,
  useSidebarOpen,
} from "@/client/hooks/use-sidebar";
import { useToggleSidebar } from "@/client/hooks/use-toggle-sidebar";
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
 * context (provided by AppShell), so highlights and navigation follow the
 * foreground tab without the chrome remounting when tabs switch. `children` is
 * the kept-mounted stack of per-tab content.
 */
export function AppChrome({ children }: { children: ReactNode }) {
  const isDeveloperMode = useDeveloperMode();
  const activePanel = useAtomValue(devToolsPanelAtom);
  const isFilePreviewOpen = useAtomValue(filePreviewAtom).isOpen;
  const isTaskFileViewerOpen = useAtomValue(taskFileViewerAtom).isModalOpen;
  const isSidebarOpen = useSidebarOpen();

  // The native Toggle Sidebar menu item (Cmd+B) is a stateless dispatcher; the
  // renderer owns the state, so it flips the atom here.
  useToggleSidebar(toggleSidebar);

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      data-testid="app-page"
    >
      <StudioToolbar />
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
  );
}
