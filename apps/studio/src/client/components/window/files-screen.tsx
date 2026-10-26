import { type ChosenItem } from "@/shared/drafts";
import {
  type FileTab,
  finderBesideWidthAtom,
  fileTreeOpenAtom,
  fileTreeWidthAtom,
} from "@/client/atoms/window";
import type { FileSystemView } from "@/client/components/extend/file-system";
import { FileOpenContext } from "@/client/components/file-open-context";
import { FileViewer } from "@/client/components/file-viewer";
import { ResizeHandle } from "@/client/components/resize-handle";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { useIsActiveTab, useTabId } from "@/client/hooks/use-active-tab";
import { noteFileOpened } from "@/client/hooks/use-recent-files";
import {
  useWatchedFileGone,
  useWatchedFileUrl,
} from "@/client/hooks/use-watched-file-url";
import {
  getComputerFileUrl,
  getComputerThumbnailUrl,
} from "@/client/lib/computer-file-url";
import { fileUrlOf } from "@/client/lib/file-url";
import { COMPUTER_FILE_REFUSAL_HEADER } from "@/shared/computer-file-refusal";
import { getFileType } from "@/client/lib/get-file-type";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { giveKeyboardTo } from "@/client/lib/browser-pool";
import { setHomeFocus } from "@/client/lib/keyboard-home";
import { cn } from "@/client/lib/utils";
import { useTheme } from "@/client/components/theme-provider";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import {
  browserTargetOf,
  type ComputerRefusal,
} from "@instrument-org/workspace/client";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "@/client/lib/toast";

import { newSiteGroup, pageHrefOf } from "./app-tabs";
import { AskTray } from "./ask-tray";
import {
  BESIDE_MOTION_CLASSNAME,
  ComputerPage,
  type FolderOnScreen,
  NotPermitted,
  RECENTS_ROOT,
} from "./computer-page";
import { useWindow } from "./context";
import { FileAskButton } from "./file-ask-button";
import { reachablePath } from "./file-tabs";
import { FileTree } from "./file-tree";
import { useGroupTab } from "./group-tab";
import { folderOf, relativeHostPath, segmentsOf } from "./host-path";
import {
  hostGroupOf,
  useHostedPage,
  useHostedPageNavigation,
} from "./hosted-page";
import { LinkSurface } from "./link-surface";
import { PageEditToggle } from "./page-edit";
import { pageEditTabsAtom, usePageEditToggleOnScreen } from "./page-edit-state";
import { useQuickLook } from "./quick-look";
import { useTabSurface } from "./tab-surface";
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
 * The same for the folder itself beside a file, no narrower than its section
 * of the row needs to name it beside its controls.
 */
const BESIDE_BOUNDS: RailBounds = {
  collapse: 150,
  initial: 300,
  max: 640,
  min: 260,
};
/**
 * The least room a file opening needs beside the folder or the tree, in CSS
 * px. A tab narrower than that opens the file with them folded away.
 */
const FILE_ROOM = 420;
/** How the file fades as it slides away, as long as the folder takes to widen. */
const BESIDE_EXIT_TRANSITION = {
  duration: 0.38,
  ease: [0.2, 0, 0, 1],
} as const;
/** The pile several picked make beside the folder, the way the columns draw one. */
const PILE_POSES = [
  { rotate: 9, x: 24, y: -12 },
  { rotate: -8, x: -20, y: -4 },
  { rotate: -1, x: 0, y: 4 },
];

/**
 * This Mac shows a folder or file in the current tab. Back returns to the
 * folder after opening a file; Space previews the selection in Quick Look.
 *
 * In a tab of the window's own, a file opened from the Finder slides in
 * beside the folder, which narrows to make room and stays as it was, so the
 * files of a folder can be leafed through with a click or an arrow, and a
 * link between two documents followed, without going back to the Finder. In
 * a chat's own tab the file takes the Finder's place instead, with the
 * Finder's folder as a tree at its left. Either way a row or a link in the
 * document swaps the file in the same tab.
 *
 * A page's file (HTML) is what a browser is for. It is drawn as its page
 * inside the file's viewer, by a guest at its `file://` address that the
 * browser keeps as a tab in a group of the file tab's own, off every strip,
 * so it has the browser's own semantics for a local file. Asked for its
 * source, the tab keeps the file and shows its text.
 */
