import { type WindowTab } from "@/client/atoms/window";
import { addressOfTab } from "@/client/bookmarks/actions";
import { getGuest, onPageThumb } from "@/client/lib/browser-pool";
import { registerHistorySurface } from "@/client/lib/history-surfaces";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { useGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import { offerScreenReload } from "@/client/lib/screen-reloads";
import { refetchTranscripts } from "@/client/components/transcript/use-transcript-feed";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { useQueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { noop } from "radashi";
import {
  ActiveTabProvider,
  useIsActiveTab,
} from "@/client/hooks/use-active-tab";
import { useAtomValue, useSetAtom } from "jotai";
import {
  type ReactNode,
  type Ref,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { BookmarksBar } from "./bookmarks-bar";
import { type PageChromeSlots } from "./browser-tabs";
import {
  asksOwnPlace,
  type OpenOptions,
  useWindow,
  WindowContext,
} from "./context";
import { ScreenToolsRow, useRowSlots } from "./row-slots";
import { SiteSignInBar } from "./site-sign-in";
import { BrowserExtensionButtons } from "./browser-extension-buttons";
import { PageAgentOverlay } from "./page-agent-overlay";
import { computerTabOf } from "./file-tabs";
import {
  FileVersionsButton,
  FileVersionRows,
  versionHref,
} from "./file-versions";
import { GroupTabContext } from "./group-tab";
import { liveFileAddress, liveHostedFileAddress } from "./hosted-page";
import { KeptScrolls } from "./kept-scrolls";
import { isKeptScreen, keptScreensAtom, withScreenUp } from "./kept-screens";
import { segmentsOf } from "./host-path";
import { screenLocation } from "./screen-presentation";
import { type TabLocation, tasksOfHref } from "./tab-location";
import { TabLocationRow, TabRowControl } from "./tab-location-row";
import { surfaceLocation, tabSurfaceAtom } from "./tab-surface";
import { useTaskTitles } from "./task-titles";
import { chatOfTab } from "./tab-model";
import { useTabSteps } from "./use-tab-steps";
import { matchScreen, type Screen } from "./window-href";
import { useShell } from "./shell-context";
import { fileHref } from "@/shared/computer-href";
import { useWindowTabs } from "./window-tabs";

/**
 * The thing a floating window's group has up, drawn large in the window: a
 * page by the browser (drawn into the host this reports), the computer by
 * its Finder, a file in place of the Finder that opened it, and Apps by its
 * landing page and each app's own. Anything else is the window's to say it
 * cannot draw, with the way to where it can be.
 */
export function GroupItem({
  before,
  closeTab,
  group,
  hasKeyboard = true,
  isShown = true,
  onPageChrome,
  onPageHost,
  up,
}: {
  /** Where back goes from the start of the tab: the window's own tab history, for a site standing at the window's level. */
  before?: { back: () => void; canGoBack: boolean };
  closeTab: (id: string, options?: { up?: string }) => void;
  group: string;
  /** Whether its side of the group has the keyboard: a chat or a new chat on the other side leaves the caret alone. */
  hasKeyboard?: boolean;
  /** Whether it is on screen; false while the pane it stands in is put away, which keeps it mounted. */
  isShown?: boolean;
  /** Where the address row takes the page's reload and controls while a page is up; nothing otherwise. */
  onPageChrome: (slots: PageChromeSlots | undefined) => void;
  /** The element the page is drawn into, while a page is up. */
  onPageHost: (element: HTMLDivElement | null) => void;
  up: WindowTab;
}) {
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const appWindow = useWindow();
  const { browser } = appWindow;
  // What is up draws its own controls into the rows: a page its reload, zoom
  // and controls, a file screen its folder toggle and, under the bookmarks
  // bar, the file's actions.
  const { rowProps, slots, viewEnd } = useRowSlots();
  const taskTitles = useTaskTitles();
  const { chatTitles } = useShell();
  // What the screen up says it shows, which the row reads a folder's place off.
  const surface = useAtomValue(tabSurfaceAtom)[up.id];

  // The page's reload and controls go into the address row, the way they do
  // in the pane beside a chat, rather than into a bar of the page's own; a
  // page that is a file's has the file's controls there too.
  const onPageChromeEvent = useEffectEvent(onPageChrome);
  const isPage = up.kind === "page";
  const pageFilePath = isPage ? hostPathOfFileUrl(up.url) : undefined;
  useEffect(() => {
    onPageChromeEvent(
      isPage
        ? {
            fieldInto: slots.field,
            into: slots.tail,
            reloadInto: slots.reload,
          }
        : undefined,
    );
  }, [isPage, slots.field, slots.reload, slots.tail]);
  useEffect(
    () => () => {
      onPageChromeEvent(undefined);
    },
    [],
  );
  const targetId = up.kind === "page" ? browserTargetOf(up.id) : undefined;
  // The chat that may wait on the person in the page: the one whose agent
  // opened it, else the chat up in its group.
  const chatId = up.openedBy ?? windowTabs.chatUpIn(group);
  const page = targetId ? getGuest(targetId) : null;
  const screenKind =
    up.kind === "screen" ? matchScreen(up.href).kind : undefined;
  const isNewChat = screenKind === "inbox";
  // Files keeps the row every tab shares, with its own controls (the
  // sidebar, the view, the sort, search) in a row of their own under it.
  const isFiles = screenKind === "computer";
  const isChat = screenKind === "chat";
  const computerTab = up.kind === "screen" ? computerTabOf(up.href) : undefined;
  // A file with no folder beside it has one row: its controls (Expand, its
  // versions, its menu) at the address row's end, where a folder's go in a
  // row of their own under it.
  const isFileAlone =
    pageFilePath !== undefined ||
    (computerTab?.file !== undefined && computerTab.tree === undefined);
  /**
   * What a bookmark opens with a plain click: this tab goes there, whatever
   * it is and whatever it names (a chat, Files, a built-in page), as a
   * browser's bookmark takes over the tab it is clicked in, and Back returns.
   */
  const takeOver = (href: string) => {
    windowTabs.startedOver(up.id);
    if (before) {
      appWindow.openScreen(href);
    } else {
      windowTabs.visitHref(up.id, href);
    }
  };
  /**
   * A screen in this tab. A site at the window's level is the window tab's
   * page, so the window's tab goes to the screen the way the command menu
   * sends it, and back returns to the page; in a chat's or a draft's group
   * the tab up becomes the screen in its place.
   */
  const visitHere = (href: string) => {
    // A task's crumb back to its chat brings up the chat's tab in this
    // group where it has one, rather than a second tab on the chat.
    const visited = matchScreen(href);
    const chatTab =
      visited.kind === "chat" ? windowTabs.chatTab(visited.chat) : undefined;
    if (chatTab?.group === group && chatTab.id !== up.id) {
      windowTabs.select(chatTab.id);
      return;
    }
    if (before) {
      appWindow.openScreen(href);
    } else {
      windowTabs.visitHref(up.id, href);
    }
  };
  /** An open from the screen in this tab, which says so; a chat's names its own. */
  const openedHere = (options: OpenOptions = {}): OpenOptions =>
    options.chat === undefined ? { from: up.id, ...options } : options;
  /** A site in this tab: the page's own next stop, or a page in place of the screen up. */
  const openHere = (url: string) => {
    windowTabs.startedOver(up.id);
    if (up.kind === "page" && page) {
      void page.load(url).catch(noop);
    } else {
      browser?.open(url, { group, replacing: up });
    }
  };
  // Back walks what is up (the page's own history, the screen's trail),
  // then what the tab showed before it, then, for a tab that is a site of
  // the window's own, where the window's tab was before the site. The row's
  // arrows and every step asked of the page take these; a site's are the
  // window's own arrows, which read the same steps.
  const steps = useTabSteps(up, {
    closeTab,
    ...(before ? { outer: before } : {}),
  });
  const { canGoBack, canGoForward } = steps;
  const goBack = () => {
    steps.go("back");
  };
  const goForward = () => {
    steps.go("forward");
  };
  const stepPage = useEffectEvent((direction: "back" | "forward") => {
    steps.go(direction);
  });
  useEffect(() => {
    if (targetId === undefined) {
      return;
    }
    return onPageThumb(targetId, (direction) => {
      stepPage(direction);
    });
  }, [targetId]);
  // With the keyboard in what is up here, back and forward are its steps
  // rather than the window's, the way they are for a page holding it.
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isShown) {
      return;
    }
    return registerHistorySurface({
      anchor: () => anchorRef.current,
      step: (direction) => {
        stepPage(direction);
      },
    });
  }, [isShown]);

  // The router of a screen that is up; read before the early returns, as a hook.
  const router = useGroupTabRouter(up.id);

  // Reload draws a chat or a built-in page again from the start, a chat's
  // transcript read anew, as a browser's does a page; the window's Reload
  // reaches it on the side with the keyboard.
  const isReloaded =
    screenKind !== undefined && RELOADED_SCREENS.has(screenKind);
  const queryClient = useQueryClient();
  const [reloads, setReloads] = useState(0);
  const reloadScreen = () => {
    const chat = chatOfTab(up);
    if (chat !== undefined) {
      void refetchTranscripts(queryClient, chat);
    }
    setReloads((count) => count + 1);
  };
  const reloadFromWindow = useEffectEvent(reloadScreen);
  useEffect(() => {
    if (!isReloaded || !isShown) {
      return;
    }
    return offerScreenReload({
      element: () => anchorRef.current,
      reload: () => {
        reloadFromWindow();
      },
    });
  }, [isReloaded, isShown]);

  // A screen up is kept drawn once another tab or group takes its place
  // (`kept-screens.ts`), the one longest out of sight let go first.
  const setKeptScreens = useSetAtom(keptScreensAtom);
  const isKept = isKeptScreen(up);
  useEffect(() => {
    if (isShown && isKept) {
      setKeptScreens((kept) => withScreenUp(kept, up.id));
    }
  }, [isKept, isShown, setKeptScreens, up.id]);
  const isActive = useIsActiveTab();

  /** Where the page on a file up here stands now: the page tab's own, or the one a file's viewer draws. */
  const liveAddressOf = (path: string) =>
    targetId === undefined
      ? liveHostedFileAddress(windowTabs.allTabs, up.id, path)
      : liveFileAddress(targetId, path);

  /** A copy a chat kept of the file up here, shown over the file. */
  const version = computerTab?.version;
  /**
   * A file a chat's replies handed over keeps a version per reply, listed
   * from its row, and a kept copy open here turns the row into the version
   * row, whether it is shown over the file or in its place.
   */
  const versionsOf = (location: TabLocation) =>
    chatId !== undefined && location.kind === "file"
      ? {
          chatId,
          onOpen: (file: string, copy?: string) => {
            windowTabs.visitHref(
              up.id,
              copy === undefined ? fileHref(file) : versionHref(file, copy),
            );
          },
          path: version ?? location.path,
        }
      : undefined;

  /**
   * The row over what is up, and over the bookmarks bar, the one the pane
   * beside a chat draws: its arrows walk the page's own history or the
   * screen's trail, and its field sends a page somewhere else, or takes a
   * screen's tab to a site.
   */
  const row = (location: TabLocation) => {
    const versions = versionsOf(location);
    return (
      <FileVersionRows
        {...(versions
          ? { versions: { ...versions, isOverFile: version !== undefined } }
          : {})}
      >
        <TabLocationRow
          address={addressOfTab(up)}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          {...(location.kind === "file"
            ? { liveAddress: () => liveAddressOf(location.path) }
            : {})}
          className="border-b-0"
          // A file beside a folder has its Expand in the view's row under the
          // bookmarks bar; a file alone has it here.
          expandsFile={isFileAlone}
          location={location}
          {...(before ? {} : { onBack: goBack, onForward: goForward })}
          onSite={openHere}
          onVisit={visitHere}
          {...(up.kind === "page" ? { title: up.title } : {})}
          {...rowProps}
          {...(isReloaded
            ? {
                reload: (
                  <>
                    {rowProps.reload}
                    <TabRowControl
                      chord="reloadPage"
                      disabled={false}
                      icon={<ArrowClockwiseIcon className="size-4" />}
                      label="Reload"
                      onClick={reloadScreen}
                    />
                  </>
                ),
              }
            : {})}
          {...(isFiles && !isFileAlone ? {} : { leading: rowProps.leading })}
          trailing={
            <>
              {/* The extensions' buttons go before the page's own controls. */}
              {location.kind === "page" && <BrowserExtensionButtons />}
              {isFileAlone && versions && <FileVersionsButton {...versions} />}
              {rowProps.trailing}
            </>
          }
        />
      </FileVersionRows>
    );
  };

  if (up.kind === "page") {
    const filePath = pageFilePath;
    const pageLocation: TabLocation =
      filePath === undefined
        ? { kind: "page", url: up.url ?? "" }
        : {
            asPage: true,
            kind: "file",
            name: segmentsOf(filePath).at(-1) ?? filePath,
            path: filePath,
          };
    return (
      <Bare
        anchorRef={anchorRef}
        head={
          <>
            {row(pageLocation)}
            <BookmarksBar
              files={{ group }}
              onOpen={openHere}
              onVisit={takeOver}
            />
            <SiteSignInBar tabId={up.id} />
          </>
        }
      >
        <div className="relative h-full">
          <div className="h-full" data-keyboard-home ref={onPageHost} />
          {!before && <PageAgentOverlay askingChat={chatId} tabId={up.id} />}
        </div>
      </Bare>
    );
  }
  // Every other screen is a route of the window's own tree, under a router
  // of the tab's own; the folder says where it stands as its Finder reads it.
  // A new chat is a new tab, nowhere yet: its field is empty, with the chord
  // that takes the caret there, since the caret starts in the composer.
  const location = surfaceLocation(
    screenLocation(up.href, { appsBySlug, chatTitles, taskTitles }),
    surface,
  );
  // A new tab hints at a browser with bare, quiet controls and no field,
  // since its own box takes an address; a chat is the app's own page and
  // has no row over it at all.
  const head = !isShown ? null : isNewChat ? (
    <TabLocationRow
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      hasField={false}
      isBare
      location={location}
      onBack={goBack}
      onForward={goForward}
      onSite={openHere}
      onVisit={(href) => {
        windowTabs.visitHref(up.id, href);
      }}
      reload={
        <TabRowControl
          chord="reloadPage"
          disabled
          icon={<ArrowClockwiseIcon className="size-4" />}
          label="Reload"
          onClick={noop}
        />
      }
    />
  ) : chatOfTab(up) === undefined ? (
    row(location)
  ) : null;
  const versions = versionsOf(location);
  const content = router ? (
    <RouterProvider key={reloads} router={router} />
  ) : null;
  return (
    <Bare
      anchorRef={anchorRef}
      head={
        // A screen kept drawn out of sight has no rows over it: they are
        // the tab up's.
        isShown && (
          <>
            {head}
            {/* A chat is the app's own page, which the bar never sits over. */}
            {chatOfTab(up) === undefined && (
              <BookmarksBar
                bleeds={isNewChat}
                files={{ group }}
                isAlwaysShown={isNewChat}
                onOpen={openHere}
                onVisit={takeOver}
              />
            )}
            {/* Files' own row: the folder's controls over the folder, the
              file's (its versions, then what it draws into `viewEnd`) over
              the file beside it. */}
            {!isFileAlone && (isFiles || versions) && (
              <ScreenToolsRow
                end={
                  <>
                    {versions && <FileVersionsButton {...versions} />}
                    {viewEnd}
                  </>
                }
                {...(isFiles ? { lead: rowProps.leading } : {})}
              />
            )}
          </>
        )
      }
    >
      <GroupTabContext
        key={up.id}
        value={{
          close: () => {
            closeTab(up.id);
          },
          group,
          hasKeyboard,
          id: up.id,
          isShown,
          showPage: (url) => {
            browser?.open(url, { group, replacing: up });
          },
          versionsOf: chatId,
        }}
      >
        <WindowContext
          value={{
            ...appWindow,
            openPage: (url, options) =>
              appWindow.openPage(url, openedHere(options)),
            // A chat's tasks and each task's page walk this tab in place,
            // unless it is the chat's own, which stays on the chat.
            openScreen: (href, options) => {
              if (
                tasksOfHref(href) &&
                !asksOwnPlace(options) &&
                router &&
                !isChat
              ) {
                router.history.push(href);
                return;
              }
              appWindow.openScreen(href, openedHere(options));
            },
            rowField: slots.field,
            rowLead: slots.lead,
            rowReload: slots.reload,
            rowTail: slots.tail,
            ...(isFiles && !isFileAlone ? { rowView: slots.view } : {}),
          }}
        >
          {/* A chat opens at its end, as it always does, rather than where
              it was left. */}
          {/* One shape for every screen, so a tab moving between a chat
              and another screen (the Chats page's first words making a
              draft) keeps its page rather than drawing it afresh. */}
          <KeptScrolls
            href={up.href}
            isKept={!isChat && !isNewChat}
            isShown={isShown}
            tabId={up.id}
          >
            <div
              className={isChat || isNewChat ? "relative h-full" : "contents"}
            >
              {/* Out of sight, it waits as a window tab behind the one up
                  does: what it reads on a clock, it reads when it is back. */}
              <ActiveTabProvider isActive={isActive && isShown}>
                {content}
              </ActiveTabProvider>
            </div>
          </KeptScrolls>
        </WindowContext>
      </GroupTabContext>
    </Bare>
  );
}

/** The screens Reload draws again: a chat, the built-in pages and the debug pages. */
const RELOADED_SCREENS = new Set<Screen["kind"]>([
  "activity",
  "apps",
  "bookmarks",
  "browser",
  "chat",
  "debug",
  "extensions",
  "chats",
  "releaseNotes",
  "settings",
]);

/** What a card holds, edge to edge with nothing around it: the pane's own look. */
function Bare({
  anchorRef,
  children,
  head,
}: {
  anchorRef?: Ref<HTMLDivElement>;
  children: ReactNode;
  head?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-background" ref={anchorRef}>
      {head}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
