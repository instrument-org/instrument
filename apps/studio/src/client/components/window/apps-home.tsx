import { visitedPagesAtom } from "@/client/atoms/window";
import { Skeleton } from "@/client/components/ui/skeleton";
import { AppIcon } from "@/client/components/window/app-icon";
import { visitsWithin } from "@/client/components/window/app-visits";
import { useWindow } from "@/client/components/window/context";
import { GlyphButton } from "@/client/components/window/glyph-button";
import { PageSection } from "@/client/components/window/page-section";
import { VisitedPageRows } from "@/client/components/window/visited-page-rows";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { appMentionToken } from "@/client/lib/app-mention";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  APP_CATEGORIES,
  directoryByUse,
  searchDirectory,
} from "@instrument-org/shared/app-directory";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useState } from "react";

type App = RPCOutput["apps"]["list"]["apps"][number];
type CatalogEntry = RPCOutput["apps"]["catalog"][number];

/**
 * How many pages visited across the apps the page lists: enough to find the
 * one from this morning, few enough that the apps stay the head of the page.
 */
const RECENT_SHOWN = 9;

/** How many of the directory's services are offered before the rest are behind the head's button. */
const MORE_SHOWN = 12;

/**
 * The Apps place's new tab: the apps this workspace reaches as marks, the
 * pages you were on lately across all of them, and the services still to
 * connect. Pressing an app shows its own front; pressing a page opens it in
 * this tab. Nothing here is written by the agent: the marks are the apps
 * and Recent is the window's own browsing, so the place is already yours the
 * first time you open it.

 *
 * Opening an app is the host's to do: the place moves its tab to the app's
 * front, a draft moves its own. A draft shows only what is already here,
 * without the services still to connect.
 */
