import { FileOpenContext } from "@/client/components/file-open-context";
import { PageOpenContext } from "@/client/components/page-open-context";
import {
  INBOX_HREF,
  putAwaySitesAtom,
  siteGroupOf,
} from "@/client/components/window/app-tabs";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { type PageChromeSlots } from "@/client/components/window/browser-tabs";
import { GroupView } from "@/client/components/window/group-view";
import { GroupItem } from "@/client/components/window/group-item";
import { liveHostedFileAddress } from "@/client/components/window/hosted-page";
import { useWindow, WindowContext } from "@/client/components/window/context";
import { useGroupTab } from "@/client/components/window/group-tab";
import { useRowSlots } from "@/client/components/window/row-slots";
import { screenLocation } from "@/client/components/window/screen-presentation";
import { useShell } from "@/client/components/window/shell-context";
import {
  surfaceLocation,
  tabSurfaceAtom,
  useTabSurface,
} from "@/client/components/window/tab-surface";
import { TabLocationRow } from "@/client/components/window/tab-location-row";
import { chatHref, matchScreen } from "@/client/components/window/window-href";
import { useWindowTabs } from "@/client/components/window/window-tabs";
import { useTabId } from "@/client/hooks/use-active-tab";
import { rpcClient } from "@/client/rpc/client";
import { StoreId } from "@instrument-org/workspace/client";
import {
  createFileRoute,
  Outlet,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_app")({
  component: TabContent,
});

/**
 * A screen that is its own route (the Finder, a file, the apps, an app, a
 * skill), under the row that says where it stands. Its steps are
 * the tab's history, walked by the arrows in the window's bar.
 */
function RouteScreen({ href }: { href: string }) {
  const appWindow = useWindow();
  const shell = useShell();
  const appsBySlug = useAppsBySlug();
  const tabId = useTabId();
  const { allTabs } = useWindowTabs();
  const surface = useAtomValue(tabSurfaceAtom)[tabId];
  usePageSlot(null, undefined, false);
  const { rowProps, slots } = useRowSlots();
  const location = surfaceLocation(
    screenLocation(href, {
      appsBySlug,
      chatTitles: shell.chatTitles,
      taskTitles: shell.childTitles,
    }),
    surface,
  );
  // The apps' catalog is a place you arrive at from a link, with nothing
  // above it to walk back up to and nothing to type an address for: a row
  // there would only offer to leave for the web. The release notes are a
  // page to read, with no place above them either, and Activity has
  // its own search where the field would be.
  const screenKind = matchScreen(href).kind;
  const hasLocationRow =
    location.kind !== "apps" &&
    screenKind !== "releaseNotes" &&
    screenKind !== "activity";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {hasLocationRow && (
        <TabLocationRow
          fillsTab
          {...(location.kind === "file"
            ? {
                liveAddress: () =>
                  liveHostedFileAddress(allTabs, tabId, location.path),
              }
            : {})}
          location={location}
          {...rowProps}
        />
      )}
      <WindowContext
        value={{
          ...appWindow,
          rowField: slots.field,
          rowLead: slots.lead,
          rowReload: slots.reload,
          rowTail: slots.tail,
        }}
      >
        <FileOpenContext
          value={(path, options) => {
            appWindow.openPath(path, options);
          }}
        >
          <PageOpenContext
            value={(url, options) => {
              appWindow.openPage(url, options);
            }}
          >
            <div className="relative min-h-0 flex-1">
              <Outlet />
            </div>
          </PageOpenContext>
        </FileOpenContext>
      </WindowContext>
    </div>
  );
}

/**
 * A site opened at the window's own level: the page its group has up, under
 * the address row a chat's page wears. The window's own arrows walk the
 * page's history, then the tab's, so the row leaves its arrows to them.
 */
function SiteView({ group }: { group: string }) {
  const shell = useShell();
  const windowTabs = useWindowTabs();
  const up = windowTabs.selectedTabIn(group);
  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const [pageChrome, setPageChrome] = useState<PageChromeSlots>();
  usePageSlot(up?.kind === "page" ? pageHost : null, pageChrome, true);
  // A tab reopened after its page was put away brings the page back, at
  // the address it had.
  const [putAway, setPutAway] = useAtom(putAwaySitesAtom);
  const stashed = up === undefined ? putAway[group] : undefined;
  useEffect(() => {
    if (!stashed) {
      return;
    }
    // Its guest went with it, and comes back when the page shows, at the
    // address it held, the way a launch brings a tab's page back: from
    // blank, so with none of the page's own history behind it.
    windowTabs.restoreGroup(group, stashed);
    setPutAway((current) => {
      const { [group]: _restored, ...rest } = current;
      return rest;
    });
    // Once per group put back; the task it opens under does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, setPutAway, stashed]);
  // Back from the page's start is the window tab's own back, to where the
  // site was opened from.
  const router = useRouter();
  if (!up) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {stashed ? null : "This page is closed."}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <GroupItem
        before={{
          back: () => {
            router.history.back();
          },
          canGoBack: router.history.canGoBack(),
        }}
        closeTab={shell.requestClose}
        group={group}
        onPageChrome={setPageChrome}
        onPageHost={setPageHost}
        up={up}
      />
    </div>
  );
}

/**
 * One of the window's tabs, as its address has it: a tab group, a site
 * opened at the window's level, or a screen that is its own route under the
 * row that says where it stands. The window around the tabs is drawn once,
 * by the window, whatever tab is up. A tab of a group is the screen alone,
 * under the row its group's view draws.
 */
function TabContent() {
  const href = useRouterState({
    select: (routerState) => routerState.location.href,
  });
  const groupTab = useGroupTab();
  if (groupTab) {
    return <Outlet />;
  }
  const screen = matchScreen(href);
  switch (screen.kind) {
    case "group": {
      return <GroupView group={screen.group} />;
    }
    // A chat or a draft asked for by its address: the window moves to the
    // group with its tab (`useTabGroupUpkeep`).
    case "chat":
    case "chatLink":
    case "inbox": {
      return <GroupView group={undefined} />;
    }
    case "chatOfSession": {
      return <ChatOfSession sessionId={screen.session} />;
    }
    case "site": {
      return <SiteView group={siteGroupOf(screen.id)} />;
    }
    default: {
      return <RouteScreen href={href} />;
    }
  }
}

/**
 * A chat named by its session, the way addresses were written before a
 * chat had an id of its own: the tab moves to the chat's own address once
 * the workspace says which chat that session is, or to the inbox when it is
 * none's.
 */
function ChatOfSession({ sessionId }: { sessionId: StoreId.Session }) {
  const router = useRouter();
  const chat = useQuery(
    rpcClient.workspace.chats.ofSession.queryOptions({
      input: { sessionId },
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  const answer = chat.data;
  useEffect(() => {
    if (answer) {
      router.history.replace(answer.id ? chatHref(answer.id) : INBOX_HREF);
    }
  }, [answer, router]);
  return <GroupView group={undefined} />;
}

/**
 * Where this tab wants the window's page drawn, told to the window under the
 * tab's id; the window draws the page where the tab up wants it.
 */
function usePageSlot(
  host: HTMLElement | null,
  chrome: PageChromeSlots | undefined,
  isShown: boolean,
) {
  useTabSurface("slot", host ? { chrome, host, isShown } : null);
}