export function FilesScreen({
  file,
  path,
  query,
  root,
  select,
  source,
  tree,
  view,
}: {
  /** The file this tab shows, by where it is on the computer; the folder when absent. */
  file: string | undefined;
  path: string;
  /** What the folder is searched for in this step of the tab's history. */
  query: string | undefined;
  root: string;
  /** What the folder opens with selected, as a path under the root. */
  select: string | undefined;
  /** Whether a page's file is shown as its text rather than as the page. */
  source: boolean;
  /** The folder the tab's own tree is rooted at, for a file opened from the Finder. */
  tree: string | undefined;
  /** The layout this step of the tab's history shows the folder in; absent on a direct arrival. */
  view: FileSystemView | undefined;
}) {
  const { openScreen, rowField, rowHoldsTools, rowLead, rowReload, rowTail } =
    useWindow();
  const { moveToGroup, pageTakesOver, stepVisitOf } = useWindowTabs();
  // The window's tab this screen is in, when it is the tab's own route, and
  // whether that tab is the one up.
  const appTabId = useTabId();
  const isActiveTab = useIsActiveTab();
  const [isTreeOpen, setTreeOpen] = useAtom(fileTreeOpenAtom);
  const treeWidth = useAtomValue(fileTreeWidthAtom);
  // Folded for want of room as a file opened, which leaves the tree as the
  // person last set it for a tab wide enough.
  const [isTreeFolded, setTreeFolded] = useState(false);
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
  // so a file opened there is rooted at its own. The folder's own step stays
  // in the address, so a layout that narrows beside a file shows it there.
  const openFile = (tab: FileTab) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        file: tab.hostPath,
        select: undefined,
        source: undefined,
        tree: folder?.hostPath ?? folderOf(tab.hostPath),
      }),
      to: "/files",
    });
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
      search: (previous) => ({
        ...previous,
        file: hostPath,
        select: undefined,
        source: undefined,
      }),
      to: "/files",
    });
  };
  // In a tab of the window's own a file opened from the folder opens beside
  // it: the folder narrows as the file slides in from the right, and widens
  // again as it slides away. The folder stays mounted throughout, so what it
  // had selected, open and scrolled to is all still there either way.
  const isBesideLayout =
    rowHoldsTools === true && (file === undefined || tree !== undefined);
  const isFileOpen = isBesideLayout && file !== undefined;
  const [isFolderShown, setFolderShown] = useState(true);
  const [besidePicked, setBesidePicked] = useState<ChosenItem[]>([]);
  // Where the folder puts Ask and its menu for several picked.
  const [pickedSlot, setPickedSlot] = useState<HTMLDivElement | null>(null);
  // From the file going until it has slid away.
  const [isClosing, setClosing] = useState(false);
  const [wasFileOpen, setWasFileOpen] = useState(isFileOpen);
  if (wasFileOpen !== isFileOpen) {
    setWasFileOpen(isFileOpen);
    setClosing(!isFileOpen);
    if (isFileOpen) {
      setBesidePicked([]);
    }
  }
  const [storedBesideWidth, setStoredBesideWidth] = useAtom(
    finderBesideWidthAtom,
  );
  // Followed by hand while its edge is dragged, and kept once let go.
  const [draggedWidth, setDraggedWidth] = useState<number | null>(null);
  const draggedWidthNow = useRef<number | null>(null);
  const [layout, setLayout] = useState<HTMLDivElement | null>(null);
  // In a narrow tab the folder keeps to its share, so the file is never
  // the narrower of the two.
  const [layoutWidth, setLayoutWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!layout) {
      return;
    }
    const measure = () => {
      // Layout px, the units the widths are kept in, whatever the zoom.
      setLayoutWidth(layout.offsetWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layout);
    return () => {
      observer.disconnect();
    };
  }, [layout]);
  const besideWidth = Math.min(
    draggedWidth ?? storedBesideWidth,
    layoutWidth === null
      ? Number.POSITIVE_INFINITY
      : Math.max(BESIDE_BOUNDS.min, Math.round(layoutWidth / 2)),
  );
  // A file opening, from the folder or straight into the tab, leaves the
  // folder or the tree beside it only when the tab has room for both,
  // measured once the tab has a width.
  const isFileShown = file !== undefined;
  const [wasFileShown, setWasFileShown] = useState(isFileShown);
  const [isFitPending, setFitPending] = useState(isFileShown);
  if (wasFileShown !== isFileShown) {
    setWasFileShown(isFileShown);
    setFitPending(isFileShown);
  }
  if (isFitPending && layoutWidth !== null) {
    setFitPending(false);
    if (isBesideLayout) {
      setFolderShown(layoutWidth - besideWidth >= FILE_ROOM);
    } else {
      setTreeFolded(layoutWidth - treeWidth < FILE_ROOM);
    }
  }
  const clampBesideWidth = (width: number) =>
    Math.min(BESIDE_BOUNDS.max, Math.max(BESIDE_BOUNDS.min, Math.round(width)));
  const closeBeside = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        file: undefined,
        select: undefined,
        source: undefined,
        tree: undefined,
      }),
      to: "/files",
    });
  };
  const onFolderChange = (next: FolderOnScreen | null) => {
    setFolder((current) =>
      JSON.stringify(current) === JSON.stringify(next) ? current : next,
    );
  };
  // One click (or an arrow) on another file shows it, in the step already
  // up, the way the columns preview it; several show as a pile. A folder
  // picked, or none, leaves the file where it is: walking from folder to
  // folder never puts it away, and neither does a folder's listing arriving.
  const onBesidePick = (picked: ChosenItem[]) => {
    if (!isFileOpen) {
      return;
    }
    setBesidePicked((current) =>
      JSON.stringify(current) === JSON.stringify(picked) ? current : picked,
    );
    const [only] = picked;
    if (picked.length === 1 && only?.kind === "file" && only.path !== file) {
      showFile(only.path, { replace: true });
    }
  };
  // A file arriving with no layout of its own, as one opened into a tab of
  // its own, stands beside the folder its tree names, which is written into
  // its step ahead of the layout the folder writes there itself.
  const isDirectFile = isFileOpen && tree !== undefined && view === undefined;
  const folderRoot = isDirectFile ? tree : root;
  const folderPath = isDirectFile ? "" : path;
  useLayoutEffect(() => {
    if (!isDirectFile) {
      return;
    }
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, path: "", root: tree }),
      to: "/files",
    });
  }, [isDirectFile, navigate, tree]);
  // The open file under the folder's root, for the folder to open with it
  // selected.
  const rootHostPath =
    folderRoot === "~"
      ? window.api.homeDir
      : folderRoot.startsWith("~/")
        ? `${window.api.homeDir}/${folderRoot.slice(2)}`
        : folderRoot;
  const besideSelect =
    (file && relativeHostPath(rootHostPath, file)) ?? undefined;
  const activeFile: FileTab | undefined = file
    ? { hostPath: file, name: segmentsOf(file).at(-1) ?? file }
    : undefined;
  // Every way into a file lands on this screen: a folder, a link in a reply,
  // a file card, the Finder handing one over. A file coming up in the tab the
  // person is looking at is a file they opened, so it is told to history here
  // and nowhere else.
  useEffect(() => {
    if (file !== undefined && isActiveTab) {
      noteFileOpened(file);
    }
  }, [file, isActiveTab]);
  const isPageFile =
    activeFile !== undefined &&
    !source &&
    getFileType({ filename: activeFile.name }) === "html";
  // A page's file is drawn as its page inside the viewer: a page tab of the
  // file tab's own, in a group named for the tab so no strip lists it, sent
  // to the file the tab shows and closed when the tab moves off a page's file
  // or goes. Shown only while this screen's tab is the one up and on screen:
  // a tab behind, or a pane put away, keeps its page parked rather than
  // drawn. Its reload and zoom go into the row the way a page tab's do; its
  // menu is the file's own.
  const tabId = groupTab?.id ?? appTabId;
  const hostGroup = hostGroupOf(tabId);
  const hostedFile = isPageFile ? activeFile.hostPath : undefined;
  const {
    release: releaseHosted,
    setSlot,
    tabId: hostedTabId,
  } = useHostedPage({
    group: hostGroup,
    host: {
      chrome: {
        fieldInto: rowField ?? null,
        into: null,
        reloadInto: rowReload ?? null,
      },
      isActive: isActiveTab && (groupTab?.isShown ?? true),
    },
    url: hostedFile === undefined ? undefined : fileUrlOf(hostedFile),
  });
  // The element the page is drawn into, which the window hands the keyboard
  // to by handing it to the page (`keyboard-home.ts`).
  const [pageSlot, setPageSlot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pageSlot || hostedTabId === undefined) {
      return;
    }
    const target = browserTargetOf(hostedTabId);
    return setHomeFocus(pageSlot, () => {
      giveKeyboardTo(target);
    });
  }, [pageSlot, hostedTabId]);
  // A link the page follows moves the tab: to another file, which the tab
  // shows in this one's place while the step stays in the page's own
  // history (which back walks first), or off the computer, where the tab
  // becomes the page at that address and back returns here. A step past
  // either end of the page's history is the tab's own.
  useHostedPageNavigation(
    hostedTabId === undefined ? undefined : browserTargetOf(hostedTabId),
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
      releaseHosted(hostedTabId);
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
  // How the agent reaches the file, when a granted folder covers it: the one
  // thing the conversation is told about the file that the person is not.
  const activeMount = activeFile
    ? reachablePath(activeFile.hostPath, reach.data?.folders ?? {})
    : undefined;

  // Several picked stand in the file's place, so the row, a draft and the
  // conversation are told about them rather than the file under the pile.
  const isSeveralPicked = isFileOpen && besidePicked.length > 1;
  const shownFile = isSeveralPicked ? undefined : activeFile;
  useTabSurface(
    "picked",
    isSeveralPicked
      ? {
          count: besidePicked.length,
          ...(folder && folderRoot !== RECENTS_ROOT
            ? { folder: { hostPath: folder.hostPath, walked: folder.walked } }
            : {}),
        }
      : null,
  );
  useTabSurface(
    "walked",
    activeFile || !folder
      ? null
      : { hostPath: folder.hostPath, walked: folder.walked },
  );
  useTabSurface(
    "view",
    shownFile
      ? {
          file: {
            ...(activeMount === undefined ? {} : { mount: activeMount }),
            name: shownFile.name,
            path: shownFile.hostPath,
          },
          screen: "file",
        }
      : folder
        ? {
            folder: {
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
  // The same folder and selection by host path, for a draft's chip. Only
  // for the window's own tabs: a draft's band has a Finder of its own.
  const finderFolder = shownFile || groupTab ? null : folder;
  useTabSurface(
    "finder",
    finderFolder && {
      folder: finderFolder.hostPath,
      selected: finderFolder.selectedItems,
    },
  );

  // A missing file returns to the preceding visit, or closes its dedicated
  // tab; beside its folder, it slides away and leaves the folder. The app's
  // own data goes the same way, which the channel forbids. Asked as the file
  // opens and again whenever its watch says it went, so trashing it from the
  // folder beside it, or moving a folder above it, puts it away. A file the
  // system refuses stays, saying whose refusal it is in place of the viewer
  // (with the ways past one macOS made), and is asked again once the person
  // picks its folder.
  const isFileGone = useWatchedFileGone(file);
  const [refused, setRefused] = useState<{
    file: string;
    reason: ComputerRefusal["reason"];
  } | null>(null);
  const [askedAgain, setAskedAgain] = useState(0);
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
        if (controller.signal.aborted) {
          return;
        }
        const name = segmentsOf(file).at(-1) ?? file;
        const putAway = () => {
          if (isFileOpen) {
            closeBeside();
          } else {
            leaveFile();
          }
        };
        const reason =
          response.status === 403
            ? response.headers.get(COMPUTER_FILE_REFUSAL_HEADER)
            : null;
        const refusal =
          reason === "system" || reason === "account" ? reason : null;
        setRefused(refusal ? { file, reason: refusal } : null);
        if (refusal) {
          return;
        }
        if (response.status === 403) {
          toast(`Instrument keeps “${name}” private`, {
            description:
              "It’s part of Instrument’s own data, so you can’t open it here.",
          });
          putAway();
        } else if (response.status === 404) {
          toast(`${name} is no longer there`);
          putAway();
        }
      } catch {
        // The channel is not up, or the request was cut off: not the file's
        // absence, so the tab stays.
      }
    })();
    return () => {
      controller.abort();
    };
    // Once per file the tab shows, once more if it goes, and again after a
    // pick that may have let the app in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, isFileGone, askedAgain]);
  const refusedView =
    activeFile && refused?.file === activeFile.hostPath ? (
      <NotPermitted
        onGranted={() => {
          setAskedAgain((count) => count + 1);
        }}
        refusal={{
          display: folderOf(activeFile.hostPath),
          kind: "refused",
          path: folderOf(activeFile.hostPath),
          reason: refused.reason,
        }}
      />
    ) : null;
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

  const askButton = activeFile && (
    <FileAskButton name={activeFile.name} path={activeFile.hostPath} />
  );
  const actionsLead =
    hostedTabId === undefined ? (
      askButton
    ) : (
      <>
        <PageEditToggle tabId={hostedTabId} />
        {askButton}
      </>
    );
  // The page's file drawn into the slot the viewer gives it: square at the
  // bottom left while something stands against it, and at the right
  // whatever the pane's own corner is; the pane's corners when nothing does.
  const pageInSlot = (isBesideSomething: boolean) =>
    hostedFile === undefined
      ? {}
      : {
          page: (
            <div
              className={
                isBesideSomething
                  ? "h-full [--guest-bottom-radius:0_var(--pane-bottom-right-radius,var(--radius-2xl))]"
                  : "h-full"
              }
              // After the file list: the page has the keyboard when the
              // folder beside it is put away.
              data-keyboard-home="2"
              ref={(element) => {
                setSlot(element);
                setPageSlot(element);
              }}
            />
          ),
        };
  // What the document links to opens where the folder's rows do: in this
  // tab, unless a tab of its own is asked for; a folder opens as the Finder
  // standing in it.
  const openLinkedFile = (hostPath: string, options?: { newTab?: boolean }) => {
    if (hostPath.endsWith("/")) {
      openScreen(folderHref(hostPath.slice(0, -1)), options);
    } else if (options?.newTab) {
      openScreen(
        fileHref(hostPath, tree === undefined ? {} : { tree }),
        options,
      );
    } else {
      showFile(hostPath);
    }
  };

  if (isBesideLayout) {
    const fileOffset = isFolderShown ? besideWidth : 0;
    const closeButton = (
      <ToolbarTooltip label="Close the file">
        <Button
          aria-label="Close the file"
          className={toolbarClassName({
            className: "shrink-0",
            pressed: false,
          })}
          onClick={closeBeside}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon className="size-4" />
        </Button>
      </ToolbarTooltip>
    );
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div
          className="@container/beside relative flex min-h-0 flex-1 overflow-hidden"
          // Escape puts the file away, as the × does, when nothing in the
          // tab answered it first: a field being typed in, or a menu or
          // Quick Look, which sit outside this element.
          onKeyDown={(event) => {
            if (
              event.key !== "Escape" ||
              !isFileOpen ||
              event.defaultPrevented ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              !(event.target instanceof Node) ||
              !event.currentTarget.contains(event.target) ||
              isTypingTarget(event.target)
            ) {
              return;
            }
            event.preventDefault();
            closeBeside();
          }}
          ref={setLayout}
        >
          <div
            className={cn(
              "relative h-full shrink-0 overflow-hidden transition-[width]",
              BESIDE_MOTION_CLASSNAME,
              draggedWidth !== null && "transition-none",
            )}
            // Folded away, nothing in it takes the keyboard.
            inert={isFileOpen && !isFolderShown}
            style={{ width: isFileOpen ? fileOffset : "100%" }}
          >
            <ComputerPage
              {...(isFileOpen || isClosing
                ? {
                    beside: {
                      isClosing,
                      isFolderShown,
                      isResizing: draggedWidth !== null,
                      onPick: onBesidePick,
                      ...(hostedTabId === undefined
                        ? {}
                        : { page: browserTargetOf(hostedTabId) }),
                      pickedInto: pickedSlot,
                      toggle: (
                        <TreeToggle
                          isOpen={isFolderShown}
                          label={
                            isFolderShown
                              ? "Hide the folder"
                              : "Show the folder"
                          }
                          onToggle={() => {
                            setFolderShown((shown) => !shown);
                          }}
                        />
                      ),
                      width: besideWidth,
                    },
                  }
                : {})}
              onFolderChange={onFolderChange}
              onOpenFile={
                isFileOpen
                  ? (tab) => {
                      showFile(tab.hostPath, { replace: true });
                    }
                  : openFile
              }
              path={folderPath}
              query={query}
              root={folderRoot}
              select={isFileOpen ? besideSelect : select}
              toolsInRow
              view={view}
              {...(isFileOpen ? {} : quickLook.props)}
            />
          </div>
          {isFileOpen && isFolderShown && (
            <div
              className="absolute inset-y-0 w-0"
              style={{ left: besideWidth }}
            >
              <ResizeHandle
                anchor={() => layout?.getBoundingClientRect().left}
                className="left-0 -translate-x-1/2"
                collapse={{
                  below: BESIDE_BOUNDS.collapse ?? 0,
                  onCollapse: () => {
                    draggedWidthNow.current = null;
                    setDraggedWidth(null);
                    setFolderShown(false);
                  },
                }}
                getWidth={() => besideWidth}
                grows="right"
                label="Resize the folder"
                max={BESIDE_BOUNDS.max}
                min={BESIDE_BOUNDS.min}
                onReset={() => {
                  setStoredBesideWidth(BESIDE_BOUNDS.initial);
                }}
                onResize={(width) => {
                  draggedWidthNow.current = clampBesideWidth(width);
                  setDraggedWidth(draggedWidthNow.current);
                }}
                onResizeEnd={() => {
                  if (draggedWidthNow.current !== null) {
                    setStoredBesideWidth(draggedWidthNow.current);
                  }
                  draggedWidthNow.current = null;
                  setDraggedWidth(null);
                }}
                onResizeStart={() => {
                  draggedWidthNow.current = besideWidth;
                  setDraggedWidth(besideWidth);
                }}
                value={besideWidth}
              />
            </div>
          )}
          <div className="relative h-full min-w-0 flex-1 overflow-hidden">
            <AnimatePresence
              onExitComplete={() => {
                setClosing(false);
              }}
            >
              {activeFile &&
                viewerFile && (
                  // As wide as it will be from the start, so the file slides in
                  // whole rather than unfolding from a sliver.
                  <motion.div
                    className={cn(
                      "absolute inset-y-0 left-0 bg-background transition-[width]",
                      BESIDE_MOTION_CLASSNAME,
                      draggedWidth !== null && "transition-none",
                      isFolderShown && "border-l border-border",
                    )}
                    exit={{ opacity: 0 }}
                    key="file"
                    style={{ width: `calc(100cqw - ${fileOffset}px)` }}
                    transition={BESIDE_EXIT_TRANSITION}
                  >
                    <WhilePresent>
                      {(isPresent) => (
                        <FileOpenContext value={openLinkedFile}>
                          <LinkSurface
                            base={folderOf(activeFile.hostPath)}
                            openFile={openLinkedFile}
                          >
                            {besidePicked.length > 1 ? (
                              <>
                                <div className="flex size-full">
                                  <SeveralPicked items={besidePicked} />
                                </div>
                                {isPresent &&
                                  rowTail &&
                                  createPortal(
                                    <>
                                      <div
                                        className="flex items-center gap-0.5"
                                        ref={setPickedSlot}
                                      />
                                      {closeButton}
                                    </>,
                                    rowTail,
                                  )}
                              </>
                            ) : (
                              <div className="relative size-full">
                                {refusedView ?? (
                                  <FileViewer
                                    // Its actions leave the row with it, for the
                                    // folder's own to come back.
                                    actionsInto={isPresent ? rowTail : null}
                                    actionsLead={actionsLead}
                                    noteInto={isPresent ? rowField : null}
                                    actionsTrail={closeButton}
                                    className={FULL_BLEED}
                                    editable
                                    file={viewerFile}
                                    key={activeFile.hostPath}
                                    {...pageInSlot(isFolderShown)}
                                  />
                                )}
                                {/* A page in Edit keeps its asks in its own dock instead. */}
                                {!(
                                  hostedTabId !== undefined &&
                                  editTabs[hostedTabId]
                                ) && <AskTray path={activeFile.hostPath} />}
                              </div>
                            )}
                          </LinkSurface>
                        </FileOpenContext>
                      )}
                    </WhilePresent>
                  </motion.div>
                )}
            </AnimatePresence>
          </div>
        </div>
        {quickLook.dialog}
      </div>
    );
  }

  if (activeFile && viewerFile && tree !== undefined) {
    return (
      <FileOpenContext value={openLinkedFile}>
        <LinkSurface
          base={folderOf(activeFile.hostPath)}
          openFile={openLinkedFile}
        >
          <div className="flex h-full min-h-0" ref={setLayout}>
            {/* Beside the document the way the window's own rail is: its edge
              drags, an over-drag closes it, and it slides at its width. It
              stays mounted while closed, so what it had open is still open
              when it returns. The Finder's own ground rather than a tinted
              panel, so the tree reads as the list it was opened from. */}
            <StudioSidebarRail
              bounds={TREE_BOUNDS}
              isAtOnce={isTreeFolded}
              isOpen={isTreeOpen && !isTreeFolded}
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
                  isOpen={isTreeOpen && !isTreeFolded}
                  onToggle={() => {
                    if (isTreeFolded) {
                      setTreeFolded(false);
                      setTreeOpen(true);
                    } else {
                      setTreeOpen((open) => !open);
                    }
                  }}
                />,
                rowLead,
              )}
            <div className="relative min-h-0 min-w-0 flex-1">
              {refusedView ?? (
                <FileViewer
                  actionsInto={rowTail}
                  actionsLead={actionsLead}
                  noteInto={rowField}
                  className={FULL_BLEED}
                  editable
                  file={viewerFile}
                  key={activeFile.hostPath}
                  {...pageInSlot(isTreeOpen && !isTreeFolded)}
                />
              )}
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
    <div className="flex h-full min-h-0 flex-col" ref={setLayout}>
      <div className="relative min-h-0 flex-1">
        {activeFile && viewerFile ? (
          // Where the file sits on the Mac is the row above, which every tab
          // wears, so the viewer is the whole of the tab.
          <LinkSurface base={folderOf(activeFile.hostPath)}>
            {refusedView ?? (
              <FileViewer
                actionsInto={rowTail}
                noteInto={rowField}
                actionsLead={actionsLead}
                className={FULL_BLEED}
                editable
                file={viewerFile}
                key={activeFile.hostPath}
                {...pageInSlot(false)}
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
            )}
          </LinkSurface>
        ) : (
          <ComputerPage
            onFolderChange={onFolderChange}
            onOpenFile={openFile}
            path={path}
            query={query}
            root={root}
            select={select}
            view={view}
            {...quickLook.props}
          />
        )}
        {/* A page in Edit keeps its asks in its own dock instead. */}
        {activeFile &&
          !(hostedTabId !== undefined && editTabs[hostedTabId]) && (
            <AskTray path={activeFile.hostPath} />
          )}
      </div>
      {quickLook.dialog}
    </div>
  );
}

