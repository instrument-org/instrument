import {
  screenViewsAtom,
  walkedFoldersAtom,
  type WindowTab,
} from "@/client/atoms/window";
import { getGuest, onPageThumb } from "@/client/lib/browser-pool";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { getGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import {
  encodeBrowserTargetId,
  StoreId,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import { RouterProvider } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { type PageChromeSlots } from "./browser-tabs";
import { WebStart } from "./compose-zero-state";
import { useWindow, WindowContext } from "./context";
import { PageAskButton } from "./file-ask-button";
import { computerTabOf } from "./file-tabs";
import { GroupTabContext } from "./group-tab";
import { segmentsOf } from "./host-path";
import { screenLocation } from "./screen-presentation";
import { type TabLocation, tasksOfHref } from "./tab-location";
import { TabLocationRow } from "./tab-location-row";
import { isHomeTab } from "./tab-model";
import { useTaskTitles } from "./task-titles";
import { useTabSteps } from "./use-tab-steps";
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
  onExpand,
  onPageChrome,
  onPageHost,
  up,
}: {
  /** Where back goes from the start of the tab: the window's own tab history, for a site standing at the window's level. */
  before?: { back: () => void; canGoBack: boolean };
  closeTab: (id: string) => void;
  group: string;
  /** Whether it stands on a card inset in its band, as in a draft; a grown popped-out chat draws it edge to edge, as the pane beside a chat does. */
  isFramed?: boolean;
  /** Puts the view away, from the × at the end of its address row, for a surface that shows it beside a chat. */
  onClose?: () => void;
  /** Grows it into the larger view, from Expand beside the ×, for a surface that only peeks at it. */
  onExpand?: () => void;
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
  // A file screen's own controls go into the row as well: the tree's toggle
  // at its head, the viewer's actions at its end.
  const [screenLead, setScreenLead] = useState<HTMLDivElement | null>(null);
  const [screenTail, setScreenTail] = useState<HTMLDivElement | null>(null);
  const Frame = isFramed ? Card : Bare;
  const taskTitles = useTaskTitles();
  // What the screen up says it shows, which the row reads a folder's place off.
  const filesView = useAtomValue(screenViewsAtom)[up.id];
  const walkedFolder = useAtomValue(walkedFoldersAtom)[up.id];

  // The page's reload and controls go into the address row, the way they do
  // in the pane beside a chat, rather than into a bar of the page's own.
  const [reloadSlot, setReloadSlot] = useState<HTMLDivElement | null>(null);
  const [controlsSlot, setControlsSlot] = useState<HTMLDivElement | null>(null);
  const [fieldSlot, setFieldSlot] = useState<HTMLDivElement | null>(null);
  const onPageChromeEvent = useEffectEvent(onPageChrome);
  const isPage = up.kind === "page";
  useEffect(() => {
    onPageChromeEvent(
      isPage
        ? { fieldInto: fieldSlot, into: controlsSlot, reloadInto: reloadSlot }
        : undefined,
    );
  }, [isPage, controlsSlot, fieldSlot, reloadSlot]);
  useEffect(
    () => () => {
      onPageChromeEvent(undefined);
    },
    [],
  );
  const targetId =
    up.kind === "page"
      ? encodeBrowserTargetId(WINDOW_ID, StoreId.SessionSchema.parse(up.id))
      : undefined;
  const page = targetId ? getGuest(targetId) : null;
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
        {...(onExpand ? { onExpand } : {})}
        {...(before ? {} : { onBack: goBack, onForward: goForward })}
        onSite={(url) => {
          if (up.kind === "page" && page) {
            void page.load(url);
          } else {
            browser?.open(url, { group, replacing: up });
          }
        }}
        onVisit={(href) => {
          windowTabs.visitHref(up.id, href);
        }}
        {...(up.kind === "page"
          ? {
              fieldEnd: (
                <div
                  className="flex shrink-0 items-center empty:hidden"
                  ref={setFieldSlot}
                />
              ),
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
  // The new tab a draft's group opens on, which a chat's group can be handed
  // with the draft's tabs: the web's start, whose page takes its place.
  if (isHomeTab(up)) {
    return (
      <Frame head={row(screenLocation(up.href, { appsBySlug, taskTitles }))}>
        <WebStart
          onOpenPage={(url) => {
            browser?.open(url, { group, replacing: up });
          }}
        />
      </Frame>
    );
  }
  // Every other screen is a route of the window's own tree, under a router
  // of the tab's own; the folder says where it stands as its Finder reads it.
  const router = getGroupTabRouter(up.id);
  const location = screenLocation(up.href, { appsBySlug, taskTitles });
  const shown =
    location.kind === "folder" && filesView?.folder
      ? {
          ...location,
          ...(walkedFolder
            ? { hostPath: walkedFolder.hostPath, path: walkedFolder.walked }
            : { path: filesView.folder.display }),
        }
      : location;
  return (
    <Frame
      head={row(shown, { isFileScreen: computerTabOf(up.href) !== undefined })}
    >
      <GroupTabContext
        key={up.id}
        value={{
          close: () => {
            closeTab(up.id);
          },
          id: up.id,
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
              if (tasksOfHref(href) && !options?.newTab && router) {
                router.history.push(href);
                return;
              }
              appWindow.openScreen(href, options);
            },
            rowLead: screenLead,
            rowTail: screenTail,
          }}
        >
          {router ? <RouterProvider router={router} /> : null}
        </WindowContext>
      </GroupTabContext>
    </Frame>
  );
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
