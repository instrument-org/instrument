import {
  type FileTab,
  fileTreeOpenAtom,
  fileTreeWidthAtom,
  findersByTabAtom,
  pageSlotsAtom,
} from "@/client/atoms/window";
import { FileOpenContext } from "@/client/components/file-open-context";
import { FileViewer } from "@/client/components/file-viewer";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { useIsActiveTab, useTabId } from "@/client/hooks/use-active-tab";
import { useWatchedFileUrl } from "@/client/hooks/use-watched-file-url";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { fileUrlOf } from "@/client/lib/file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import {
  encodeBrowserTargetId,
  StoreId,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/client/lib/toast";

import { newSiteGroup, pageHrefOf } from "./app-tabs";
import { AskTray } from "./ask-tray";
import { ComputerPage, type FolderOnScreen } from "./computer-page";
import { useWindow } from "./context";
import { FileAskButton } from "./file-ask-button";
import { mountOfHostPath } from "./file-tabs";
import { FileTree } from "./file-tree";
import { useGroupTab } from "./group-tab";
import { folderOf, segmentsOf } from "./host-path";
import { hostGroupOf, useHostedPageNavigation } from "./hosted-page";
import { LinkSurface } from "./link-surface";
import { useOnScreen, useWalkedFolder } from "./on-screen";
import { PageEditToggle } from "./page-edit";
import { pageEditTabsAtom, usePageEditToggleOnScreen } from "./page-edit-state";
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
 * A file opened from the Finder takes the Finder's place in its tab, with the
 * Finder's folder as a tree at its left and the file's crumbs over it, so the files
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
  select,
  source,
  tree,
}: {
  /** The file this tab shows, by where it is on the computer; the folder when absent. */
  file: string | undefined;
  path: string;
  root: string;
  /** What the folder opens with selected, as a path under the root. */
  select: string | undefined;
  /** Whether a page's file is shown as its text rather than as the page. */
  source: boolean;
  /** The folder the tab's own tree is rooted at, for a file opened from the Finder. */
  tree: string | undefined;
}) {
  const { browser, openPage, openScreen, rowLead, rowTail } = useWindow();
  const { allTabs, close, moveToGroup, pageTakesOver, stepVisitOf } =
    useWindowTabs();
  // The window's tab this screen is in, when it is the tab's own route, and
  // whether that tab is the one up.
  const appTabId = useTabId();
  const isActiveTab = useIsActiveTab();
  const [isTreeOpen, setTreeOpen] = useAtom(fileTreeOpenAtom);
  const setPageSlots = useSetAtom(pageSlotsAtom);
  const router = useRouter();
  const navigate = useNavigate();
  // The tab of a chat's or a draft's group this screen is in, when it is
  // not one of the window's own.
  const groupTab = useGroupTab();
  const leaveFile = () => {
    // The tab's own history; or, at its start, a group's tab closes and a
    // window tab goes to the folder the file is in.
    if (router.history.canGoBack()) {
      router.history.back();
    } else if (groupTab) {
      groupTab.close();
    } else if (file !== undefined) {
      router.history.push(folderHref(folderOf(file)));
    }
  };
  // The folders the window reaches, read from what opened it.
  const reach = useQuery(
    rpcClient.workspace.window.ensure.queryOptions({
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  const [folder, setFolder] = useState<FolderOnScreen | null>(null);
  // A file opened from the Finder carries the folder the Finder stood in,
  // which is where its tab's tree is rooted; the recents stand in no folder,
  // so a file opened there is rooted at its own.
  const openFile = (tab: FileTab) => {
    router.history.push(
      fileHref(tab.hostPath, {
        tree: folder?.hostPath ?? folderOf(tab.hostPath),
      }),
    );
  };
  const quickLook = useQuickLook({ openFile });
  /**
   * Another file in this tab's place: the tree and the crumbs follow it.
   * `replace` for a file the hosted page itself went to, whose step is in the
   * page's own history and not a second time in the tab's.
   */
  const showFile = (hostPath: string, { replace = false } = {}) => {
    void navigate({
      replace,
      search: {
        file: hostPath,
        path,
        root,
        ...(tree === undefined ? {} : { tree }),
      },
      to: "/files",
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
      // The page takes this screen's place, so back from it skips a screen
      // that would only hand the file over again.
      openPage(fileUrlOf(pageFile), { replace: true });
    }
    // Once per file the tab arrives at; the page takes the tab over from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageFile, hasBrowser]);
  // The page's file beside the tree: a page tab of the file tab's own, in a
  // group named for the tab so no strip lists it, sent to the file the tab
  // shows and closed when the tab moves off a page's file or goes. The
  // browser draws it into the slot the viewer gives it below.
  const tabId = groupTab?.id ?? appTabId;
  const hostGroup = hostGroupOf(tabId);
  const hostedFile =
    isPageFile && tree !== undefined ? activeFile.hostPath : undefined;
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const hostedTabIds = allTabs
    .filter((tab) => tab.group === hostGroup)
    .map((tab) => tab.id)
    .join("\n");
  useEffect(() => {
    if (hostedFile === undefined || !browser) {
      return;
    }
    const id = browser.openOrFocus(fileUrlOf(hostedFile), {
      group: hostGroup,
    });
    // One page per file tab: the slot draws the group's first tab, so the
    // page of the file the tree was on before goes.
    for (const other of hostedTabIds.split("\n").filter(Boolean)) {
      if (other !== id) {
        close(other);
      }
    }
    // Once per file hosted; the browser handle is stable once it exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostedFile, hostGroup, hasBrowser]);
  // The hosted page's tab, which Edit switches the way a page tab's own
  // View / Edit does.
  const hostedTabId =
    hostedFile === undefined
      ? undefined
      : allTabs.find((tab) => tab.group === hostGroup)?.id;
  // The hosted tabs as they stand now, for the way out: the cleanup below
  // runs once, long after the render that set it up.
  const hostedTabIdsNow = useRef(hostedTabIds);
  useEffect(() => {
    hostedTabIdsNow.current = hostedTabIds;
  });
  // A link the page follows moves the tab: to another file, which the tab
  // shows in this one's place while the step stays in the page's own
  // history (which back walks first), or off the computer, where the tab
  // becomes the page at that address and back returns here. A step past
  // either end of the page's history is the tab's own.
  useHostedPageNavigation(
    hostedTabId === undefined
      ? undefined
      : encodeBrowserTargetId(
          WINDOW_ID,
          StoreId.SessionSchema.parse(hostedTabId),
        ),
    hostedFile === undefined ? undefined : fileUrlOf(hostedFile),
    (step) => {
      if (step.kind === "back") {
        leaveFile();
        return;
      }
      if (step.kind === "forward") {
        const canGoForward =
          router.history.location.state.__TSR_index < router.history.length - 1;
        if (canGoForward) {
          router.history.forward();
        } else if (groupTab) {
          stepVisitOf(groupTab.id, 1);
        }
        return;
      }
      if (step.kind === "file") {
        showFile(step.path, { replace: true });
        return;
      }
      if (hostedTabId === undefined) {
        return;
      }
      // The page goes on as the tab's, so leaving this screen must not
      // close it with the rest of the pages drawn here.
      hostedTabIdsNow.current = hostedTabIdsNow.current
        .split("\n")
        .filter((id) => id !== hostedTabId)
        .join("\n");
      if (groupTab) {
        pageTakesOver(hostedTabId, groupTab.id, step.url);
        return;
      }
      const group = newSiteGroup();
      moveToGroup(hostedTabId, group);
      router.history.push(pageHrefOf(group));
    },
  );
  const [editTabs, setEditTabs] = useAtom(pageEditTabsAtom);
  usePageEditToggleOnScreen(
    hostedTabId === undefined
      ? null
      : () => {
          setEditTabs((current) => {
            const { [hostedTabId]: was, ...rest } = current;
            return was ? rest : { ...rest, [hostedTabId]: true };
          });
        },
  );
  // Edit belongs to the file it was switched on for: leafing to another file
  // in the tree, or leaving, shows the next one as its page.
  useEffect(() => {
    if (hostedTabId === undefined) {
      return;
    }
    return () => {
      setEditTabs((current) => {
        const { [hostedTabId]: _was, ...rest } = current;
        return rest;
      });
    };
  }, [hostedTabId, hostedFile, setEditTabs]);
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
      for (const id of hostedTabIdsNow.current.split("\n").filter(Boolean)) {
        close(id);
      }
    },
    // On the way out alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    // Shown only while this screen's tab is the one up: a tab behind keeps
    // its page parked rather than over the tab in front.
    setPageSlots((current) =>
      current[hostGroup]?.into === slot &&
      current[hostGroup].isShown === isActiveTab
        ? current
        : { ...current, [hostGroup]: { into: slot, isShown: isActiveTab } },
    );
    return () => {
      setPageSlots((current) => {
        const { [hostGroup]: _gone, ...rest } = current;
        return rest;
      });
    };
  }, [hostGroup, isActiveTab, slot, setPageSlots]);
  // How the agent reaches the file, when a granted folder covers it: the one
  // thing the conversation is told about the file that the person is not.
  const activeMount = activeFile
    ? mountOfHostPath(activeFile.hostPath, reach.data?.attachedFolders ?? {})
    : undefined;

  useWalkedFolder(
    activeFile || !folder
      ? null
      : { hostPath: folder.hostPath, walked: folder.walked },
  );
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
  // The same folder and selection by host path, for a draft's chip, under
  // this tab's id. The folder is only replaced when it changes, so it
  // stands for its own value.
  const setFinders = useSetAtom(findersByTabAtom);
  // Only for the window's own tabs: a draft's band has a Finder of its own.
  const finderFolder = activeFile || groupTab ? null : folder;
  useEffect(() => {
    if (finderFolder === null) {
      return;
    }
    const shown = {
      folder: finderFolder.hostPath,
      selected: finderFolder.selectedItems,
    };
    setFinders((current) => ({ ...current, [appTabId]: shown }));
    return () => {
      setFinders((current) => {
        if (current[appTabId] !== shown) {
          return current;
        }
        const { [appTabId]: _gone, ...rest } = current;
        return rest;
      });
    };
  }, [appTabId, finderFolder, setFinders]);

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

  const askButton = activeFile && (
    <FileAskButton name={activeFile.name} path={activeFile.hostPath} />
  );

  if (activeFile && viewerFile && tree !== undefined) {
    // What the document links to opens where the tree's rows do: in this
    // tab, unless a tab of its own is asked for; a folder opens as the
    // Finder standing in it.
    const openLinkedFile = (
      hostPath: string,
      options?: { newTab?: boolean },
    ) => {
      if (hostPath.endsWith("/")) {
        openScreen(folderHref(hostPath.slice(0, -1)), options);
      } else if (options?.newTab) {
        openScreen(fileHref(hostPath, { tree }), options);
      } else {
        showFile(hostPath);
      }
    };
    return (
      <FileOpenContext value={openLinkedFile}>
        <LinkSurface
          base={folderOf(activeFile.hostPath)}
          openFile={openLinkedFile}
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
            <div className="relative min-h-0 min-w-0 flex-1">
              <FileViewer
                actionsInto={rowTail}
                actionsLead={
                  hostedTabId === undefined ? (
                    askButton
                  ) : (
                    <>
                      <PageEditToggle tabId={hostedTabId} />
                      {askButton}
                    </>
                  )
                }
                className={FULL_BLEED}
                editable
                file={viewerFile}
                key={activeFile.hostPath}
                {...(hostedFile === undefined
                  ? {}
                  : {
                      page: (
                        // Square at the bottom left while the tree stands
                        // against it, and at the right whatever the pane's own
                        // corner is; the pane's corners when the tree is away.
                        <div
                          className={
                            isTreeOpen
                              ? "h-full [--guest-bottom-radius:0_var(--pane-bottom-right-radius,var(--radius-2xl))]"
                              : "h-full"
                          }
                          ref={setSlot}
                        />
                      ),
                    })}
              />
              {/* A page in Edit keeps its asks in its own dock instead. */}
              {!(hostedTabId !== undefined && editTabs[hostedTabId]) && (
                <AskTray path={activeFile.hostPath} />
              )}
            </div>
          </div>
        </LinkSurface>
      </FileOpenContext>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {activeFile && viewerFile ? (
          // Where the file sits on the Mac is the row above, which every tab
          // wears, so the viewer is the whole of the tab.
          <LinkSurface base={folderOf(activeFile.hostPath)}>
            <FileViewer
              actionsInto={rowTail}
              actionsLead={askButton}
              className={FULL_BLEED}
              editable
              file={viewerFile}
              key={activeFile.hostPath}
              {...(source
                ? {
                    // The tab turns back into the page, the way it arrives
                    // at a page's file from anywhere.
                    onLeaveSource: () => {
                      router.history.push(fileHref(activeFile.hostPath));
                    },
                  }
                : {})}
            />
          </LinkSurface>
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
            select={select}
            {...quickLook.props}
          />
        )}
        {activeFile && <AskTray path={activeFile.hostPath} />}
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
