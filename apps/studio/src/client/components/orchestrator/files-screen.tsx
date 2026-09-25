import {
  type FileTab,
  fileTreeOpenAtom,
  fileTreeWidthAtom,
  finderOnScreenAtom,
  pageSlotsAtom,
} from "@/client/atoms/orchestrator";
import { FileOpenContext } from "@/client/components/file-open-context";
import { FileViewer } from "@/client/components/file-viewer";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { useWatchedFileUrl } from "@/client/hooks/use-watched-file-url";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { fileUrlOf } from "@/client/lib/file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { ComputerPage, type FolderOnScreen } from "./computer-page";
import { useOrchestrator } from "./context";
import { mountOfHostPath } from "./file-tabs";
import { FileTree } from "./file-tree";
import { folderOf, segmentsOf } from "./host-path";
import { NewChatButton } from "./new-chat-button";
import { useOnScreen } from "./on-screen";
import { useQuickLook } from "./quick-look";
import { useWindowTabs } from "./window-tabs";

/** A viewer that is the whole of its tab: no card of its own inside the pane's. */
const FULL_BLEED = "h-full rounded-none shadow-none";
/**
 * How narrow and how wide the tree beside a file can be dragged, in CSS px,
 * where it opens and goes back to on a double-click at its edge, and how far
 * under its minimum a drag closes it rather than stopping there.
 */
const TREE_BOUNDS: RailBounds = {
  collapse: 110,
  initial: 240,
  max: 480,
  min: 180,
};

/**
 * This Mac shows a folder or file in the current tab. Back returns to the
 * folder after opening a file; Space previews the selection in Quick Look.
 *
 * A file opened from the Finder gets a tab of its own with the Finder's
 * folder as a tree at its left and the file's crumbs over it, so the files
 * of a folder can be leafed through, and a link between two documents
 * followed, without going back to the Finder. A row in the tree or a link
 * in the document swaps the file in the same tab.
 *
 * A page's file (HTML) is what a browser is for. In a file tab with a tree
 * it is drawn as its page beside the tree, by a guest the browser keeps as
 * a tab in a group of the file tab's own, off every strip; elsewhere this
 * tab becomes a page tab showing the file at its `file://` address, with
 * the browser's own semantics for a local file. Asked for its source, the
 * tab keeps the file and shows its text.
 */