/** Renders its children with whether they are still present, or on their way out of an `AnimatePresence`. */
function WhilePresent({
  children,
}: {
  children: (isPresent: boolean) => ReactNode;
}) {
  const isPresent = useIsPresent();
  return children(isPresent);
}

/** Several picked in the folder beside a file: the last few as a loose pile in the file's place. */
function SeveralPicked({ items }: { items: ChosenItem[] }) {
  const { resolvedTheme } = useTheme();
  const shown = items.slice(-PILE_POSES.length);
  const poses = PILE_POSES.slice(-shown.length);
  const files = items.filter((item) => item.kind === "file").length;
  const folders = items.length - files;
  const kinds = [
    folders > 0 && `${folders} ${folders === 1 ? "folder" : "folders"}`,
    files > 0 && `${files} ${files === 1 ? "document" : "documents"}`,
  ].filter(Boolean);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6">
      <div className="relative h-64 w-72">
        {shown.map((item, index) => {
          const pose = poses[index] ?? { rotate: 0, x: 0, y: 0 };
          return (
            <img
              alt=""
              className="absolute inset-0 m-auto max-h-full max-w-full rounded-md bg-card object-contain shadow-md ring-1 ring-black/10"
              key={item.path}
              src={getComputerThumbnailUrl({
                hostPath: item.path,
                size: 512,
                theme: resolvedTheme === "dark" ? "dark" : "light",
              })}
              style={{
                transform: `translate(${pose.x}px, ${pose.y}px) rotate(${pose.rotate}deg)`,
              }}
            />
          );
        })}
      </div>
      <div className="text-center">
        <div className="text-sm font-semibold">{items.length} items</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {kinds.join(", ")}
        </div>
      </div>
    </div>
  );
}

/** Puts the tree away and brings it back, at the far left of the tab's row, over the tree. */
function TreeToggle({
  isOpen,
  label = isOpen ? "Hide the tree" : "Show the tree",
  onToggle,
}: {
  isOpen: boolean;
  label?: string;
  onToggle: () => void;
}) {
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
