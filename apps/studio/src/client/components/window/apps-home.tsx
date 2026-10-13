import { useDecisionModelAvailable } from "@/client/hooks/use-decision";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Skeleton } from "@/client/components/ui/skeleton";
import { AppIcon } from "@/client/components/window/app-icon";
import { useWindow } from "@/client/components/window/context";
import { useConnectFromDirectory } from "@/client/components/window/use-connect-from-directory";
import { GlyphButton } from "@/client/components/window/glyph-button";
import { PageSection } from "@/client/components/window/page-section";
import { useDebouncedValue } from "@/client/hooks/use-debounced-value";
import { useFindTarget } from "@/client/hooks/use-find-target";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APPS_HREF } from "@/client/atoms/window";
import {
  APP_CATEGORIES,
  directoryByUse,
  searchDirectory,
} from "@instrument-org/shared/app-directory";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useDeferredValue, useRef, useState } from "react";

type App = RPCOutput["apps"]["list"]["apps"][number];
type CatalogEntry = RPCOutput["apps"]["catalog"][number];

/**
 * A search this long that names no service by its words is asked of the
 * decision model for the services it means.
 */
const MEANING_MIN_LENGTH = 3;

/** How many tiles hold the directory's place while it is on its way. */
const SKELETONS_SHOWN = 12;
/** How many tiles hold the related services' place while the model is asked: one row. */
const RELATED_SKELETONS = 2;

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
  const { ask, openScreen } = useWindow();
  // Beside a chat or in a draft there is no search or Connect, so the way to
  // a new app is the Apps place itself, in a tab of the window's own.
  const openAppsPlace = () => {
    openScreen(APPS_HREF, { newTab: true });
  };
  const list = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
  const [query, setQuery] = useState("");

  const apps = list.data?.apps ?? [];
  // Connected first, since theirs are the fronts worth opening; the ones
  // still being set up follow, each saying what it waits for.
  const own = [
    ...apps.filter((app) => app.standing === "connected"),
    ...apps.filter((app) => app.standing !== "connected"),
  ];
  // Every service the directory lists stays in its place, the ones already
  // here included, so a search finds an app whoever forgot it was set up;
  // most used first, and the documentation servers and the like left out
  // until a search names one.
  const listed = catalog.data ?? [];
  const more = directoryByUse(listed);
  // The field answers every key at once; the tiles follow a beat behind
  // when a keystroke's render would hold the next one up.
  const typed = useDeferredValue(query.trim());
  const matches = typed === "" ? more : searchDirectory(listed, typed);
  // Unsearched, the featured services lead as Popular and every other one
  // follows under its category, so the whole directory is a scroll away.
  const popular = more.filter((entry) => entry.tier === "featured");
  const rest = more.filter((entry) => entry.tier !== "featured");
  // A search the words don't answer ("text my mom") goes to the decision
  // model once the typing settles. Its place at the foot of the results is
  // held from the first key that asks, so what it finds lands where nothing
  // is to be pressed and moves nothing that is.
  // Read once a search is typed, so a workspace no model can answer for
  // never holds a "Related" place that only empties.
  const canAskMeaning = useDecisionModelAvailable(showsConnect && typed !== "");
  const asksMeaning =
    canAskMeaning === true &&
    showsConnect &&
    typed.length >= MEANING_MIN_LENGTH &&
    matches.length === 0;
  const settled = useDebouncedValue(typed, 300);
  const byMeaning = useQuery(
    rpcClient.apps.catalogByMeaning.queryOptions({
      enabled: asksMeaning && settled === typed,
      input: { query: settled },
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  const shownSlugs = new Set(matches.map((entry) => entry.slug));
  const answered = asksMeaning && settled === typed && byMeaning.isFetched;
  const meant = answered
    ? (byMeaning.data ?? []).filter((entry) => !shownSlugs.has(entry.slug))
    : [];
  const connectTyped = () => {
    ask(`Connect ${typed}`);
    setQuery("");
  };
  const openApp = onOpenApp;
  const { connect } = useConnectFromDirectory();
  // An app of the workspace's is this service when the directory says it
  // is, whatever its slug, so a second account set up beside the first
  // (gmail-2 beside gmail) is the same service.
  const mineOf = (entry: CatalogEntry) =>
    own.filter((app) => app.service === entry.slug);
  const tileFor = (entry: CatalogEntry) => {
    const mine = mineOf(entry);
    return (
      <CatalogTile
        entry={entry}
        key={entry.slug}
        mine={mine.map((app) => app.slug)}
        onConnect={() => {
          connect(entry);
        }}
        onConnectAnother={() => {
          connect(entry, { another: true });
        }}
        onOpen={(slug) => {
          openApp(slug);
        }}
      />
    );
  };
  // A search lays a service already here out account by account.
  const searchTileFor = (entry: CatalogEntry) => {
    const mine = mineOf(entry);
    return mine.length === 0 ? (
      tileFor(entry)
    ) : (
      <AccountTiles
        apps={mine}
        entry={entry}
        key={entry.slug}
        onConnectAnother={() => {
          connect(entry, { another: true });
        }}
        onOpen={openApp}
      />
    );
  };

  const searchRef = useRef<HTMLInputElement>(null);
  useFindTarget({
    anchor: searchRef,
    openFind: () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
  });

  return (
    <div
      className="@container/apps h-full min-h-0 overflow-y-auto"
      data-find-surface
    >
      {/* As a page, a centered column and head with room around it. Inside
        a draft, the narrower column the draft's frame allows. */}
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
              {showsConnect ? null : <AddAppMark onOpen={openAppsPlace} />}
            </div>
          </PageSection>
        ) : null}

        {!showsConnect && list.data !== undefined && own.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-black/2 px-6 py-8 text-center dark:bg-white/3">
            <p className="text-sm text-muted-foreground">
              Once you connect an app, you can use it from any chat.
            </p>
            <Button onClick={openAppsPlace} size="sm" variant="outline">
              <PlusIcon />
              Add an app
            </Button>
          </div>
        ) : null}

        {/* The services still to connect, searchable: the popular ones and
            then all the rest by category until something is typed, then
            whatever matches, and for a name the directory does not have,
            the way to ask for it anyway. Every Connect is a message to the
            conversation, since Instrument does the connecting. */}
        {showsConnect && (
          <div className="space-y-10">
            <form
              className="group/search relative"
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
                ref={searchRef}
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
            ) : typed === "" ? (
              <>
                {popular.length > 0 ? (
                  <PageSection title="Popular">
                    <div className="grid grid-cols-1 gap-3 @xl/apps:grid-cols-2">
                      {popular.map(tileFor)}
                    </div>
                  </PageSection>
                ) : null}
                {rest.length > 0 ? (
                  <PageSection title="By category">
                    <CategoryGroups entries={rest} renderTile={tileFor} />
                  </PageSection>
                ) : null}
              </>
            ) : (
              <div className="space-y-6">
                {matches.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 @xl/apps:grid-cols-2">
                    {matches.map(searchTileFor)}
                  </div>
                ) : null}
                {/* A service the words name exactly, listed or already
                    yours, is the one meant, so "connect it anyway" would
                    only offer it a second time. */}
                {namesOne(matches, typed) || namesOne(own, typed) ? null : (
                  <div className="grid grid-cols-1 gap-3 @xl/apps:grid-cols-2">
                    <UnlistedTile
                      isOnlyOne={matches.length === 0}
                      name={typed}
                      onConnect={connectTyped}
                    />
                  </div>
                )}
                {asksMeaning && !(answered && meant.length === 0) ? (
                  <div>
                    <h3 className="mb-2.5 text-[12px] font-medium text-muted-foreground">
                      Related
                    </h3>
                    {answered ? (
                      <div className="grid animate-in grid-cols-1 gap-3 duration-200 fade-in-0 @xl/apps:grid-cols-2">
                        {meant.map(searchTileFor)}
                      </div>
                    ) : (
                      <TileSkeletons count={RELATED_SKELETONS} />
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
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
      title={
        waiting
          ? `${app.name}: ${waiting}`
          : app.account
            ? `${app.name}: ${app.account}`
            : app.name
      }
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
      {/* Under the name, what it waits for, or else which account it is,
          so two of one service read apart. */}
      {waiting || app.account ? (
        <span className="-mt-1 w-full truncate text-[11px] leading-4 text-muted-foreground">
          {waiting ?? app.account}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The last of the workspace's marks: a dashed plate with a plus, which opens
 * the Apps place where a new one is found and connected.
 */
function AddAppMark({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      className="group flex w-24 flex-col items-center gap-1.5 rounded-xl py-2 text-center hover:bg-accent/50"
      onClick={onOpen}
      type="button"
    >
      <span className="grid size-16 place-items-center rounded-2xl border border-dashed border-border text-muted-foreground group-hover:text-foreground">
        <PlusIcon className="size-6" />
      </span>
      <span className="w-full truncate text-[13px] leading-4 font-medium text-muted-foreground group-hover:text-foreground">
        Add app
      </span>
    </button>
  );
}

/**
 * A service the directory knows, still to connect: its icon, its name and
 * tagline, and the one control that starts connecting it. The tile itself
 * opens the service's page, which says what connecting takes. One already
 * here opens its own page, with connecting another account under its menu.
 */
function CatalogTile({
  entry,
  mine,
  onConnect,
  onConnectAnother,
  onOpen,
}: {
  entry: CatalogEntry;
  /** The workspace's own apps that are this service, when it has any. */
  mine: string[];
  onConnect: () => void;
  onConnectAnother: () => void;
  onOpen: (slug: string) => void;
}) {
  const first = mine[0];
  // A service already here opens its own page; one not yet here opens the
  // directory's page for it, which says what connecting takes.
  const target = first ?? entry.slug;
  return (
    <Tile
      icon={entry.icon}
      line={
        first === undefined
          ? entry.tagline
          : mine.length === 1
            ? "In your apps"
            : `${mine.length} accounts in your apps`
      }
      name={entry.name}
      onOpen={() => {
        onOpen(target);
      }}
      site={`https://${entry.domain}`}
      target={target}
    >
      {first === undefined ? (
        <GlyphButton onClick={onConnect} size="sm">
          Connect
        </GlyphButton>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            onClick={() => {
              onOpen(first);
            }}
            size="sm"
            variant="outline"
          >
            Open
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`More for ${entry.name}`}
                size="icon-sm"
                variant="ghost"
              >
                <DotsThreeIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onConnectAnother}>
                Connect another account
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </Tile>
  );
}

/**
 * A search's answer for a service already here: a tile for each of its apps,
 * each saying which account it is, and one more that connects another, so
 * every account is a press away and adding one sits right beside them.
 */
function AccountTiles({
  apps,
  entry,
  onConnectAnother,
  onOpen,
}: {
  apps: App[];
  entry: CatalogEntry;
  onConnectAnother: () => void;
  onOpen: (slug: string) => void;
}) {
  return (
    <>
      {apps.map((app) => (
        <Tile
          icon={app.icon ?? entry.icon}
          key={app.slug}
          line={
            app.standing === "connected"
              ? (app.account ?? "In your apps")
              : waitingLine(app)
          }
          name={app.name}
          onOpen={() => {
            onOpen(app.slug);
          }}
          site={app.site ?? `https://${entry.domain}`}
          target={app.slug}
        >
          <Button
            onClick={() => {
              onOpen(app.slug);
            }}
            size="sm"
            variant="outline"
          >
            Open
          </Button>
        </Tile>
      ))}
      <Tile
        icon={entry.icon}
        key={`${entry.slug}:another`}
        line="Connect another account"
        name={entry.name}
        onOpen={onConnectAnother}
        site={`https://${entry.domain}`}
      >
        <GlyphButton onClick={onConnectAnother} size="sm">
          Connect
        </GlyphButton>
      </Tile>
    </>
  );
}

/**
 * The card every directory tile is: the service's icon, a name and a line
 * under it, pressing it opens `target`'s page (or does `onOpen` where there
 * is no page to open), and the controls at its end.
 */
function Tile({
  children,
  icon,
  line,
  name,
  onOpen,
  site,
  target,
}: {
  children: ReactNode;
  icon: string | undefined;
  line: string;
  name: string;
  onOpen: () => void;
  site: string | undefined;
  /** The app whose page the tile opens, when it opens one. */
  target?: string;
}) {
  const { onContextMenu, opening } = useOpenGestures({
    href: `/apps/${target ?? ""}`,
    kind: "screen",
  });
  return (
    // A card, the shadow's hairline as its edge, lifting under the pointer.
    // 72px tall around a 32px button, so the button sits 20px from the top,
    // the bottom and the end, the inset the icon keeps at the start.
    <div className="flex h-18 items-center gap-3 rounded-2xl bg-card px-5 shadow-xs transition-shadow duration-200 hover:shadow-md">
      <button
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        {...(target === undefined ? { onClick: onOpen } : opening(onOpen))}
        onContextMenu={target === undefined ? undefined : onContextMenu}
        type="button"
      >
        {/* No plate of its own: the tile is the box it sits in. */}
        <AppIcon
          className="size-9 rounded-lg bg-transparent p-0 shadow-none ring-0"
          icon={icon}
          name={name}
          site={site}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-snug font-medium">
            {name}
          </span>
          <span className="block truncate text-[13px] leading-snug text-muted-foreground">
            {line}
          </span>
        </span>
      </button>
      {children}
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

/** Tiles holding the directory's place, or the related services', while they are still on their way. */
function TileSkeletons({ count = SKELETONS_SHOWN }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 @xl/apps:grid-cols-2">
      {Array.from({ length: count }, (_, index) => (
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
          Instrument will figure out how to connect it for you.
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
 * each. Developer tools come last, where the categories' order puts them.
 */
function CategoryGroups({
  entries,
  renderTile,
}: {
  entries: CatalogEntry[];
  renderTile: (entry: CatalogEntry) => ReactNode;
}) {
  return (
    <div className="space-y-8">
      {APP_CATEGORIES.map(({ id, label }) => {
        const inCategory = entries.filter((entry) => entry.category === id);
        if (inCategory.length === 0) {
          return null;
        }
        return (
          <div key={id}>
            <h3 className="mb-2.5 text-[12px] font-medium text-muted-foreground">
              {label}
            </h3>
            <div className="grid grid-cols-1 gap-3 @xl/apps:grid-cols-2">
              {inCategory.map(renderTile)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Whether the words are some app's own name, slug, or alias. */
function namesOne(
  matches: { aliases?: string[] | undefined; name: string; slug: string }[],
  typed: string,
): boolean {
  const words = typed.trim().toLowerCase();
  return matches.some(
    (entry) =>
      entry.name.toLowerCase() === words ||
      entry.slug === words ||
      (entry.aliases ?? []).some((alias) => alias.toLowerCase() === words),
  );
}