export function AppsHome({
  onOpenApp,
  showsConnect = true,
}: {
  onOpenApp: (slug: string) => void;
  /** Whether the services still to connect, and the broken ones to fix, are offered. */
  showsConnect?: boolean;
}) {
  const { ask, openPage } = useWindow();
  const list = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
  const visited = useAtomValue(visitedPagesAtom);
  const [query, setQuery] = useState("");
  const [showsAll, setShowsAll] = useState(false);

  const apps = list.data?.apps ?? [];
  // Connected first, since theirs are the fronts worth opening; the ones
  // still being set up follow, each saying what it waits for.
  const own = [
    ...apps.filter((app) => app.standing === "connected"),
    ...apps.filter((app) => app.standing !== "connected"),
  ];
  const known = new Set(apps.map((app) => app.slug));
  // Still to connect, most used first; the documentation servers and the
  // like are left out until a search names one.
  const unconnected = (catalog.data ?? []).filter(
    (entry) => !known.has(entry.slug),
  );
  const more = directoryByUse(unconnected);
  // Across every app the page knows: the workspace's own first, so a page
  // on one of them is filed under it, then the directory's, since a site
  // opened from its front is an app here whether or not it is connected.
  const visits = visitsWithin(visited, [
    ...apps,
    ...more.map((entry) => ({
      name: entry.name,
      site: `https://${entry.domain}`,
    })),
  ]).slice(0, RECENT_SHOWN);
  const typed = query.trim();
  const matches = typed === "" ? more : searchDirectory(unconnected, typed);
  const shown =
    typed === "" ? (showsAll ? more : more.slice(0, MORE_SHOWN)) : matches;
  const connectTyped = () => {
    ask(`Connect ${typed}`);
    setQuery("");
  };
  const openApp = onOpenApp;
  const tileFor = (entry: CatalogEntry) => (
    <CatalogTile
      entry={entry}
      key={entry.slug}
      onConnect={() => {
        ask(`Connect ${appMentionToken(entry)}`);
      }}
      onOpen={() => {
        openApp(entry.slug);
      }}
    />
  );

  return (
    <div className="@container/apps h-full min-h-0 overflow-y-auto">
      {/* As a page, Discover's column and head: centered, with room around
        it. Inside a draft, the narrower column the draft's frame allows. */}
      <div
        className={cn(
          "mx-auto w-full",
          showsConnect
            ? "max-w-5xl space-y-12 px-10 pt-14 pb-20"
            : "max-w-3xl space-y-8 px-8 pt-7 pb-10",
        )}
      >
        {showsConnect ? (
          <header className="max-w-xl">
            <h1 className="font-serif text-3xl leading-tight font-normal tracking-tight text-brand-600 dark:text-brand-300">
              Apps
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              Connect the services you already use. Instrument does the setup,
              then works in them from your chats.
            </p>
          </header>
        ) : null}
        {/* Where the person was lately comes first, as a browser's new tab
            puts it; the apps themselves under it. */}
        {visits.length > 0 ? (
          <PageSection title="Recent pages">
            <VisitedPageRows isCompact onOpen={openPage} visits={visits} />
          </PageSection>
        ) : null}

        {list.data === undefined ? (
          <PageSection title="Your apps">
            <MarkSkeletons />
          </PageSection>
        ) : own.length > 0 ? (
          <PageSection title="Your apps">
            {/* Pulled in by the gap between a mark's box and its icon, so
                the icons line up under the heading. */}
            <div className="-ml-4 flex flex-wrap gap-x-2 gap-y-4">
              {own.map((app) => (
                <AppMark
                  app={app}
                  key={app.slug}
                  onOpen={() => {
                    openApp(app.slug);
                  }}
                />
              ))}
            </div>
          </PageSection>
        ) : null}

        {!showsConnect &&
        list.data !== undefined &&
        own.length === 0 &&
        visits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Apps you connect show up here.
          </p>
        ) : null}

        {/* The services still to connect, searchable: a dozen most people
            know until something is typed, then whatever matches, and for a
            name the directory does not have, the way to ask for it anyway.
            Every Connect is a message to the conversation, since Instrument
            does the connecting. */}
        {showsConnect && (
          <PageSection
            title={own.length > 0 ? "Connect more apps" : "Connect an app"}
          >
            <form
              className="group/search relative mb-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (typed !== "" && matches.length === 0) {
                  connectTyped();
                }
              }}
            >
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground group-focus-within/search:text-foreground" />
              {/* The cards' surface and edge, a size up since it leads the
                shelf, with the brand's green as its focus. */}
              <input
                aria-label="Search apps"
                className="h-11 w-full rounded-xl border-0 bg-card pr-4 pl-11 text-[15px] shadow-xs transition-shadow outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-brand-500/30 dark:bg-input/30"
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Search apps, or name any service"
                value={query}
              />
            </form>
            {catalog.data === undefined ? (
              <TileSkeletons />
            ) : typed === "" && showsAll ? (
              <CategoryGroups entries={more} renderTile={tileFor} />
            ) : shown.length > 0 || typed !== "" ? (
              <div className="grid grid-cols-1 gap-3 @xl/apps:grid-cols-2">
                {shown.map(tileFor)}
                {typed === "" ? null : (
                  <UnlistedTile
                    isOnlyOne={matches.length === 0}
                    name={typed}
                    onConnect={connectTyped}
                  />
                )}
              </div>
            ) : null}
            {typed === "" && more.length > MORE_SHOWN ? (
              <button
                className="mt-4 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowsAll(!showsAll);
                }}
                type="button"
              >
                {showsAll ? "Show fewer" : `Show all ${more.length}`}
              </button>
            ) : null}
          </PageSection>
        )}

        {showsConnect && list.data && list.data.invalid.length > 0 ? (
          <PageSection title="Broken">
            <div className="divide-y divide-border rounded-xl bg-card shadow-xs">
              {list.data.invalid.map((entry) => (
                <div className="flex items-center gap-3 p-4" key={entry.slug}>
                  <AppIcon />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {entry.slug}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.message}
                    </span>
                  </span>
                  <GlyphButton
                    onClick={() => {
                      ask(`Fix the ${entry.slug} app; its manifest is broken`);
                    }}
                    size="sm"
                  >
                    Fix
                  </GlyphButton>
                </div>
              ))}
            </div>
          </PageSection>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One of the workspace's apps as a mark: its icon on a card with its name
 * under it, and under that, for one not yet connected, what it waits for.
 * The mark is the only control it needs, since pressing one can mean
 * nothing but open it.
 */
function AppMark({ app, onOpen }: { app: App; onOpen: () => void }) {
  const href = `/apps/${app.slug}`;
  const { onContextMenu, opening } = useOpenGestures({
    href,
    kind: "screen",
  });
  const waiting = app.standing === "connected" ? undefined : waitingLine(app);
  return (
    <button
      className="group flex w-24 flex-col items-center gap-1.5 rounded-xl py-2 text-center hover:bg-accent/50"
      {...opening(onOpen)}
      onContextMenu={onContextMenu}
      title={waiting ? `${app.name}: ${waiting}` : app.name}
      type="button"
    >
      <AppIcon
        className={cn(
          "transition-shadow group-hover:shadow-md",
          waiting && "opacity-60",
        )}
        name={app.name}
        icon={app.icon}
        site={app.site}
        size="xl"
      />
      <span className="w-full truncate text-[13px] leading-4 font-medium">
        {app.name}
      </span>
      {waiting ? (
        <span className="-mt-1 w-full truncate text-[11px] leading-4 text-muted-foreground">
          {waiting}
        </span>
      ) : null}
    </button>
  );
}

/**
 * A service the directory knows, still to connect: its icon, its name and
 * tagline, and the one control that starts connecting it. The tile itself
 * opens the service's page, which says what connecting takes.
 */
function CatalogTile({
  entry,
  onConnect,
  onOpen,
}: {
  entry: CatalogEntry;
  onConnect: () => void;
  onOpen: () => void;
}) {
  const href = `/apps/${entry.slug}`;
  const { onContextMenu, opening } = useOpenGestures({
    href,
    kind: "screen",
  });
  return (
    // Discover's card, chunkier: the shadow's hairline as the edge, lifting
    // under the pointer. 72px tall around a 32px button, so the button sits
    // 20px from the top, the bottom and the end, the inset the icon keeps at
    // the start.
    <div className="flex h-18 items-center gap-3 rounded-2xl bg-card px-5 shadow-xs transition-shadow duration-200 hover:shadow-md">
      <button
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        {...opening(onOpen)}
        onContextMenu={onContextMenu}
        type="button"
      >
        {/* No plate of its own: the tile is the box it sits in. */}
        <AppIcon
          className="size-9 rounded-lg bg-transparent p-0 shadow-none ring-0"
          icon={entry.icon}
          name={entry.name}
          site={`https://${entry.domain}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-snug font-medium">
            {entry.name}
          </span>
          <span className="block truncate text-[13px] leading-snug text-muted-foreground">
            {entry.tagline}
          </span>
        </span>
      </button>
      <GlyphButton onClick={onConnect} size="sm">
        Connect
      </GlyphButton>
    </div>
  );
}

/** Marks holding the section's place while the apps are still on their way. */
function MarkSkeletons() {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          className="flex w-24 flex-col items-center gap-1.5 py-2"
          key={index}
        >
          <Skeleton className="size-16 rounded-2xl" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

/** Tiles holding the directory's place while it is still on its way. */
function TileSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-3 @xl/apps:grid-cols-2">
      {Array.from({ length: MORE_SHOWN }, (_, index) => (
        <div
          className="flex h-18 items-center gap-3 rounded-2xl bg-card px-5 shadow-xs"
          key={index}
        >
          <Skeleton className="size-9 rounded-lg" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The directory with the services most people know brought to the front, the rest in its own order. */
/**
 * A service the directory does not list, as a tile beside the ones it does:
 * what was typed, and the promise that Instrument finds it and connects it.
 * Alone when nothing matched; last among the matches otherwise, for the
 * name that was meant and not found.
 */
function UnlistedTile({
  isOnlyOne,
  name,
  onConnect,
}: {
  isOnlyOne: boolean;
  name: string;
  onConnect: () => void;
}) {
  return (
    <div
      className={cn(
        "flex h-18 items-center gap-3 rounded-2xl border border-dashed border-border px-5 hover:bg-accent/40",
        isOnlyOne && "@lg/apps:col-span-2",
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <PlusIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-snug font-medium">
          {isOnlyOne ? `“${name}” isn’t listed` : `Connect “${name}” anyway`}
        </span>
        <span className="block truncate text-[13px] leading-snug text-muted-foreground">
          Instrument finds how it connects and sets it up.
        </span>
      </span>
      <GlyphButton onClick={onConnect} size="sm">
        Connect
      </GlyphButton>
    </div>
  );
}

/** What an app not yet connected is waiting for, in a few words under its name. */
function waitingLine(app: App): string {
  switch (app.standing) {
    case "declined": {
      return "Not connected";
    }
    case "failed": {
      // The service's own words are three lines of SDK talk and belong on
      // the app's page, where there is room to read them and something to
      // press. A mark says which app is the problem; that is the whole of
      // its job.
      return "Could not connect";
    }
    case "needs-approval": {
      return "Needs your go-ahead";
    }
    case "needs-key": {
      return "Needs a key";
    }
    case "needs-sign-in": {
      return "Needs a sign-in";
    }
    case "stale": {
      return "Changed since tested";
    }
    default: {
      return "Not tested yet";
    }
  }
}

/**
 * Every service still to connect, under its category, most used first in
 * each. Developer tools hold a quarter of the directory and few of the
 * people it is for, so they wait behind their own button rather than
 * making the page read as a developer product.
 */
function CategoryGroups({
  entries,
  renderTile,
}: {
  entries: CatalogEntry[];
  renderTile: (entry: CatalogEntry) => ReactNode;
}) {
  const [showsDeveloper, setShowsDeveloper] = useState(false);
  return (
    <div className="space-y-8">
      {APP_CATEGORIES.map(({ id, label }) => {
        const inCategory = entries.filter((entry) => entry.category === id);
        if (inCategory.length === 0) {
          return null;
        }
        const collapsed = id === "developer" && !showsDeveloper;
        return (
          <div key={id}>
            <h3 className="mb-3 text-[13px] font-medium text-foreground">
              {label}
            </h3>
            {collapsed ? (
              <button
                className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowsDeveloper(true);
                }}
                type="button"
              >
                {`Show ${inCategory.length} developer tools`}
              </button>
            ) : (
              <div className="grid grid-cols-1 gap-3 @xl/apps:grid-cols-2">
                {inCategory.map(renderTile)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
