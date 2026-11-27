import { DuplicateIcon } from "@/client/components/icons/duplicate-icon";
import { JoinSidesIcon } from "@/client/components/icons/join-sides-icon";
import { TabGroupIcon } from "@/client/components/icons/tab-group-icon";
import { type WindowTab } from "@/client/atoms/window";
import { sidebarOpenAtom } from "@/client/atoms/tab-groups";
import { getGuest } from "@/client/lib/browser-pool";
import { rpcClient } from "@/client/rpc/client";
import { STOP_CHAT } from "@/shared/shortcut-guide";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ArrowArcLeftIcon } from "@phosphor-icons/react/ArrowArcLeft";
import { ArrowArcRightIcon } from "@phosphor-icons/react/ArrowArcRight";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ArrowLineLeftIcon } from "@phosphor-icons/react/ArrowLineLeft";
import { ArrowLineRightIcon } from "@phosphor-icons/react/ArrowLineRight";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/ArrowsLeftRight";
import { BookmarksIcon } from "@phosphor-icons/react/Bookmarks";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/MagnifyingGlassMinus";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/MagnifyingGlassPlus";
import { PushPinIcon } from "@phosphor-icons/react/PushPin";
import { PushPinSlashIcon } from "@phosphor-icons/react/PushPinSlash";
import { ShareIcon } from "@phosphor-icons/react/Share";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useSidePanel } from "./side-panel-state";
import { SquareSplitHorizontalIcon } from "@phosphor-icons/react/SquareSplitHorizontal";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { XIcon } from "@phosphor-icons/react/X";
import { XSquareIcon } from "@phosphor-icons/react/XSquare";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";

import { copying, writePath } from "./chat-copy-menu";
import { type Chat } from "./chats";
import { useShell } from "./shell-context";
import { type TabAction } from "./tab-actions";
import { useGroupTabMoves } from "./tab-drag";
import { useOpenGroups, useTabGroupActions } from "./tab-groups";
import { chatOfTab, sideIndexOf } from "./tab-model";
import { runWindowCommand } from "./use-window-commands";
import { useWindowTabs } from "./window-tabs";

/** What a command acts on, which a search names beside it; none for the window's own. */
type CommandScope = "chat" | "page" | "tab" | "tab group";

export type ScopedCommand = TabAction & { scope?: CommandScope };

const ICON = "size-4";

/**
 * The commands the tab strip, the sidebar's group menu, a page's ⋮ and the
 * menu bar offer for the tab in front, its group and the window, for the
 * command menu to find by typing. Each is offered only where it applies, as
 * those menus offer it, under the name the command menu gives it, which says
 * what it acts on. `split` is New Tab in Split while the tab's group has one
 * tab, which draws no strip, so the menu can list it before anything is typed.
 */
