import { type WindowTab } from "@/client/atoms/window";
import { addressOfTab } from "@/client/bookmarks/actions";
import { getGuest, onPageThumb } from "@/client/lib/browser-pool";
import { registerHistorySurface } from "@/client/lib/history-surfaces";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { useGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { RouterProvider } from "@tanstack/react-router";
import { noop } from "radashi";
import { useAtomValue } from "jotai";
import {
  type ReactNode,
  type Ref,
  useEffect,
  useEffectEvent,
  useRef,
} from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { BookmarksBar, useHasBookmarksBar } from "./bookmarks-bar";
import { type PageChromeSlots } from "./browser-tabs";
import { asksOwnPlace, useWindow, WindowContext } from "./context";
import { useRowSlots } from "./row-slots";
import { BrowserExtensionButtons } from "./browser-extension-buttons";
import { PageAgentOverlay } from "./page-agent-overlay";
import { GroupNewTab } from "./group-new-tab";
import { GroupTabContext } from "./group-tab";
import { liveFileAddress, liveHostedFileAddress } from "./hosted-page";
import { KeptScrolls } from "./kept-scrolls";
import { segmentsOf } from "./host-path";
import { screenLocation } from "./screen-presentation";
import { type TabLocation, tasksOfHref } from "./tab-location";
import { TabLocationRow, TabRowControl } from "./tab-location-row";
import { surfaceLocation, tabSurfaceAtom } from "./tab-surface";
import { useTaskTitles } from "./task-titles";
import { useTabSteps } from "./use-tab-steps";
import { matchScreen } from "./window-href";
import { useShell } from "./shell-context";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
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
  isChatWorking,
  isShown = true,
  onPageChrome,
  onPageHost,
  up,
}: {
  /** Where back goes from the start of the tab: the window's own tab history, for a site standing at the window's level. */
  before?: { back: () => void; canGoBack: boolean };
  closeTab: (id: string) => void;
  group: string;
  /** Whether its side of the group has the keyboard: a chat or a new chat on the other side leaves the caret alone. */
  hasKeyboard?: boolean;
  /**
   * Whether the chat whose pane this is, or any task of it, is at work, which
   * a page uses to say the agent is using it; absent outside a chat's pane.
   */
  isChatWorking?: boolean;
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
  // What is up draws its own controls into the row: a page its reload, zoom
  // and controls, a file screen its folder toggle and actions.
  const { rowProps, slots } = useRowSlots();
  const taskTitles = useTaskTitles();
  const { chatTitles } = useShell();
  // What the screen up says it shows, which the row reads a folder's place off.
  const surface = useAtomValue(tabSurfaceAtom)[up.id];

  // The page's reload and controls go into the address row, the way they do
  // in the pane beside a chat, rather than into a bar of the page's own.
  const onPageChromeEvent = useEffectEvent(onPageChrome);
  const isPage = up.kind === "page";
  useEffect(() => {
    onPageChromeEvent(
      isPage
        ? { fieldInto: slots.field, into: slots.tail, reloadInto: slots.reload }
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
  // The chat the group works for, which an agent's page says is using it.
  const chatId = windowTabs.chatsIn(group)[0];
  const page = targetId ? getGuest(targetId) : null;
  // An earlier build's new tab page; a new tab now is a new chat.
  const isNewTab =
    up.kind === "screen" && matchScreen(up.href).kind === "newTab";
  const screenKind =
    up.kind === "screen" ? matchScreen(up.href).kind : undefined;
  const isNewChat = screenKind === "inbox";
  const isChat = screenKind === "chat";
  const hasBookmarksBar = useHasBookmarksBar(isNewTab || isNewChat);
  /** Files at a folder: in place of a new tab, and in a tab of its own beside anything else. */
  const openFiles = (href: string) => {
    if (isNewTab) {
      windowTabs.visitHref(up.id, href);
    } else {
      windowTabs.openScreen(href, { group, select: true });
    }
  };
  /**
   * A screen in this tab. A site at the window's level is the window tab's
   * page, so the window's tab goes to the screen the way the command menu
   * sends it, and back returns to the page; in a chat's or a draft's group
   * the tab up becomes the screen in its place.
   */
  const visitHere = (href: string) => {
    if (before) {
      appWindow.openScreen(href);
    } else {
      windowTabs.visitHref(up.id, href);
    }
  };
  /** A site in this tab: the page's own next stop, or a page in place of the screen up. */
  const openHere = (url: string) => {
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
  const steps = useTabSteps(up, before ? { outer: before } : {});
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
  useEffect(
    () =>
      registerHistorySurface({
        anchor: () => anchorRef.current,
        step: (direction) => {
          stepPage(direction);
        },
      }),
    [],
  );

  // The router of a screen that is up; read before the early returns, as a hook.
  const router = useGroupTabRouter(up.id);
  // A new tab is asked for to type an address, so its field takes the caret
  // whenever the tab comes up, wherever the keyboard was.
  const isActive = useIsActiveTab();
  useEffect(() => {
    if (isNewTab && isShown && isActive) {
      anchorRef.current
        ?.querySelector<HTMLInputElement>("[data-tab-location] input")
        ?.focus();
    }
  }, [isActive, isNewTab, isShown, up.id]);

  /** Where the page on a file up here stands now: the page tab's own, or the one a file's viewer draws. */
  const liveAddressOf = (path: string) =>
    targetId === undefined
      ? liveHostedFileAddress(windowTabs.allTabs, up.id, path)
      : liveFileAddress(targetId, path);

  /**
   * The row over what is up, the one the pane beside a chat draws: its
   * arrows walk the page's own history or the screen's trail, and its field
   * sends a page somewhere else, or takes a screen's tab to a site.
   */
  const row = (
    location: TabLocation,
    { isOverBar = false }: { isOverBar?: boolean } = {},
  ) => {
    return (
      <TabLocationRow
        address={addressOfTab(up)}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        {...(location.kind === "file"
          ? { liveAddress: () => liveAddressOf(location.path) }
          : {})}
        {...(isOverBar ? { className: "border-b-0" } : {})}
        location={location}
        {...(before ? {} : { onBack: goBack, onForward: goForward })}
        onSite={openHere}
        onVisit={visitHere}
        {...(up.kind === "page" ? { title: up.title } : {})}
        {...rowProps}
        leading={rowProps.leading}
        trailing={
          <>
            {/* The extensions' buttons go before the page's own controls. */}
            {location.kind === "page" && <BrowserExtensionButtons />}
            {rowProps.trailing}
          </>
        }
      />
    );
  };

  if (up.kind === "page") {
    const filePath = hostPathOfFileUrl(up.url);
    return (
      <Bare
        anchorRef={anchorRef}
        head={
          <>
            {row(
              filePath === undefined
                ? { kind: "page", url: up.url ?? "" }
                : {
                    asPage: true,
                    kind: "file",
                    name: segmentsOf(filePath).at(-1) ?? filePath,
                    path: filePath,
                  },
              { isOverBar: hasBookmarksBar },
            )}
            {hasBookmarksBar && (
              <BookmarksBar
                files={{ group, onOpen: openFiles }}
                onOpen={openHere}
                onVisit={visitHere}
              />
            )}
          </>
        }
      >
        <div className="relative h-full">
          <div className="h-full" data-keyboard-home ref={onPageHost} />
          {chatId !== undefined && isChatWorking !== undefined && (
            <PageAgentOverlay
              chatId={chatId}
              isChatWorking={isChatWorking}
              tabId={up.id}
            />
          )}
        </div>
      </Bare>
    );
  }
  // A new tab, as a browser's: the toolbar's address field, with a reload
  // for no page yet, over the bookmarks, and the places to open in Files.
  if (isNewTab) {
    return (
      <Bare
        anchorRef={anchorRef}
        // Files let go here turn this tab into the first of them.
        dropNewTab={up.id}
        head={
          <>
            <TabLocationRow
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              className="border-b-0"
              location={screenLocation(up.href, { appsBySlug, taskTitles })}
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
            <BookmarksBar
              files={{ group, onOpen: openFiles }}
              onOpen={openHere}
              onVisit={visitHere}
            />
          </>
        }
      >
        <GroupNewTab group={group} tabId={up.id} />
      </Bare>
    );
  }
  // Every other screen is a route of the window's own tree, under a router
  // of the tab's own; the folder says where it stands as its Finder reads it.
  // A new chat's field is Chat's chip alone, with the chord that takes the
  // caret there, since the caret starts in the composer.
  const location = surfaceLocation(
    screenLocation(up.href, { appsBySlug, chatTitles, taskTitles }),
    surface,
  );
  const head = isNewChat ? (
    <TabLocationRow
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      className="border-b-0"
      fieldHint={<LocationKeys />}
      fieldTakesCaret={false}
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
  ) : (
    row(location, { isOverBar: isChat && hasBookmarksBar })
  );
  const content = router ? <RouterProvider router={router} /> : null;
  return (
    <Bare
      anchorRef={anchorRef}
      // A task's page heads itself with its title and Stop.
      {...(location.kind === "task"
        ? {}
        : {
            head: (
              <>
                {head}
                {(isNewChat || (isChat && hasBookmarksBar)) && (
                  <BookmarksBar
                    files={{ group, onOpen: openFiles }}
                    onOpen={openHere}
                    onVisit={visitHere}
                  />
                )}
              </>
            ),
          })}
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
        }}
      >
        <WindowContext
          value={{
            ...appWindow,
            // A chat's tasks and each task's page walk this tab in place.
            openScreen: (href, options) => {
              if (tasksOfHref(href) && !asksOwnPlace(options) && router) {
                router.history.push(href);
                return;
              }
              appWindow.openScreen(href, options);
            },
            rowField: slots.field,
            rowLead: slots.lead,
            rowReload: slots.reload,
            rowTail: slots.tail,
          }}
        >
          {/* A chat opens at its end, as it always does, rather than where
              it was left. */}
          {isChat || isNewChat ? (
            <div className="relative h-full">{content}</div>
          ) : (
            <KeptScrolls href={up.href} tabId={up.id}>
              {content}
            </KeptScrolls>
          )}
        </WindowContext>
      </GroupTabContext>
    </Bare>
  );
}

/** The chord that puts the caret in the address field, at the end of the empty field. */
function LocationKeys() {
  return (
    <span className="pointer-events-none absolute top-1/2 right-2.5 inline-flex h-4.5 -translate-y-1/2 items-center rounded-[4px] bg-foreground/[0.04] px-1 font-sans text-[11px] font-medium text-muted-foreground/70 ring-1 ring-foreground/[0.06]">
      {formatAcceleratorText(WINDOW_SHORTCUTS.search.accelerator)}
    </span>
  );
}

/** What a card holds, edge to edge with nothing around it: the pane's own look. */
function Bare({
  anchorRef,
  children,
  dropNewTab,
  head,
}: {
  anchorRef?: Ref<HTMLDivElement>;
  children: ReactNode;
  /** The new tab this shows, which files let go over it turn into (`useFileDrops`). */
  dropNewTab?: string;
  head?: ReactNode;
}) {
  return (
    <div
      className="flex h-full flex-col bg-background"
      data-drop-new-tab={dropNewTab}
      ref={anchorRef}
    >
      {head}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
