import { type FileTab } from "@/client/atoms/orchestrator";
import { FileViewer } from "@/client/components/file-viewer";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ComputerPage, type FolderOnScreen } from "./computer-page";
import { useOrchestrator } from "./context";
import { hostPathOfMount, useOpenFileTab } from "./file-tabs";
import { useOnScreen } from "./on-screen";
import { useQuickLook } from "./quick-look";
import { useWindowTabs } from "./window-tabs";

/**
 * This Mac shows a folder or file in the current tab. Back returns to the
 * folder after opening a file; Space previews the selection in Quick Look.
 */
export function FilesScreen({
  file,
  path,
  root,
}: {
  /** The file this tab shows, by its virtual path; the folder when absent. */
  file: string | undefined;
  path: string;
  root: string;
}) {
  const { taskId } = useOrchestrator();
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
  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: taskId },
    }),
  );
  const [folder, setFolder] = useState<FolderOnScreen | null>(null);
  const quickLook = useQuickLook({ openFile });
  // Where the keyboard was when Quick Look opened, so it goes back there when
  // Quick Look closes and the arrows keep walking the folder.
  const activeFile: FileTab | undefined = file
    ? {
        ...(() => {
          const hostPath = hostPathOfMount(
            file,
            state.data?.attachedFolders ?? {},
            new Map(children.data?.map((child) => [child.id, child.dir])),
          );
          return hostPath ? { hostPath } : {};
        })(),
        mount: file,
        name: file.split("/").at(-1) ?? file,
      }
    : undefined;

  useOnScreen(
    activeFile
      ? {
          file: {
            mount: activeFile.mount,
            name: activeFile.name,
            path: activeFile.hostPath ?? activeFile.mount,
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

  const assetBase = getAssetBaseUrl(taskId);

  // A missing file returns to the preceding visit, or closes its dedicated tab.
  useEffect(() => {
    if (!file) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          getAssetUrl({ assetBase, filePath: file }),
          { headers: { Range: "bytes=0-0" }, signal: controller.signal },
        );
        if (response.status === 404 && !controller.signal.aborted) {
          toast(`${file.split("/").at(-1) ?? file} is no longer there`);
          leaveFile();
        }
      } catch {
        // The origin is not up, or the request was cut off: not the file's
        // absence, so the tab stays.
      }
    })();
    return () => {
      controller.abort();
    };
    // Once per file the tab shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetBase, file]);
  const viewerFile = (tab: FileTab) => ({
    filename: tab.name,
    filePath: tab.mount,
    taskId,
    url: getAssetUrl({ assetBase, filePath: tab.mount }),
  });

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
              key={activeFile.mount}
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
