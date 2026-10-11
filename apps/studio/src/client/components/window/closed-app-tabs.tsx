import { freshTabId } from "@/client/lib/tab-actions";
import { reopenClosed } from "@/client/lib/tabs-model";
import { NEW_TAB_HREF } from "@/client/atoms/window";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { useAtom, useAtomValue } from "jotai";
import { type ReactNode } from "react";

import {
  appTabsAtom,
  groupOfHref,
  INBOX_HREF,
  isChatHref,
  isSiteHref,
  putAwaySitesAtom,
} from "./app-tabs";
import { useAppsBySlug } from "./apps-by-slug";
import { TabIcon } from "./browser-tabs";
import { useComputerVolumes } from "./computer-volumes";
import { pageTabTitle } from "./file-tabs";
import { screenPresentation } from "./screen-presentation";
import { parseHref } from "./window-href";
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
  return (href) => {
    if (isSiteHref(href)) {
      const group = groupOfHref(href);
      const open = groupTabs.filter((tab) => tab.group === group);
      const own = open.length > 0 ? open : (putAway[group ?? ""] ?? []);
      const up =
        own.find((tab) => tab.id === activeByGroup[group ?? ""]) ?? own[0];
      if (up?.kind === "page") {
        return {
          icon: <TabIcon favicon={up.favicon} url={up.url} />,
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
    if (parseHref(tab.pathname || INBOX_HREF).pathname === NEW_TAB_HREF) {
      return [];
    }
    const group = isSiteHref(tab.pathname)
      ? groupOfHref(tab.pathname)
      : undefined;
    return group !== undefined && !putAway[group] ? [] : [{ entry, tab }];
  });
  return {
    closed: reopenable.map(({ tab }) =>
      presentationOf(tab.pathname || INBOX_HREF),
    ),
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