export function FilesScreen({
  file,
  path,
  root,
  source,
  tree,
}: {
  /** The file this tab shows, by where it is on the computer; the folder when absent. */
  file: string | undefined;
  path: string;
  root: string;
  /** Whether a page's file is shown as its text rather than as the page. */
  source: boolean;
  /** The folder the tab's own tree is rooted at, for a file opened from the Finder. */
  tree: string | undefined;
}) {
  const { askAbout, browser, openPage, openScreen, rowLead, rowTail, taskId } =
    useOrchestrator();
  const { active, allTabs, close, closeActive, step, stepVisit } =
    useWindowTabs();
  const [isTreeOpen, setTreeOpen] = useAtom(fileTreeOpenAtom);
  const setPageSlots = useSetAtom(pageSlotsAtom);
  const router = useRouter();
  const navigate = useNavigate();
  const leaveFile = () => {
    const href = step(-1);
    if (href !== undefined) {
      router.history.push(href);
    } else if (!stepVisit(-1)) {
      closeActive();
    }
  };
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({ input: { id: taskId } }),
  );
  const [folder, setFolder] = useState<FolderOnScreen | null>(null);
  // A file opened from the Finder carries the folder the Finder stood in,
  // which is where its tab's tree is rooted; the recents stand in no folder,
  // so a file opened there is rooted at its own.
  const openFile = (tab: FileTab) => {
    openScreen(
      fileHref(tab.hostPath, {
        tree: folder?.hostPath ?? folderOf(tab.hostPath),
      }),
    );
  };
  const quickLook = useQuickLook({ openFile });
  /** Another file in this tab's place: the tree and the crumbs follow it. */
  const showFile = (hostPath: string) => {
    void navigate({
      search: {
        file: hostPath,
        path,
        root,
        ...(tree === undefined ? {} : { tree }),
      },
      to: "/orchestrator/computer",
    });
  };
  const activeFile: FileTab | undefined = file
    ? { hostPath: file, name: segmentsOf(file).at(-1) ?? file }
    : undefined;
  const isPageFile =
    activeFile !== undefined &&
    !source &&
    getFileType({ filename: activeFile.name }) === "html";
  // In a tab with a tree the page is drawn beside it; elsewhere the tab
  // becomes the page.
  const pageFile =
    isPageFile && tree === undefined ? activeFile.hostPath : undefined;
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
  // The page's file beside the tree: a page tab of the file tab's own, in a
  // group named for the tab so no strip lists it, sent to the file the tab
  // shows and closed when the tab moves off a page's file or goes. The
  // browser draws it into the slot the viewer gives it below.
  const hostGroup = active === undefined ? undefined : `page:${active.id}`;
  const hostedFile =
    isPageFile && tree !== undefined ? activeFile.hostPath : undefined;
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (hostedFile === undefined || hostGroup === undefined || !browser) {
      return;
    }
    browser.openOrFocus(fileUrlOf(hostedFile), { group: hostGroup });
    // Once per file hosted; the browser handle is stable once it exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostedFile, hostGroup, hasBrowser]);
  const hostedTabIds = allTabs
    .filter((tab) => tab.group === hostGroup)
    .map((tab) => tab.id)
    .join("\n");
  useEffect(() => {
    if (hostedFile !== undefined) {
      return;
    }
    for (const id of hostedTabIds.split("\n").filter(Boolean)) {
      close(id);
    }
    // The tabs are closed as the file stops being a page's, not on every
    // re-read of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostedFile, hostedTabIds]);
  useEffect(
    () => () => {
      for (const id of hostedTabIds.split("\n").filter(Boolean)) {
        close(id);
      }
    },
    // On the way out alone, with the tabs as they stood.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    if (hostGroup === undefined) {
      return;
    }
    setPageSlots((current) =>
      current[hostGroup]?.into === slot
        ? current
        : { ...current, [hostGroup]: { into: slot } },
    );
    return () => {
      setPageSlots((current) => {
        const { [hostGroup]: _gone, ...rest } = current;
        return rest;
      });
    };
  }, [hostGroup, slot, setPageSlots]);
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
        : // The computer with no folder on it: the recents with nothing
          // selected, or a folder not yet read. Said as such, so the answer
          // is never a screen or a folder the user has left.
          { screen: "computer" },
  );
  // The same folder and selection by host path, for a draft's chip. The
  // folder is only replaced when it changes, so it stands for its own value.
  const setFinderOnScreen = useSetAtom(finderOnScreenAtom);
  const finderFolder = activeFile ? null : folder;
  useEffect(() => {
    if (finderFolder === null) {
      return;
    }
    const shown = {
      folder: finderFolder.hostPath,
      selected: finderFolder.selectedItems,
    };
    setFinderOnScreen(shown);
    return () => {
      setFinderOnScreen((current) => (current === shown ? null : current));
    };
  }, [finderFolder, setFinderOnScreen]);

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
  // Watched, so the viewer shows the file as it is rather than as it was
  // opened: a write lands in the open tab.
  const activeFileUrl = useWatchedFileUrl(activeFile?.hostPath);
  const viewerFile =
    activeFile && activeFileUrl !== undefined
      ? {
          filename: activeFile.name,
          hostPath: activeFile.hostPath,
          url: activeFileUrl,
        }
      : undefined;

  if (opensAsPage) {
    return null;
  }

  const newChat = askAbout && activeFile && (
    <NewChatButton
      className="mr-1"
      onPress={() => {
        askAbout([{ kind: "file", path: activeFile.hostPath }]);
      }}
      title={`New chat with “${activeFile.name}”`}
    />
  );

  if (activeFile && viewerFile && tree !== undefined) {
    return (
      // What the document links to opens where the tree's rows do: in this
      // tab, unless a tab of its own is asked for; a folder opens as the
      // Finder standing in it.
      <FileOpenContext
        value={(hostPath, options) => {
          if (hostPath.endsWith("/")) {
            openScreen(folderHref(hostPath.slice(0, -1)), options);
          } else if (options?.newTab) {
            openScreen(fileHref(hostPath, { tree }), options);
          } else {
            showFile(hostPath);
          }
        }}
      >
        <div className="flex h-full min-h-0">
          {/* Beside the document the way the window's own rail is: its edge
              drags, an over-drag closes it, and it slides at its width. It
              stays mounted while closed, so what it had open is still open
              when it returns. The Finder's own ground rather than a tinted
              panel, so the tree reads as the list it was opened from. */}
          <StudioSidebarRail
            bounds={TREE_BOUNDS}
            isOpen={isTreeOpen}
            label="Resize the tree"
            onCollapse={() => {
              setTreeOpen(false);
            }}
            panelClassName="bg-background"
            widthAtom={fileTreeWidthAtom}
          >
            <FileTree
              onOpen={showFile}
              root={tree}
              selected={activeFile.hostPath}
            />
          </StudioSidebarRail>
          {/* At the row's far left, over the tree it puts away. */}
          {rowLead &&
            createPortal(
              <TreeToggle
                isOpen={isTreeOpen}
                onToggle={() => {
                  setTreeOpen((open) => !open);
                }}
              />,
              rowLead,
            )}
          <div className="min-h-0 min-w-0 flex-1">
            <FileViewer
              actionsInto={rowTail}
              actionsLead={newChat}
              className={FULL_BLEED}
              file={viewerFile}
              key={activeFile.hostPath}
              {...(hostedFile === undefined
                ? {}
                : { page: <div className="h-full" ref={setSlot} /> })}
            />
          </div>
        </div>
      </FileOpenContext>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {activeFile && viewerFile ? (
          // Where the file sits on the Mac is the row above, which every tab
          // wears, so the viewer is the whole of the tab.
          <FileViewer
            actionsInto={rowTail}
            actionsLead={newChat}
            className={FULL_BLEED}
            file={viewerFile}
            key={activeFile.hostPath}
          />
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

/** Puts the tree away and brings it back, at the far left of the tab's row, over the tree. */
function TreeToggle({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const label = isOpen ? "Hide the tree" : "Show the tree";
  return (
    <ToolbarTooltip label={label}>
      <Button
        aria-label={label}
        aria-pressed={isOpen}
        className={toolbarClassName({ className: "shrink-0", pressed: false })}
        onClick={onToggle}
        size="icon-sm"
        variant="ghost"
      >
        <SidebarSimpleIcon className="size-4" />
      </Button>
    </ToolbarTooltip>
  );
}
