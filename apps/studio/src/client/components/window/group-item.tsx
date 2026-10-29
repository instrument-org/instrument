import { type WindowTab } from "@/client/atoms/window";
import { getGuest, onPageThumb } from "@/client/lib/browser-pool";
import { registerHistorySurface } from "@/client/lib/history-surfaces";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { useGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import { browserTargetOf } from "@instrument-org/workspace/client";
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
import { type PageChromeSlots } from "./browser-tabs";
import { WebStart } from "./compose-zero-state";
import { useWindow, WindowContext } from "./context";
import { useRowSlots } from "./row-slots";
import { PageAskButton } from "./file-ask-button";
import { GroupTabContext } from "./group-tab";
import { segmentsOf } from "./host-path";
import { screenLocation } from "./screen-presentation";
import { type TabLocation, tasksOfHref } from "./tab-location";
import { TabLocationRow } from "./tab-location-row";
import { isHomeTab } from "./tab-model";
import { tabSurfaceAtom } from "./tab-surface";
import { useTaskTitles } from "./task-titles";
import { useTabSteps } from "./use-tab-steps";
import { chatOfGroup } from "./window-href";
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
  isShown = true,
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
  /** Whether it is on screen; false while the pane it stands in is put away, which keeps it mounted. */
  isShown?: boolean;
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
  // What is up draws its own controls into the row: a page its reload, zoom
  // and controls, a file screen its tree toggle and actions.
  const { rowProps, slots } = useRowSlots();
  const Frame = isFramed ? Card : Bare;
  const taskTitles = useTaskTitles();
  // What the screen up says it shows, which the row reads a folder's place off.
  const { view: filesView, walked: walkedFolder } =
    useAtomValue(tabSurfaceAtom)[up.id] ?? {};

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

  /**
   * The row over what is up, the one the pane beside a chat draws: its
   * arrows walk the page's own history or the screen's trail, and its field
   * sends a page somewhere else, or takes a screen's tab to a site.
   */
  const row = (location: TabLocation) => {
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
            void page.load(url).catch(noop);
          } else {
            browser?.open(url, { group, replacing: up });
          }
        }}
        onVisit={(href) => {
          // A site at the window's level is the window tab's page, so the
          // window's tab goes to the screen the way the command menu sends
          // it, and back returns to the page; in a chat's or a draft's
          // group the tab up becomes the screen in its place.
          if (before) {
            appWindow.openScreen(href);
          } else {
            windowTabs.visitHref(up.id, href);
          }
        }}
        {...rowProps}
        trailing={
          <>
            {/* A page's file has the file's own Ask among its actions. */}
            {before && location.kind === "page" && (
              <PageAskButton onAsk={appWindow.focusComposer} />
            )}
            {rowProps.trailing}
          </>
        }
      />
    );
  };

  if (up.kind === "page") {
    const filePath = hostPathOfFileUrl(up.url);
    return (
      <Frame
        anchorRef={anchorRef}
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
      <Frame
        anchorRef={anchorRef}
        head={row(screenLocation(up.href, { appsBySlug, taskTitles }))}
      >
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
    <Frame anchorRef={anchorRef} head={row(shown)}>
      <GroupTabContext
        key={up.id}
        value={{
          close: () => {
            closeTab(up.id);
          },
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
            // Beside a chat, a screen's Ask would only open a draft over the
            // chat that is already there to ask.
            ...(chatOfGroup(group) === undefined
              ? {}
              : { askAbout: undefined }),
            // A chat's tasks and each task's page walk this tab in place.
            openScreen: (href, options) => {
              if (tasksOfHref(href) && !options?.newTab && router) {
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
          {router ? <RouterProvider router={router} /> : null}
        </WindowContext>
      </GroupTabContext>
    </Frame>
  );
}

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

/** The band's white card, for a thing drawn large in it. */
function Card({
  anchorRef,
  children,
  head,
}: {
  anchorRef?: Ref<HTMLDivElement>;
  children: ReactNode;
  head?: ReactNode;
}) {
  return (
    <div className="h-full px-2 pb-2" ref={anchorRef}>
      <div className="flex h-full flex-col overflow-hidden rounded-lg bg-card">
        {head}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
