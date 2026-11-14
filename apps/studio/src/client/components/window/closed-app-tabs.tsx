import { freshTabId } from "@/client/lib/tab-actions";
import { reopenClosed } from "@/client/lib/tabs-model";
import {
  browserTargetOf,
  type ChatId,
  type StoreId,
} from "@instrument-org/workspace/client";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { useAtom, useAtomValue } from "jotai";
import { type ReactNode } from "react";

import {
  appTabsAtom,
  groupOfHref,
  isGoneSite,
  INBOX_HREF,
  isChatHref,
  isSiteHref,
  putAwaySitesAtom,
} from "./app-tabs";
import { useAppsBySlug } from "./apps-by-slug";
import { TabIcon } from "./browser-tabs";
import { CaptureTabIcon, usePageCaptures } from "./page-capture-mark";
import { useComputerVolumes } from "./computer-volumes";
import { useFileTabTitles } from "./file-tab-titles";
import { pageTabTitle } from "./file-tabs";
import { screenPresentation } from "./screen-presentation";
import { matchScreen } from "./window-href";
import { windowTabsAtom } from "./window-tabs";

/** What one of the window's tabs is called and drawn with; a site's carries its page's address. */
export interface AppTabPresentation {
  icon: ReactNode;
  title: string;
  url?: string | undefined;
}

/**
 * How the window's tabs are named, read off where each stands: a site by
 * the page its group has up, the inbox alone as Chats, and every other
 * screen as its address says.
 */
export function useAppTabPresentation({
  chatTitles,
  childTitles,
}: {
  chatTitles: Map<ChatId, string>;
  childTitles: Map<StoreId.Session, string>;
}): (href: string) => AppTabPresentation {
  const appsBySlug = useAppsBySlug();
  const { activeByGroup, tabs: groupTabs } = useAtomValue(windowTabsAtom);
  // A closed site's page is kept aside rather than among the group's tabs,
  // and is what its entry in the closed list is named by.
  const putAway = useAtomValue(putAwaySitesAtom);
  const volumes = useComputerVolumes();
  const captures = usePageCaptures().filter(
    ({ using }) => using.audio || using.video,
  );
  const { recentlyClosed, tabs } = useAtomValue(appTabsAtom);
  const fileTitles = useFileTabTitles(
    [...tabs, ...recentlyClosed].map((tab) => tab.pathname),
  );
  return (href) => {
    if (isSiteHref(href)) {
      const group = groupOfHref(href);
      const open = groupTabs.filter((tab) => tab.group === group);
      const own = open.length > 0 ? open : (putAway[group ?? ""] ?? []);
      const up =
        own.find((tab) => tab.id === activeByGroup[group ?? ""]) ?? own[0];
      if (up?.kind === "page") {
        // A page of the tab's using the microphone or camera, up or not,
        // marks the tab, so the one in a call is the one to look for.
        const capture = captures.find(({ targetId }) =>
          own.some(
            (tab) =>
              tab.kind === "page" && targetId === browserTargetOf(tab.id),
          ),
        );
        return {
          icon: capture ? (
            <CaptureTabIcon paused={capture.paused} using={capture.using} />
          ) : (
            <TabIcon favicon={up.favicon} url={up.url} />
          ),
          title: up.title || pageTabTitle(up) || "Page",
          url: up.url,
        };
      }
    }
    if (isChatHref(href) && groupOfHref(href) === undefined) {
      return { icon: <ChatCircleIcon className="size-3.5" />, title: "Chats" };
    }
    return screenPresentation(href, {
      appsBySlug,
      chatTitles,
      ...(fileTitles ? { fileTitles } : {}),
      taskTitles: childTitles,
      ...(volumes ? { volumes } : {}),
    });
  };
}

/**
 * The window's tabs closed lately that would come back as they were, newest
 * first, each named as its tab was, and a way to bring one back where it
 * stood. A site's page is kept only for this
 * launch, so a site closed before it is left out: it would reopen on nothing.
 * A new tab is left out too.
 */
export function useClosedAppTabs(names: {
  chatTitles: Map<ChatId, string>;
  childTitles: Map<StoreId.Session, string>;
}) {
  const presentationOf = useAppTabPresentation(names);
  const [{ recentlyClosed }, setAppTabs] = useAtom(appTabsAtom);
  const putAway = useAtomValue(putAwaySitesAtom);
  const reopenable = recentlyClosed.flatMap((tab, entry) => {
    // A new tab closed is nothing to come back to.
    if (matchScreen(tab.pathname || INBOX_HREF).kind === "newTab") {
      return [];
    }
    return isGoneSite(tab, putAway) ? [] : [{ entry, tab }];
  });
  return {
    closed: reopenable.map(({ tab }) =>
      presentationOf(tab.pathname || INBOX_HREF),
    ),
    /**
     * Whether the first of `closed` is the tab Reopen Closed Tab brings back,
     * which takes the newest closed that can come back, listed or not.
     */
    firstIsReopenedByKey: reopenable[0]?.entry === 0,
    /** Brings one back, up, by its place in `closed`. */
    reopen: (row: number) => {
      const entry = reopenable[row]?.entry;
      if (entry !== undefined) {
        setAppTabs((current) =>
          reopenClosed(current, { entry, id: freshTabId() }),
        );
      }
    },
  };
}