export function useMenuCommands({
  chats,
  closeGroups,
  developerMode,
  openPage,
  tab,
}: {
  chats: readonly Chat[];
  /** Closes the groups named, asking first when that stops a chat in them. */
  closeGroups: (groups: string[], keep?: string) => void;
  developerMode: boolean;
  /** Opens a page in a tab of its own, as a pick in the menu does. */
  openPage: (url: string) => void;
  /** The tab up on the side with the keyboard. */
  tab: undefined | WindowTab;
}): { commands: ScopedCommand[]; split: ScopedCommand | undefined } {
  const shell = useShell();
  const windowTabs = useWindowTabs();
  const groupActions = useTabGroupActions();
  const moves = useGroupTabMoves();
  const { open } = useOpenGroups();
  const [isSidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const sidePanel = useSidePanel(tab?.group);
  const preferences = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setShowBookmarksBar = useMutation(
    rpcClient.preferences.setShowBookmarksBar.mutationOptions(),
  );
  const savePage = useMutation(rpcClient.browser.page.saveAs.mutationOptions());
  const sharePage = useMutation(rpcClient.browser.page.share.mutationOptions());
  const stopChat = useMutation(
    rpcClient.workspace.session.stop.mutationOptions(),
  );
  const working = chats.filter((each) => each.working);

  const showsBookmarksBar = preferences.data?.showBookmarksBar === true;
  const windowCommands: ScopedCommand[] = [
    {
      chord: WINDOW_SHORTCUTS.reopenTab.accelerator,
      icon: <ArrowCounterClockwiseIcon className={ICON} />,
      id: "reopen-closed-tab",
      label: "Reopen Closed Tab",
      run: () => {
        runWindowCommand("reopenTab");
      },
    },
    {
      chord: WINDOW_SHORTCUTS.toggleSidebar.accelerator,
      icon: <SidebarSimpleIcon className={ICON} />,
      id: "toggle-sidebar",
      label: isSidebarOpen ? "Hide Sidebar" : "Show Sidebar",
      run: () => {
        setSidebarOpen(!isSidebarOpen);
      },
    },
    ...(tab?.group === undefined
      ? []
      : [
          {
            chord: WINDOW_SHORTCUTS.toggleSidePanel.accelerator,
            icon: <SidebarSimpleIcon className="size-4 -scale-x-100" />,
            id: "toggle-side-panel",
            label: sidePanel.isOpen ? "Hide Side Panel" : "Show Side Panel",
            run: () => {
              sidePanel.setOpen(!sidePanel.isOpen);
            },
          },
        ]),
    {
      chord: WINDOW_SHORTCUTS.toggleBookmarksBar.accelerator,
      icon: <BookmarksIcon className={ICON} />,
      id: "toggle-bookmarks-bar",
      label: showsBookmarksBar ? "Hide Bookmarks Bar" : "Show Bookmarks Bar",
      run: () => {
        setShowBookmarksBar.mutate({ enabled: !showsBookmarksBar });
      },
    },
    {
      icon: <MagnifyingGlassPlusIcon className={ICON} />,
      id: "zoom-in",
      label: "Zoom In",
      run: () => {
        runWindowCommand("zoomIn");
      },
    },
    {
      icon: <MagnifyingGlassMinusIcon className={ICON} />,
      id: "zoom-out",
      label: "Zoom Out",
      run: () => {
        runWindowCommand("zoomOut");
      },
    },
    {
      icon: <MagnifyingGlassPlusIcon className={ICON} />,
      id: "zoom-reset",
      label: "Actual Size",
      run: () => {
        runWindowCommand("zoomReset");
      },
    },
    // Every chat at work in the workspace, as the chat list shows them, once
    // there is more than the one Stop Chat reaches. Each says under its last
    // turn that it was stopped, so the pick asks nothing first.
    ...(working.length > 1
      ? [
          {
            icon: <StopIcon className={ICON} />,
            id: "stop-all-chats",
            label: "Stop All Chats",
            run: () => {
              for (const each of working) {
                stopChat.mutate({ id: each.id });
              }
            },
          },
        ]
      : []),
  ];
  if (tab === undefined) {
    return { commands: windowCommands, split: undefined };
  }

  const { group } = tab;
  const layout = group === undefined ? undefined : windowTabs.layoutOf(group);
  const sideIndex = layout && sideIndexOf(layout, tab.id);
  const side = sideIndex === undefined ? undefined : layout?.sides[sideIndex];
  const sideTabs = side?.tabs ?? [tab];
  const at = sideTabs.findIndex((each) => each.id === tab.id);
  const groupTabCount =
    layout?.sides.reduce((count, each) => count + each.tabs.length, 0) ?? 1;
  const isSplit = layout?.sides.length === 2;
  const otherSide: 0 | 1 = sideIndex === 1 ? 0 : 1;
  const closing = (closed: readonly WindowTab[]) =>
    closed.length === 0
      ? undefined
      : () => {
          for (const each of closed) {
            shell.requestClose(each.id);
          }
        };
  const scoped = (
    scope: CommandScope,
    list: (ScopedCommand | false | undefined)[],
  ): ScopedCommand[] =>
    list.flatMap((each) => (each ? [{ ...each, scope }] : []));
  const action = (
    id: string,
    label: string,
    icon: TabAction["icon"],
    run: (() => void) | undefined,
    chord?: TabAction["chord"],
  ): ScopedCommand | undefined =>
    run && { ...(chord === undefined ? {} : { chord }), icon, id, label, run };

  const newTabInSplit = action(
    "new-tab-in-split",
    "New Tab in Split",
    <SquareSplitHorizontalIcon className={ICON} />,
    isSplit
      ? undefined
      : () => {
          runWindowCommand("newTabInSplit");
        },
    WINDOW_SHORTCUTS.newTabInSplit.accelerator,
  );
  // A copy of the tab: a page in a tab of its own, a screen beside it.
  const duplicate = () => {
    if (tab.kind === "page") {
      const url = tab.url ?? tab.openedUrl;
      if (url !== undefined) {
        openPage(url);
      }
      return;
    }
    windowTabs.openScreen(tab.href, {
      after: tab.id,
      from: { reason: "asked", tab: tab.id },
      ...(group === undefined ? {} : { group }),
      select: true,
      side: "same",
    });
  };
  const tabCommands = scoped("tab", [
    action(
      "close-tab",
      "Close Tab",
      <XIcon className={ICON} />,
      () => {
        runWindowCommand("closeTab");
      },
      WINDOW_SHORTCUTS.closeTab.accelerator,
    ),
    action(
      "close-other-tabs",
      "Close Other Tabs",
      <XSquareIcon className={ICON} />,
      closing(sideTabs.filter((each) => each.id !== tab.id)),
    ),
    action(
      "close-tabs-left",
      "Close Tabs to the Left",
      <ArrowLineLeftIcon className={ICON} />,
      closing(at <= 0 ? [] : sideTabs.slice(0, at)),
    ),
    action(
      "close-tabs-right",
      "Close Tabs to the Right",
      <ArrowLineRightIcon className={ICON} />,
      closing(at === -1 ? [] : sideTabs.slice(at + 1)),
    ),
    action(
      "duplicate-tab",
      "Duplicate Tab",
      <DuplicateIcon className={ICON} />,
      duplicate,
    ),
    action(
      "move-tab-to-new-group",
      "Move Tab to New Tab Group",
      <TabGroupIcon className={ICON} />,
      group !== undefined && groupTabCount > 1
        ? () => {
            groupActions.make({
              moving: tab.id,
              ...(windowTabs.groupOwn[group]?.pinned
                ? {}
                : { place: { after: group } }),
            });
          }
        : undefined,
    ),
    action(
      "move-tab-to-new-window",
      "Move Tab to New Window",
      <AppWindowIcon className={ICON} />,
      groupTabCount > 1 || open.length > 1
        ? () => {
            moves.toNewWindow(tab.id);
          }
        : undefined,
    ),
    newTabInSplit,
    action(
      "close-split",
      "Close Split",
      <XIcon className={ICON} />,
      isSplit
        ? () => {
            runWindowCommand("closeSplit");
          }
        : undefined,
      WINDOW_SHORTCUTS.closeSplit.accelerator,
    ),
    action(
      "move-to-other-side",
      "Move to Other Side",
      <ArrowsLeftRightIcon className={ICON} />,
      isSplit && group !== undefined && sideTabs.length > 1
        ? () => {
            windowTabs.moveTo({
              group,
              id: tab.id,
              select: true,
              side: otherSide,
            });
          }
        : undefined,
    ),
    action(
      "focus-left-side",
      "Focus Left Side",
      <ArrowArcLeftIcon className={ICON} />,
      isSplit && sideIndex === 1
        ? () => {
            runWindowCommand("focusLeftSide");
          }
        : undefined,
      WINDOW_SHORTCUTS.focusLeftSide.accelerator,
    ),
    action(
      "focus-right-side",
      "Focus Right Side",
      <ArrowArcRightIcon className={ICON} />,
      isSplit && sideIndex === 0
        ? () => {
            runWindowCommand("focusRightSide");
          }
        : undefined,
      WINDOW_SHORTCUTS.focusRightSide.accelerator,
    ),
  ]);
  const entry = open.find((each) => each.group === group);
  // Pinned groups stay open, as the sidebar's Close Other Tab Groups leaves them.
  const others = open.flatMap((each) =>
    each.group === group || each.pinned ? [] : [each.group],
  );
  const groupCommands =
    group === undefined || entry === undefined
      ? []
      : scoped("tab group", [
          action(
            "close-split-keep-both",
            "Close Split, Keep Both",
            <JoinSidesIcon className={ICON} />,
            isSplit
              ? () => {
                  windowTabs.joinSides(group);
                }
              : undefined,
          ),
          action(
            "close-tab-group",
            "Close Tab Group",
            <XIcon className={ICON} />,
            () => {
              closeGroups([group]);
            },
            WINDOW_SHORTCUTS.closeGroup.accelerator,
          ),
          action(
            "close-other-tab-groups",
            "Close Other Tab Groups",
            <XSquareIcon className={ICON} />,
            others.length === 0
              ? undefined
              : () => {
                  closeGroups(others, group);
                },
          ),
          action(
            "pin-tab-group",
            entry.pinned ? "Unpin Tab Group" : "Pin Tab Group",
            entry.pinned ? (
              <PushPinSlashIcon className={ICON} />
            ) : (
              <PushPinIcon className={ICON} />
            ),
            () => {
              groupActions.pin(group, !entry.pinned);
            },
          ),
          action(
            "duplicate-tab-group",
            "Duplicate Tab Group",
            <DuplicateIcon className={ICON} />,
            () => {
              groupActions.duplicate(entry);
            },
          ),
          action(
            "move-tab-group-to-new-window",
            "Move Tab Group to New Window",
            <AppWindowIcon className={ICON} />,
            open.length > 1
              ? () => {
                  groupActions.moveToNewWindow(group, open);
                }
              : undefined,
          ),
          action(
            "bookmark-all-tabs",
            "Bookmark All Tabs…",
            <BookmarksIcon className={ICON} />,
            () => {
              runWindowCommand("bookmarkAllTabs");
            },
            WINDOW_SHORTCUTS.bookmarkAllTabs.accelerator,
          ),
        ]);

  const pageUrl = tab.kind === "page" ? (tab.url ?? tab.openedUrl) : undefined;
  const guest = () => getGuest(browserTargetOf(tab.id));
  const pageCommands =
    pageUrl === undefined || pageUrl === "about:blank"
      ? []
      : scoped("page", [
          action(
            "back",
            "Back",
            <ArrowArcLeftIcon className={ICON} />,
            () => {
              runWindowCommand("back");
            },
            WINDOW_SHORTCUTS.back.accelerator,
          ),
          action(
            "forward",
            "Forward",
            <ArrowArcRightIcon className={ICON} />,
            () => {
              runWindowCommand("forward");
            },
            WINDOW_SHORTCUTS.forward.accelerator,
          ),
          action(
            "hard-reload",
            "Hard Reload",
            <ArrowClockwiseIcon className={ICON} />,
            () => {
              guest()?.reload({ ignoreCache: true });
            },
          ),
          action(
            "save-page",
            "Save Page As…",
            <DownloadSimpleIcon className={ICON} />,
            () => {
              const current = guest();
              if (current) {
                savePage.mutate({ webContentsId: current.webContentsId });
              }
            },
          ),
          action("share-page", "Share…", <ShareIcon className={ICON} />, () => {
            sharePage.mutate({ url: pageUrl });
          }),
          action(
            "page-developer-tools",
            "Developer Tools",
            <CodeIcon className={ICON} />,
            () => {
              guest()?.openDevTools();
            },
          ),
        ]);

  const chat = chats.find((each) => each.id === chatOfTab(tab));
  const chatCommands =
    chat === undefined
      ? []
      : scoped("chat", [
          // What the chat's Stop button and Escape do.
          action(
            "stop-chat",
            STOP_CHAT.label,
            <StopIcon className={ICON} />,
            chat.working
              ? () => {
                  stopChat.mutate({ id: chat.id });
                }
              : undefined,
            STOP_CHAT.accelerator,
          ),
          action(
            "copy-for-agent",
            "Copy for an Agent",
            <CopyIcon className={ICON} />,
            () => {
              void copying(
                () => rpcClient.chatLocation.forAgent.call({ id: chat.id }),
                {
                  done: "Copied for an agent",
                  failed: "Couldn't copy it for an agent",
                },
              );
            },
          ),
          action(
            "copy-work-folder-path",
            "Copy Work Folder Path",
            <CopyIcon className={ICON} />,
            () => {
              void copying(
                () =>
                  writePath(() =>
                    rpcClient.utils.chatWorkFolderPath.call({ id: chat.id }),
                  ),
                {
                  done: "Copied the work folder's path",
                  failed: "Couldn't copy the work folder's path",
                },
              );
            },
          ),
          developerMode &&
            action(
              "copy-developer-details",
              "Copy Developer Details",
              <CopyIcon className={ICON} />,
              () => {
                void copying(
                  () =>
                    rpcClient.chatLocation.developerDetails.call({
                      id: chat.id,
                      sessionId: chat.sessionId,
                    }),
                  {
                    done: "Copied developer details",
                    failed: "Couldn't copy developer details",
                  },
                );
              },
            ),
        ]);

  return {
    commands: [
      ...tabCommands,
      ...groupCommands,
      ...pageCommands,
      ...chatCommands,
      ...windowCommands,
    ],
    split:
      groupTabCount === 1 && newTabInSplit
        ? { ...newTabInSplit, scope: "tab" }
        : undefined,
  };
}
