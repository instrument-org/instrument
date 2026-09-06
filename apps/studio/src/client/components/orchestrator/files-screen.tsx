import {
  closedFileTabsAtom,
  type FileTab,
  fileTabsAtom,
} from "@/client/atoms/orchestrator";
import { FileIcon } from "@/client/components/file-icon";
import { FileViewer } from "@/client/components/file-viewer";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { cn } from "@/client/lib/utils";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useState } from "react";

import { ComputerPage, type FolderOnScreen } from "./computer-page";
import { useOrchestrator } from "./context";
import { useOnScreen } from "./on-screen";
import { TabStrip } from "./tab-strip";

const FOLDER_TAB = "folder";

/**
 * This Mac as a tabbed screen: the folder browser in the first tab, held
 * there, and every file the user opened from it or the conversation in a tab
 * of its own beside it, so a file opens without the folder going away and the
 * strip is the way back. The tabs are the browser's tabs, drawn by the same
 * strip. Space on a file the browser has selected shows it over the whole
 * window, the way the Finder's Quick Look does; a double click opens the tab.
 */
export function FilesScreen({
  file,
  path,
  root,
}: {
  /** The file tab on screen, by its virtual path; the folder tab when absent. */
  file: string | undefined;
  path: string;
  root: string;
}) {
  const { taskId } = useOrchestrator();
  const navigate = useNavigate();
  const [fileTabs, setFileTabs] = useAtom(fileTabsAtom);
  const setClosed = useSetAtom(closedFileTabsAtom);
  const [folder, setFolder] = useState<FolderOnScreen | null>(null);
  const [quickLook, setQuickLook] = useState<FileTab | null>(null);
  const activeFile = file
    ? fileTabs.find((tab) => tab.mount === file)
    : undefined;

  // A file in the address that the strip does not hold yet (a link followed
  // from Recent after a launch) joins the strip.
  useEffect(() => {
    if (!file || fileTabs.some((tab) => tab.mount === file)) {
      return;
    }
    setFileTabs((current) => [
      ...current,
      { mount: file, name: file.split("/").at(-1) ?? file },
    ]);
  }, [file, fileTabs, setFileTabs]);

  useOnScreen(
    activeFile
      ? {
          file: {
            mount: activeFile.mount,
            name: activeFile.name,
            path: activeFile.hostPath ?? activeFile.mount,
          },
          ...(folder
            ? {
                folder: {
                  ...(folder.access ? { access: folder.access } : {}),
                  display: folder.display,
                  ...(folder.mount ? { mount: folder.mount } : {}),
                  selected: [],
                },
              }
            : {}),
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

  const showFolder = () => {
    void navigate({ search: { path, root }, to: "/orchestrator/computer" });
  };
  const showFile = (mount: string) => {
    void navigate({
      search: { file: mount, path, root },
      to: "/orchestrator/computer",
    });
  };
  const openFile = (tab: FileTab) => {
    setFileTabs((current) =>
      current.some((entry) => entry.mount === tab.mount)
        ? current
        : [...current, tab],
    );
    showFile(tab.mount);
  };
  const closeFile = (mount: string) => {
    const index = fileTabs.findIndex((tab) => tab.mount === mount);
    const closing = fileTabs[index];
    const remaining = fileTabs.filter((tab) => tab.mount !== mount);
    setFileTabs(remaining);
    if (closing) {
      setClosed((current) => [...current, closing]);
    }
    if (file === mount) {
      const next = remaining[Math.max(0, index - 1)];
      if (next) {
        showFile(next.mount);
      } else {
        showFolder();
      }
    }
  };

  const assetBase = getAssetBaseUrl(taskId);

  // A tab whose file is gone (renamed, moved, deleted) goes with it rather
  // than standing as a tab that cannot load. Checked when the strip changes,
  // by asking the asset origin for the file.
  const tabKeys = fileTabs.map((tab) => tab.mount).join("\n");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const gone: string[] = [];
      for (const mount of tabKeys.split("\n").filter(Boolean)) {
        try {
          const response = await fetch(
            getAssetUrl({ assetBase, filePath: mount }),
            { headers: { Range: "bytes=0-0" }, signal: controller.signal },
          );
          if (response.status === 404) {
            gone.push(mount);
          }
        } catch {
          // The origin is not up, or the request was cut off: not the file's
          // absence, so the tab stays.
        }
      }
      if (!controller.signal.aborted && gone.length > 0) {
        setFileTabs((current) =>
          current.filter((tab) => !gone.includes(tab.mount)),
        );
      }
    })();
    return () => {
      controller.abort();
    };
  }, [assetBase, setFileTabs, tabKeys]);
  const viewerFile = (tab: FileTab) => ({
    filename: tab.name,
    filePath: tab.mount,
    taskId,
    url: getAssetUrl({ assetBase, filePath: tab.mount }),
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabStrip
        className="border-b border-border"
        onClose={closeFile}
        onReorder={(keys) => {
          setFileTabs((current) =>
            keys.flatMap((key) => {
              const tab = current.find((entry) => entry.mount === key);
              return tab ? [tab] : [];
            }),
          );
        }}
        onSelect={(key) => {
          if (key === FOLDER_TAB) {
            showFolder();
          } else {
            showFile(key);
          }
        }}
        selectedKey={activeFile ? activeFile.mount : FOLDER_TAB}
        tabs={[
          {
            icon: <LaptopIcon className="size-3.5" />,
            isFixed: true,
            key: FOLDER_TAB,
            title: "This Mac",
          },
          ...fileTabs.map((tab) => ({
            icon: <FileIcon className="size-4" filename={tab.name} />,
            key: tab.mount,
            title: tab.name,
          })),
        ]}
      />
      <div className="relative min-h-0 flex-1">
        {/* Kept mounted behind a file, so the columns are where the user left them when they come back. */}
        <div className={cn("h-full", activeFile && "hidden")}>
          <ComputerPage
            onFolderChange={(next) => {
              setFolder((current) =>
                JSON.stringify(current) === JSON.stringify(next)
                  ? current
                  : next,
              );
            }}
            onOpenFile={openFile}
            onQuickLook={(tab) => {
              setQuickLook((current) =>
                current?.mount === tab.mount ? null : tab,
              );
            }}
            path={path}
            root={root}
          />
        </div>
        {activeFile ? (
          <div className="h-full p-3">
            <FileViewer
              className="h-full"
              file={viewerFile(activeFile)}
              key={activeFile.mount}
              onClose={() => {
                closeFile(activeFile.mount);
              }}
            />
          </div>
        ) : null}
      </div>
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setQuickLook(null);
          }
        }}
        open={quickLook !== null}
      >
        <DialogContent
          className="h-[85vh] w-[88vw] max-w-none gap-0 p-0 outline-none sm:max-w-none"
          // Focus stays on the panel itself rather than moving to the first
          // control in it, so Space puts the panel away instead of pressing
          // whatever button it landed on, the way a second Space does in the
          // Finder. Caught on the way down, before any control sees it.
          onKeyDownCapture={(event) => {
            if (event.key === " " && !isTypingTarget(event.target)) {
              event.preventDefault();
              event.stopPropagation();
              setQuickLook(null);
            }
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          <DialogTitle className="sr-only">
            {quickLook?.name ?? "Quick Look"}
          </DialogTitle>
          {quickLook ? (
            <FileViewer
              className="h-full"
              file={viewerFile(quickLook)}
              key={quickLook.mount}
              onClose={() => {
                setQuickLook(null);
              }}
              onExpand={() => {
                setQuickLook(null);
                openFile(quickLook);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
