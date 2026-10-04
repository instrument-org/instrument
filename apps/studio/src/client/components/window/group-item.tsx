import {
  APPS_HREF,
  type ScreenView,
  type WindowTab,
} from "@/client/atoms/window";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { useGuestNavigation } from "@/client/hooks/use-guest-navigation";
import { getWebviewElement, onPageThumb } from "@/client/lib/browser-pool";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import {
  encodeBrowserTargetId,
  StoreId,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

import { AppFront } from "./app-front";
import { useAppsBySlug } from "./apps-by-slug";
import { AppsHome } from "./apps-home";
import { type PageChromeSlots } from "./browser-tabs";
import { ChatTasksScreen, TaskScreen } from "./chat-tasks-view";
import { WebStart } from "./compose-zero-state";
import { useWindow, WindowContext } from "./context";
import { PageAskButton } from "./file-ask-button";
import { FilesScreen } from "./files-screen";
import { groupScreenOf } from "./group-screen";
import { segmentsOf } from "./host-path";
import { screenLocation } from "./screen-presentation";
import { ScreenTabContext } from "./screen-tab";
import { type TabLocation, tasksOfHref } from "./tab-location";
import { TabLocationRow } from "./tab-location-row";
import { atOf, trailOf } from "./tab-model";
import { useTabSteps } from "./tab-steps";
import { useTaskTitles } from "./task-titles";
import { parseHref } from "./window-href";
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
  isFramed = true,
  onClose,
  onPageChrome,
  onPageHost,
  onScreenView,
  up,
}: {
  /** Where back goes from the start of the tab: the window's own tab history, for a site standing at the window's level. */
  before?: { back: () => void; canGoBack: boolean };
  closeTab: (id: string) => void;
  group: string;
  /** Whether it stands on a card inset in its band, as in a draft; a grown popped-out chat draws it edge to edge, as the pane beside a chat does. */
  isFramed?: boolean;
  /** Puts the view away, from Hide at the end of its address row, for a surface that shows it beside a chat. */
  onClose?: () => void;
  /** Where the address row takes the page's reload and controls while a page is up; nothing otherwise. */
  onPageChrome: (slots: PageChromeSlots | undefined) => void;
  /** The element the page is drawn into, while a page is up. */
  onPageHost: (element: HTMLDivElement | null) => void;
  /** What a screen it draws has up (the Finder, a chat's tasks), in the terms the conversation is told it. */
  onScreenView?: (view: null | ScreenView) => void;
  up: WindowTab;
}) {
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const appWindow = useWindow();
  const { browser } = appWindow;
  // A file screen's own controls go into the row as well: the tree's toggle
  // at its head, the viewer's actions at its end.
  const [screenLead, setScreenLead] = useState<HTMLDivElement | null>(null);
  const [screenTail, setScreenTail] = useState<HTMLDivElement | null>(null);
  const Frame = isFramed ? Card : Bare;
  const taskTitles = useTaskTitles();
  const [filesView, setFilesView] = useState<null | ScreenView>(null);

  // The page's reload and controls go into the address row, the way they do
  // in the pane beside a chat, rather than into a bar of the page's own.
  const [reloadSlot, setReloadSlot] = useState<HTMLDivElement | null>(null);
  const [controlsSlot, setControlsSlot] = useState<HTMLDivElement | null>(null);
  const onPageChromeEvent = useEffectEvent(onPageChrome);
  const isPage = up.kind === "page";
  useEffect(() => {
    onPageChromeEvent(
      isPage ? { into: controlsSlot, reloadInto: reloadSlot } : undefined,
    );
  }, [isPage, controlsSlot, reloadSlot]);
  useEffect(
    () => () => {
      onPageChromeEvent(undefined);
    },
    [],
  );
  const targetId =
    up.kind === "page"
      ? encodeBrowserTargetId(
          up.taskId ?? WINDOW_ID,
          StoreId.SessionSchema.parse(up.id),
        )
      : undefined;
  const targets = useBrowserTargets();
  const guest = useGuestNavigation(
    targetId !== undefined && targets.has(targetId) ? targetId : null,
  );
  // Back walks what is up (the page's own history, the screen's trail),
  // then what the tab showed before it, then, for a tab that is a site of
  // the window's own, where the window's tab was before the site. The row's
  // arrows and the mouse's thumb buttons over the page both take these.
  const webview = targetId ? getWebviewElement(targetId) : null;
  const at = atOf(up);
  const withinBack = up.kind === "page" ? guest.canGoBack : at > 0;
  const withinForward =
    up.kind === "page" ? guest.canGoForward : at < trailOf(up).length - 1;
  // A site of the window's own has nothing of its own before its page.
  const hasPast = !before && Boolean(up.past?.length);
  const hasFuture = Boolean(up.future?.length);
  const goBack = () => {
    if (withinBack) {
      if (up.kind === "page") {
        webview?.goBack();
      } else {
        windowTabs.stepTab(up.id, -1);
      }
    } else if (hasPast) {
      windowTabs.stepVisitOf(up.id, -1);
    } else {
      before?.back();
    }
  };
  const goForward = () => {
    if (withinForward) {
      if (up.kind === "page") {
        webview?.goForward();
      } else {
        windowTabs.stepTab(up.id, 1);
      }
    } else if (hasFuture) {
      windowTabs.stepVisitOf(up.id, 1);
    }
  };
  const stepByThumb = useEffectEvent((direction: "back" | "forward") => {
    if (direction === "back") {
      goBack();
    } else {
      goForward();
    }
  });
  const canGoBack = withinBack || hasPast || Boolean(before?.canGoBack);
  const canGoForward = withinForward || hasFuture;
  // A site of the window's own is the tab, so its steps are the window's:
  // its bar's arrows, its chords and a thumb over the chrome walk the page
  // first, and the row over the page leaves the arrows to the bar.
  useTabSteps(before ? { canGoBack, canGoForward, goBack, goForward } : null);
  useEffect(() => {
    if (targetId === undefined) {
      return;
    }
    return onPageThumb(targetId, (direction) => {
      stepByThumb(direction);
    });
  }, [targetId]);

  /**
   * The row over what is up, the one the pane beside a chat draws: its
   * arrows walk the page's own history or the screen's trail, and its field
   * sends a page somewhere else, or takes a screen's tab to a site.
   */
  const row = (location: TabLocation, { isFileScreen = false } = {}) => {
    return (
      <TabLocationRow
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        location={location}
        {...(onClose ? { onClose } : {})}
        {...(before ? {} : { onBack: goBack, onForward: goForward })}
        onSite={(url) => {
          if (up.kind === "page" && webview) {
            void webview.loadURL(url);
          } else {
            browser?.open(url, { group, replacing: up });
          }
        }}
        onVisit={(href) => {
          windowTabs.visitHref(up.id, href);
        }}
        {...(up.kind === "page"
          ? {
              reload: (
                <div
                  className="flex shrink-0 items-center empty:hidden"
                  ref={setReloadSlot}
                />
              ),
              trailing: (
                <>
                  {/* A page's file has the file's own Ask among its actions. */}
                  {before && location.kind === "page" && (
                    <PageAskButton onAsk={appWindow.focusComposer} />
                  )}
                  <div
                    className="flex shrink-0 items-center gap-0.5"
                    ref={setControlsSlot}
                  />
                </>
              ),
            }
          : isFileScreen
            ? {
                leading: (
                  <div
                    className="flex shrink-0 items-center empty:hidden"
                    ref={setScreenLead}
                  />
                ),
                trailing: (
                  <div
                    className="flex shrink-0 items-center gap-0.5"
                    ref={setScreenTail}
                  />
                ),
              }
            : {})}
      />
    );
  };

  if (up.kind === "page") {
    const filePath = hostPathOfFileUrl(up.url);
    return (
      <Frame
        head={row(
          filePath === undefined
            ? { kind: "page", url: up.url ?? "" }
            : {
                asPage: true,
                kind: "file",
                name: segmentsOf(filePath).at(-1) ?? filePath,
                path: filePath,
              },
        )}
      >
        <div className="h-full" ref={onPageHost} />
      </Frame>
    );
  }
  const screenRow = row(screenLocation(up.href, { appsBySlug, taskTitles }));
  const screen = groupScreenOf(up.href);
  // The openers send every other address to the window's own tabs, and kept
  // tabs at one are dropped on launch, so a group never stands on one.
  if (screen === undefined) {
    return null;
  }
  switch (screen.kind) {
    case "computer": {
      const search = parseHref(up.href).search;
      // The folder says where it stands, as the pane beside a chat reads it.
      const location = screenLocation(up.href, { appsBySlug });
      const shown =
        location.kind === "folder" && filesView?.folder
          ? { ...location, path: filesView.folder.display }
          : location;
      return (
        <Frame head={row(shown, { isFileScreen: true })}>
          {/* The Finder and the file viewer the pane beside a chat draws,
            moving this tab rather than following the window's router. */}
          <ScreenTabContext
            value={{
              id: up.id,
              // Leaving a file opened from the Finder steps the tab back to its
              // folder; a tab that opened on the file has nowhere to go back to.
              leave: () => {
                if (windowTabs.stepTab(up.id, -1) === undefined) {
                  closeTab(up.id);
                }
              },
              report: (view) => {
                setFilesView(view);
                onScreenView?.(view);
              },
              visit: (href) => {
                windowTabs.visitHref(up.id, href);
              },
            }}
          >
            <WindowContext
              value={{
                ...appWindow,
                rowLead: screenLead,
                rowTail: screenTail,
              }}
            >
              <FilesScreen
                file={screen.file}
                key={up.id}
                path={screen.path}
                root={screen.root}
                select={search.get("select") ?? undefined}
                source={search.get("source") === "true"}
                tree={screen.tree}
              />
            </WindowContext>
          </ScreenTabContext>
        </Frame>
      );
    }
    case "tasks": {
      const tasks = screen;
      return (
        // A chat's tasks and each task's page, as the pane beside a chat draws
        // them, moving this tab rather than following the window's router: a
        // row pressed or the row's Tasks crumb walks the tab in place.
        <WindowContext
          value={{
            ...appWindow,
            openScreen: (href, options) => {
              if (tasksOfHref(href) && !options?.newTab) {
                windowTabs.visitHref(up.id, href);
                return;
              }
              appWindow.openScreen(href, options);
            },
          }}
        >
          <Frame head={screenRow}>
            <ScreenTabContext
              value={{
                id: up.id,
                leave: () => {
                  if (windowTabs.stepTab(up.id, -1) === undefined) {
                    closeTab(up.id);
                  }
                },
                report: (view) => {
                  onScreenView?.(view);
                },
                visit: (href) => {
                  windowTabs.visitHref(up.id, href);
                },
              }}
            >
              {tasks.task !== undefined ? (
                <TaskScreen key={tasks.task} taskId={tasks.task} />
              ) : tasks.chat ? (
                <ChatTasksScreen chat={tasks.chat} />
              ) : null}
            </ScreenTabContext>
          </Frame>
        </WindowContext>
      );
    }
    // A draft draws its own new tab before this, so beside a chat one is the
    // web's starting view, the new tab a chat's group opens.
    case "browser":
    case "newTab": {
      return (
        <Frame head={screenRow}>
          <WebStart
            onOpenPage={(url) => {
              browser?.open(url, { group, replacing: up });
            }}
          />
        </Frame>
      );
    }
    case "apps": {
      return (
        <Frame head={screenRow}>
          <AppsHome
            onOpenApp={(slug) => {
              windowTabs.visitHref(up.id, `${APPS_HREF}/${slug}`);
            }}
            showsConnect={false}
          />
        </Frame>
      );
    }
    case "app": {
      return (
        <Frame head={screenRow}>
          <AppFront
            onToApps={() => {
              if (windowTabs.stepTab(up.id, -1) === undefined) {
                windowTabs.visitHref(up.id, APPS_HREF);
              }
            }}
            reportsScreen={false}
            slug={screen.slug}
          />
        </Frame>
      );
    }
  }
}

/** What a card holds, edge to edge with nothing around it: the pane's own look. */
function Bare({ children, head }: { children: ReactNode; head?: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-background">
      {head}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** The band's white card, for a thing drawn large in it. */
function Card({ children, head }: { children: ReactNode; head?: ReactNode }) {
  return (
    <div className="h-full px-2 pb-2">
      <div className="flex h-full flex-col overflow-hidden rounded-lg bg-card">
        {head}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
