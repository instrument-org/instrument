import { type FileTab } from "@/client/atoms/orchestrator";
import { FileViewer } from "@/client/components/file-viewer";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { fileUrlOf } from "@/client/lib/file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ComputerPage, type FolderOnScreen } from "./computer-page";
import { useOrchestrator } from "./context";
import { mountOfHostPath, useOpenFileTab } from "./file-tabs";
import { segmentsOf } from "./host-path";
import { useOnScreen } from "./on-screen";
import { useQuickLook } from "./quick-look";
import { useWindowTabs } from "./window-tabs";

/**
 * This Mac shows a folder or file in the current tab. Back returns to the
 * folder after opening a file; Space previews the selection in Quick Look.
 *
 * A page's file (HTML) is not shown here at all: it is what a browser is for,
 * so this tab becomes a page tab showing the file at its `file://` address,
 * with the browser's own semantics for a local file. Asked for its source,
 * the tab keeps the file and shows its text.
 */
export function FilesScreen({
  file,
  path,
  root,
  source,
}: {
  /** The file this tab shows, by where it is on the computer; the folder when absent. */
  file: string | undefined;
  path: string;
  root: string;
  /** Whether a page's file is shown as its text rather than as the page. */
  source: boolean;
}) {
  const { browser, openPage, taskId } = useOrchestrator();
  const { closeActive, step, stepVisit } = useWindowTabs();
  const router = useRouter();
  const leaveFile = () => {
    const href = step(-1);
    if (href !== undefined) {
      router.history.push(href);
    } else if (!stepVisit(-1)) {
      closeActive();
    }
  };
  const openFile = useOpenFileTab();
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({ input: { id: taskId } }),
  );
  const [folder, setFolder] = useState<FolderOnScreen | null>(null);
  const quickLook = useQuickLook({ openFile });
  const activeFile: FileTab | undefined = file
    ? { hostPath: file, name: segmentsOf(file).at(-1) ?? file }
    : undefined;
  const pageFile =
    activeFile !== undefined &&
    !source &&
    getFileType({ filename: activeFile.name }) === "html"
      ? activeFile.hostPath
      : undefined;
  const opensAsPage = pageFile !== undefined;
  // The browser is mounted by the layout and may arrive after this screen
  // does, as it does when the window opens on a file: the page is asked for
  // once there is a browser to show it.
  const hasBrowser = browser !== null;
  useEffect(() => {
    if (pageFile !== undefined && hasBrowser) {
      openPage(fileUrlOf(pageFile));
    }
    // Once per file the tab arrives at; the page takes the tab over from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageFile, hasBrowser]);
  // How the agent reaches the file, when a granted folder covers it: the one
  // thing the conversation is told about the file that the person is not.
  const activeMount = activeFile
    ? mountOfHostPath(activeFile.hostPath, state.data?.attachedFolders ?? {})
    : undefined;

  useOnScreen(
    activeFile
      ? {
          file: {
            ...(activeMount === undefined ? {} : { mount: activeMount }),
            name: activeFile.name,
            path: activeFile.hostPath,
          },
          screen: "file",
        }
      : folder
        ? {
            folder: {
              ...(folder.access ? { access: folder.access } : {}),
              display: folder.display,
              ...(folder.mount ? { mount: folder.mount } : {}),
              selected: folder.selected,
            },
            screen: "computer",
          }
        : null,
  );

  // A missing file returns to the preceding visit, or closes its dedicated tab.
  useEffect(() => {
    if (!file) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(getComputerFileUrl({ hostPath: file }), {
          headers: { Range: "bytes=0-0" },
          signal: controller.signal,
        });
        if (response.status === 404 && !controller.signal.aborted) {
          toast(`${segmentsOf(file).at(-1) ?? file} is no longer there`);
          leaveFile();
        }
      } catch {
        // The channel is not up, or the request was cut off: not the file's
        // absence, so the tab stays.
      }
    })();
    return () => {
      controller.abort();
    };
    // Once per file the tab shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  const viewerFile = (tab: FileTab) => ({
    filename: tab.name,
    hostPath: tab.hostPath,
    url: getComputerFileUrl({ hostPath: tab.hostPath }),
  });

  if (opensAsPage) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {activeFile ? (
          // Where the file sits on the Mac is the row above, which every tab
          // wears, so the viewer is the whole of the tab.
          <div className="h-full p-3">
            <FileViewer
              className="h-full"
              file={viewerFile(activeFile)}
              key={activeFile.hostPath}
              onClose={leaveFile}
            />
          </div>
        ) : (
          <ComputerPage
            onFolderChange={(next) => {
              setFolder((current) =>
                JSON.stringify(current) === JSON.stringify(next)
                  ? current
                  : next,
              );
            }}
            onOpenFile={openFile}
            path={path}
            root={root}
            {...quickLook.props}
          />
        )}
      </div>
      {quickLook.dialog}
    </div>
  );
}
