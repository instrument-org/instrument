import { Button } from "@/client/components/ui/button";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type WindowTab } from "@/client/atoms/window";
import { useContext, useEffect, useEffectEvent } from "react";

import { WindowContext } from "./context";
import { useWindowTabs } from "./window-tabs";

/** How long the bar over a sign-in page says the app connected before it goes. */
const CONNECTED_FOR_MS = 4000;

type SiteSignIn = NonNullable<WindowTab["signIn"]> & { tab: string };

/**
 * The sign-ins on an app's own site still waited on, by slug: the tab the
 * site opened in (`WindowTab.signIn`), the chat that asked, and when the
 * app's connection record was last written as the site opened. Read from
 * the tabs, which are kept across launches, so a card or a page that redraws
 * still knows its site is open, a tab that comes back has its bar, and only
 * that tab draws it.
 */
export function useSiteSignIns(): ReadonlyMap<string, SiteSignIn> {
  return new Map(
    useWindowTabs().allTabs.flatMap((tab) =>
      tab.kind === "page" && tab.signIn !== undefined
        ? [[tab.signIn.slug, { ...tab.signIn, tab: tab.id }] as const]
        : [],
    ),
  );
}

function useApp(slug: string | undefined) {
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  return slug === undefined
    ? undefined
    : apps.data?.apps.find((app) => app.slug === slug);
}

/** Says a web app's sign-in on its site is done, on behalf of the chat that asked. */
function useMarkSignedIn(name: string) {
  return useMutation(
    rpcClient.apps.markWebSignedIn.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't connect ${name}`, { cause: error });
      },
    }),
  );
}

/**
 * A web app's sign-in on its own site, for whatever offers it: the card in a
 * chat, the app's page, and the bar over the site. One page per app: opening
 * it again shows the tab it is in, or opens it anew once that tab is closed.
 */
export function useSiteSignIn({
  askedIn,
  name,
  slug,
}: {
  askedIn: ChatId | undefined;
  name: string;
  slug: string;
}) {
  const appWindow = useContext(WindowContext);
  const windowTabs = useWindowTabs();
  const app = useApp(slug);
  const mark = useMarkSignedIn(name);
  const started = useSiteSignIns().get(slug);
  const signInPage = app?.type === "web" ? app.signIn : undefined;

  /** Notes the tab the app's site opened in, from which the bar and the row's Done follow. */
  const opened = (tab: string | undefined) => {
    if (tab === undefined) {
      return;
    }
    const from = app?.connection?.updatedAt;
    windowTabs.markSignIn(tab, {
      ...(askedIn === undefined ? {} : { chatId: askedIn }),
      ...(from === undefined ? {} : { from }),
      slug,
    });
  };
  return {
    canOpen: Boolean(appWindow?.browser) && signInPage !== undefined,
    done: () => {
      mark.mutate({
        ...(askedIn === undefined ? {} : { chatId: askedIn }),
        slug,
      });
    },
    isDonePending: mark.isPending,
    /** Whether the site was opened from here and the app has not connected since. */
    isWaiting: started !== undefined,
    open: () => {
      if (started !== undefined && appWindow?.showTab?.(started.tab)) {
        return;
      }
      if (signInPage !== undefined) {
        opened(appWindow?.openPage(signInPage));
      }
    },
    opened,
  };
}

/**
 * Lets go of each site sign-in as it ends: a moment after its app connects,
 * so the bar over the site can say so, and at once when its app is skipped
 * or removed. The site's tab is an ordinary tab from then on.
 */
export function useSiteSignInsEnd() {
  const signIns = useSiteSignIns();
  const windowTabs = useWindowTabs();
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const drop = useEffectEvent((slugs: string[]) => {
    for (const slug of slugs) {
      const tab = signIns.get(slug)?.tab;
      if (tab !== undefined) {
        windowTabs.markSignIn(tab, undefined);
      }
    }
  });
  const appOf = (slug: string) =>
    apps.data?.apps.find((app) => app.slug === slug);
  // Named by their slugs, so each effect runs as its list changes and not
  // as the map is rebuilt.
  const over = apps.data
    ? [...signIns]
        .filter(([slug, { from }]) => {
          const app = appOf(slug);
          return (
            app === undefined ||
            (app.status === "declined" && app.connection?.updatedAt !== from)
          );
        })
        .map(([slug]) => slug)
        .join("\n")
    : "";
  const connected = [...signIns.keys()]
    .filter((slug) => appOf(slug)?.status === "connected")
    .join("\n");
  useEffect(() => {
    if (over !== "") {
      drop(over.split("\n"));
    }
  }, [over]);
  useEffect(() => {
    if (connected === "") {
      return;
    }
    const timeout = window.setTimeout(() => {
      drop(connected.split("\n"));
    }, CONNECTED_FOR_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [connected]);
}

/**
 * The bar over a site the window opened for a sign-in: what to do there and
 * Done, then a word that the app connected. Only over the tab the sign-in
 * opened, and only while it waits, so the same site in any other tab, or
 * after the sign-in was skipped, has none. Done answers here and opens
 * nothing.
 */
export function SiteSignInBar({ tabId }: { tabId: string }) {
  const [slug, started] =
    [...useSiteSignIns()].find(([, entry]) => entry.tab === tabId) ?? [];
  const app = useApp(slug);
  const name = app?.name ?? "";
  const mark = useMarkSignedIn(name);
  if (slug === undefined || app === undefined) {
    return null;
  }
  if (app.status === "connected") {
    return (
      <div
        className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-brand-50 px-3 text-sm dark:bg-brand-500/15"
        role="status"
      >
        <CheckIcon
          className="size-4 shrink-0 text-brand-600 dark:text-brand-400"
          weight="bold"
        />
        <span className="min-w-0 flex-1 truncate">{name} is connected.</span>
      </div>
    );
  }
  return (
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-brand-50 px-3 text-sm dark:bg-brand-500/15">
      <InstrumentGlyph
        className="shrink-0 text-brand-600 dark:text-brand-400"
        size={18}
      />
      <span className="min-w-0 flex-1 truncate">
        When you’re signed in to {name}, press Done.
      </span>
      <Button
        className="min-w-18"
        disabled={mark.isPending}
        onClick={() => {
          mark.mutate({
            ...(started?.chatId === undefined
              ? {}
              : { chatId: started.chatId }),
            slug,
          });
        }}
        size="sm"
        variant="brand"
      >
        Done
      </Button>
    </div>
  );
}
