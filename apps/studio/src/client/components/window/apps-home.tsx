import { useDecisionModelAvailable } from "@/client/hooks/use-decision";
import { FieldKeys } from "@/client/components/field-keys";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { AppIcon } from "@/client/components/window/app-icon";
import { useWindow } from "@/client/components/window/context";
import { useGroupTab } from "@/client/components/window/group-tab";
import { useConnectFromDirectory } from "@/client/components/window/use-connect-from-directory";
import { AppContextMenu } from "@/client/components/window/app-menu";
import { pressShortcut } from "@/client/components/window/drag/press-bookmark";
import { PageSection } from "@/client/components/window/page-section";
import { useDebouncedValue } from "@/client/hooks/use-debounced-value";
import { useFindTarget } from "@/client/hooks/use-find-target";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  APP_CATEGORIES,
  type AppCategory,
  directoryByUse,
  searchDirectory,
} from "@instrument-org/shared/app-directory";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useQuery } from "@tanstack/react-query";
import { type ComponentProps, useDeferredValue, useRef, useState } from "react";

type App = RPCOutput["apps"]["list"]["apps"][number];
type CatalogEntry = RPCOutput["apps"]["catalogByMeaning"][number];

/**
 * A search this long that names no service by its words is asked of the
 * decision model for the services it means.
 */
const MEANING_MIN_LENGTH = 3;

const TWO_COLUMNS = "grid grid-cols-1 gap-3 @xl/apps:grid-cols-2";
const THREE_COLUMNS =
  "grid grid-cols-1 gap-3 @lg/apps:grid-cols-2 @4xl/apps:grid-cols-3";

/** Room left between the head and a section its chip goes to, past the fade. */
const SECTION_GAP = 20;
/** The row of chips under the stuck head: a chip and the room beneath it. */
const CHIP_ROW_HEIGHT = 40;

/** The AIs at the top, in the order most people would look for them. */
const AI_ORDER = ["chatgpt", "gemini", "claude", "grok", "microsoft-copilot"];
function aiOrder(slug: string) {
  const at = AI_ORDER.indexOf(slug);
  return at === -1 ? AI_ORDER.length : at;
}

/** A category's heading; the AIs not at the top come under More AI. */
function categoryLabel(id: AppCategory, label: string) {
  return id === "ai" ? "More AI" : label;
}

/** How many tiles hold the directory's place while it is on its way. */
const SKELETONS_SHOWN = 12;
/** How many tiles hold the related services' place while the model is asked: one row. */
const RELATED_SKELETONS = 2;

/**
 * The Apps place's new tab: the apps this workspace reaches, then the
 * services still to connect, the AIs first, with a search and the categories
 * kept at the top as it scrolls. A tile opens the app's page, which is where
 * connecting happens.
 *
 * Opening an app is the host's to do: the tab moves to the app's front.
 */
export function AppsHome({ onOpenApp }: { onOpenApp: (slug: string) => void }) {
  const { ask } = useWindow();
  // What is asked here opens its draft beside the page.
  const from = useGroupTab()?.id;
  const {
    ais,
    catalog: catalogData,
    categories,
    list: listData,
    listed,
    mineOf,
    more,
    own,
    popular,
    rest,
  } = useDirectory();
  const [query, setQuery] = useState("");

  // The field answers every key at once; the tiles follow a beat behind
  // when a keystroke's render would hold the next one up.
  const typed = useDeferredValue(query.trim());
  const matches = typed === "" ? more : searchDirectory(listed, typed);
  // The workspace's own apps the words name, less those a service's tiles
  // already show: one no service lists is found here or nowhere.
  const matchedOwn =
    typed === ""
      ? []
      : searchOwn(own, typed).filter(
          (app) => !matches.some((entry) => entry.slug === app.service),
        );
  const isFound = matches.length > 0 || matchedOwn.length > 0;
  // A hundred and more tiles below the fold: the page comes up without them
  // and they follow, so pressing Apps answers at once.
  const isRestDue = useDeferredValue(true, false);
  // A search the words don't answer ("text my mom") goes to the decision
  // model once the typing settles. Its place at the foot of the results is
  // held from the first key that asks, so what it finds lands where nothing
  // is to be pressed and moves nothing that is.
  // Read once a search is typed, so a workspace no model can answer for
  // never holds a "Related" place that only empties.
  const canAskMeaning = useDecisionModelAvailable(typed !== "");
  const asksMeaning =
    canAskMeaning === true && typed.length >= MEANING_MIN_LENGTH && !isFound;
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
    ask(`Connect ${typed}`, { from });
    setQuery("");
  };
  const { connect } = useConnectFromDirectory();
  const tileFor = (entry: CatalogEntry) => (
    <CatalogTile
      entry={entry}
      key={entry.slug}
      mine={mineOf(entry)}
      onOpen={onOpenApp}
    />
  );
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
        onOpen={onOpenApp}
      />
    );
  };

  // The whole directory, unsearched, built apart from the search's results:
  // it reads only what the hooks answered, so the React Compiler keeps it,
  // and its tiles, until one of those changes.
  const directory = (
    <>
      {ais.length > 0 ? (
        <PageSection title="AI">
          <div className={THREE_COLUMNS}>{ais.map(tileFor)}</div>
        </PageSection>
      ) : null}
      {popular.length > 0 ? (
        <PageSection title="Popular">
          <div className={TWO_COLUMNS}>{popular.map(tileFor)}</div>
        </PageSection>
      ) : null}
      {isRestDue
        ? categories.map(({ id, label }) => (
            <div data-category={id} key={id}>
              <PageSection title={categoryLabel(id, label)}>
                <div className={THREE_COLUMNS}>
                  {rest.filter((entry) => entry.category === id).map(tileFor)}
                </div>
              </PageSection>
            </div>
          ))
        : null}
    </>
  );

  const pageRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const hasChips = typed === "" && categories.length > 0;
  // The head has reached the top and the page scrolls beneath it.
  const [isStuck, setIsStuck] = useState(false);
  // The chips in the page have scrolled under the head, so the head shows
  // them as one row of its own.
  const [isChipRowShown, setIsChipRowShown] = useState(false);
  const sectionOf = (id: AppCategory) =>
    pageRef.current?.querySelector<HTMLElement>(`[data-category="${id}"]`);
  // The category whose section is under the head, which its chip says.
  const [lit, setLit] = useState<AppCategory>();
  const followScroll = () => {
    const page = pageRef.current;
    const head = headRef.current;
    if (!page || !head) {
      return;
    }
    const { bottom: headBottom, top: headTop } = head.getBoundingClientRect();
    setIsStuck(
      page.scrollTop > 0 && headTop <= page.getBoundingClientRect().top + 1,
    );
    const chipsBottom = chipsRef.current?.getBoundingClientRect().bottom;
    const isRowShown = chipsBottom !== undefined && chipsBottom <= headBottom;
    setIsChipRowShown(isRowShown);
    const line =
      headBottom + (isRowShown ? CHIP_ROW_HEIGHT : 0) + SECTION_GAP * 2;
    const passed = categories.filter(({ id }) => {
      const top = sectionOf(id)?.getBoundingClientRect().top;
      return top !== undefined && top <= line;
    });
    setLit(passed.at(-1)?.id);
  };
  const goTo = (id: AppCategory) => {
    const page = pageRef.current;
    const head = headRef.current;
    const section = sectionOf(id);
    if (page && head && section) {
      // Landed at once: a smooth scroll past a hundred tiles is a long blur.
      page.scrollTop +=
        section.getBoundingClientRect().top -
        page.getBoundingClientRect().top -
        head.offsetHeight -
        CHIP_ROW_HEIGHT -
        SECTION_GAP;
    }
  };

  const chip = (
    { id, label }: { id: AppCategory; label: string },
    inHeadRow = false,
  ) => (
    <button
      aria-pressed={lit === id}
      className={cn(
        "h-7 shrink-0 rounded-full px-2.5 text-[12px]",
        lit === id ? "bg-foreground/10" : "bg-card shadow-xs hover:bg-accent",
      )}
      key={id}
      onClick={() => {
        goTo(id);
      }}
      // The row under the stuck head scrolls its lit chip into view.
      ref={
        inHeadRow && lit === id
          ? (button: HTMLButtonElement | null) => {
              button?.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
          : undefined
      }
      type="button"
    >
      {categoryLabel(id, label)}
    </button>
  );

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
      className="@container/apps h-full min-h-0 overflow-y-auto outline-none"
      data-find-surface
      // The page itself takes the keyboard as the screen comes up, so the
      // arrow keys scroll it and no app looks chosen.
      data-keyboard-home
      onScroll={followScroll}
      ref={pageRef}
      tabIndex={-1}
    >
      {/* A centered column and head with room around it. */}
      <div className="mx-auto w-full max-w-5xl px-10 pt-12 pb-20">
        <header className="max-w-xl">
          <h1 className="font-serif text-3xl leading-tight font-normal tracking-tight text-brand-600 dark:text-brand-300">
            Apps
          </h1>
          {listData !== undefined && own.length === 0 ? (
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              Connect the apps you use, and Instrument can work in them for you.
            </p>
          ) : null}
        </header>

        {/* Stays at the top as the page scrolls, over the page's own surface. */}
        <div
          className="sticky top-0 z-10 -mx-3 mt-3 bg-background px-3 pt-4 pb-3"
          ref={headRef}
        >
          <form
            className="group/search group/field relative"
            onSubmit={(event) => {
              event.preventDefault();
              if (typed !== "" && !isFound) {
                connectTyped();
              }
            }}
          >
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground group-focus-within/search:text-foreground" />
            {/* The cards' surface and edge, a size up since it leads the
                page, with the brand's green as its focus. */}
            <input
              aria-label="Search apps"
              ref={searchRef}
              className="h-11 w-full rounded-xl border-0 bg-card pr-24 pl-11 text-[15px] shadow-xs transition-shadow outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-brand-500/30 dark:bg-input/30"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder={
                more.length > 0 ? `Search ${more.length} apps` : "Search apps"
              }
              value={query}
            />
            {query === "" ? <FieldKeys className="right-4" /> : null}
          </form>
          {/* Laid over the page below the head, so showing it moves
              nothing: the chips as one row once the page's own have scrolled
              away, then a fade the page scrolls under. */}
          {isStuck ? (
            <div className="pointer-events-none absolute inset-x-0 top-full">
              {hasChips && isChipRowShown ? (
                <div className="pointer-events-auto animate-in bg-background pb-3 duration-150 fade-in-0">
                  <div className="flex gap-1.5 overflow-x-auto mask-x-from-[calc(100%-0.75rem)] px-3 [scrollbar-width:none]">
                    {categories.map((category) => chip(category, true))}
                  </div>
                </div>
              ) : null}
              <div className="h-4 bg-linear-to-b from-background" />
            </div>
          ) : null}
        </div>

        {hasChips ? (
          <div className="flex flex-wrap gap-1.5 pb-1" ref={chipsRef}>
            {categories.map((category) => chip(category))}
          </div>
        ) : null}

        <div className="mt-4 space-y-10">
          {typed !== "" ? null : listData === undefined ? (
            <PageSection title="Your apps">
              <TileSkeletons columns={3} count={3} />
            </PageSection>
          ) : own.length > 0 ? (
            <PageSection title="Your apps">
              <div className={THREE_COLUMNS}>
                {ownTiles(own).map(({ app, count }) => (
                  <OwnTile
                    app={app}
                    count={count}
                    key={app.slug}
                    onOpen={() => {
                      onOpenApp(app.slug);
                    }}
                  />
                ))}
              </div>
            </PageSection>
          ) : null}
          {catalogData === undefined ? (
            <TileSkeletons />
          ) : typed === "" ? (
            directory
          ) : (
            <div className="space-y-6">
              {isFound ? (
                <div className={TWO_COLUMNS}>
                  {matchedOwn.map((app) => (
                    <OwnTile
                      app={app}
                      count={1}
                      key={app.slug}
                      onOpen={() => {
                        onOpenApp(app.slug);
                      }}
                    />
                  ))}
                  {matches.map(searchTileFor)}
                </div>
              ) : null}
              {asksMeaning && !(answered && meant.length === 0) ? (
                answered ? (
                  <div
                    className={cn(
                      TWO_COLUMNS,
                      "animate-in duration-200 fade-in-0",
                    )}
                  >
                    {meant.map(searchTileFor)}
                  </div>
                ) : (
                  <TileSkeletons count={RELATED_SKELETONS} />
                )
              ) : // A service the words name exactly, listed or already
              // yours, is the one meant, so the way to ask for one that isn't
              // listed would only offer it a second time.
              namesOne(matches, typed) || namesOne(own, typed) ? null : (
                <div className={TWO_COLUMNS}>
                  <UnlistedTile name={typed} onConnect={connectTyped} />
                </div>
              )}
              {meant.length > 0 ? (
                <div className={TWO_COLUMNS}>
                  <UnlistedTile name={typed} onConnect={connectTyped} />
                </div>
              ) : null}
            </div>
          )}
        </div>

        {listData && listData.invalid.length > 0 ? (
          <div className="mt-10">
            <PageSection title="Broken">
              <div className="divide-y divide-border rounded-xl bg-card shadow-xs">
                {listData.invalid.map((entry) => (
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
                    <Button
                      className="text-foreground"
                      onClick={() => {
                        ask(
                          `Fix the ${entry.slug} app; its manifest is broken`,
                          { from },
                        );
                      }}
                      size="sm"
                      variant="outline"
                    >
                      Fix with Instrument
                    </Button>
                  </div>
                ))}
              </div>
            </PageSection>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** No apps, one array for every service with none. */
const NO_APPS: App[] = [];

/**
 * The workspace's apps and the directory, laid out as the page shows them
 * unsearched. A hook's answer is fixed for the page that reads it, so the
 * React Compiler keeps the page's hundred tiles across its renders. Worked
 * out in the page, among the hooks that follow, the compiler keeps none of it.
 */
function useDirectory() {
  // The data alone: a query's own result is a new object on every render.
  const list = useQuery(
    rpcClient.apps.live.list.experimental_liveOptions(),
  ).data;
  const catalog = useQuery(
    rpcClient.apps.live.catalog.experimental_liveOptions(),
  ).data;
  const apps = list?.apps ?? NO_APPS;
  // Connected first, since theirs are the fronts worth opening; the ones
  // still being set up follow, each saying what it waits for.
  const own = [
    ...apps.filter((app) => app.status === "connected"),
    ...apps.filter((app) => app.status !== "connected"),
  ];
  // An app of the workspace's is this service when the directory says it
  // is, whatever its slug, so a second account set up beside the first
  // (gmail-2 beside gmail) is the same service.
  const byService = new Map<string, App[]>();
  for (const app of own) {
    if (app.service !== undefined) {
      byService.set(app.service, [...(byService.get(app.service) ?? []), app]);
    }
  }
  const mineOf = (entry: CatalogEntry) => byService.get(entry.slug) ?? NO_APPS;
  // Every service the directory lists stays in its place, the ones already
  // here included, so a search finds an app whoever forgot it was set up;
  // most used first, and the documentation servers and the like left out
  // until a search names one.
  const listed = catalog ?? NO_ENTRIES;
  const more = directoryByUse(listed);
  // Unsearched, the AIs not yet here lead, then the featured services as
  // Popular, and
  // every other one follows under its category, so the whole directory is a scroll away.
  const ais = more
    .filter(
      (entry) =>
        entry.tier === "featured" &&
        entry.category === "ai" &&
        mineOf(entry).length === 0,
    )
    .toSorted((a, b) => aiOrder(a.slug) - aiOrder(b.slug));
  const popular = more.filter(
    (entry) =>
      entry.tier === "featured" &&
      entry.category !== "ai" &&
      mineOf(entry).length === 0,
  );
  const rest = more.filter((entry) => entry.tier !== "featured");
  const categories = APP_CATEGORIES.filter(({ id }) =>
    rest.some((entry) => entry.category === id),
  );
  return {
    ais,
    catalog,
    categories,
    list,
    listed,
    mineOf,
    more,
    own,
    popular,
    rest,
  };
}

/** No directory entries, one array while the directory is on its way. */
const NO_ENTRIES: CatalogEntry[] = [];

/** The workspace's own apps matching every word typed, by name, slug, site or account. */
function searchOwn(own: App[], typed: string): App[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  return own.filter((app) => {
    const haystack = [app.name, app.slug, app.site, app.account]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** One tile per service of the workspace's own, on its first account, with how many it has. */
function ownTiles(own: App[]) {
  const tiles: { app: App; count: number }[] = [];
  for (const app of own) {
    const tile = tiles.find(
      (each) => app.service !== undefined && each.app.service === app.service,
    );
    if (tile) {
      tile.count += 1;
    } else {
      tiles.push({ app, count: 1 });
    }
  }
  return tiles;
}

/**
 * One of the workspace's apps: its icon, its name and where it stands.
 * Pressing it opens the app, and a right click raises the app's own menu.
 */
function OwnTile({
  app,
  count,
  onOpen,
}: {
  app: App;
  /** How many accounts of the service are here. */
  count: number;
  onOpen: () => void;
}) {
  const { destinations } = useOpenGestures({
    href: `/apps/${app.slug}`,
    kind: "screen",
  });
  return (
    <AppContextMenu app={app} name={app.name} opens={destinations}>
      <Tile
        icon={app.icon}
        line={
          count > 1
            ? `${count} accounts`
            : app.status === "connected"
              ? signedInLine(app)
              : waitingLine(app)
        }
        name={app.name}
        onOpen={onOpen}
        site={app.site}
        target={app.slug}
      />
    </AppContextMenu>
  );
}

function signedInLine(app: Pick<App, "type"> & { authKind?: string }) {
  return app.type === "web" || app.authKind === "oauth"
    ? "Signed in"
    : "Connected";
}

/**
 * A service the directory knows: its icon, its name and tagline. It opens
 * the service's page, which is where it is connected; one already here says
 * where it stands instead.
 */
export function CatalogTile({
  entry,
  mine,
  onOpen,
}: {
  entry: CatalogEntry;
  /** The workspace's own apps that are this service, connected first, when it has any. */
  mine: (Pick<App, "slug" | "status" | "type"> & { authKind?: string })[];
  onOpen: (slug: string) => void;
}) {
  const app = mine[0];
  const target = app?.slug ?? entry.slug;
  return (
    <Tile
      icon={entry.icon}
      line={
        app === undefined
          ? entry.tagline
          : mine.length > 1
            ? `${mine.length} accounts`
            : app.status === "connected"
              ? signedInLine(app)
              : waitingLine(app)
      }
      name={entry.name}
      onOpen={() => {
        onOpen(target);
      }}
      site={`https://${entry.domain}`}
      target={target}
    />
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
            app.status === "connected"
              ? (app.account ?? signedInLine(app))
              : waitingLine(app)
          }
          name={app.name}
          onOpen={() => {
            onOpen(app.slug);
          }}
          site={app.site ?? `https://${entry.domain}`}
          target={app.slug}
        />
      ))}
      <Tile
        icon={entry.icon}
        key={`${entry.slug}:another`}
        line="Add another account"
        name={entry.name}
        onOpen={onConnectAnother}
        site={`https://${entry.domain}`}
      />
    </>
  );
}

/**
 * The card every directory tile is: the service's icon, a name and a line
 * under it. Pressing it opens `target`'s page, or does `onOpen` where there
 * is no page to open. Dragged, it is a link to that page, as an app's row
 * in the Apps menu is (`pressShortcut`).
 */
function Tile({
  icon,
  line,
  name,
  onContextMenu,
  onOpen,
  site,
  target,
  ...rest
}: {
  icon: string | undefined;
  line: string;
  name: string;
  onOpen: () => void;
  site: string | undefined;
  /** The app whose page the tile opens, when it opens one. */
  target?: string;
} & Omit<ComponentProps<"button">, "name">) {
  const { onContextMenu: openMenu, opening } = useOpenGestures({
    href: `/apps/${target ?? ""}`,
    kind: "screen",
  });
  return (
    // A card, the shadow's hairline as its edge, lifting under the pointer.
    <button
      className="flex h-18 w-full min-w-0 items-center gap-3 rounded-2xl bg-card px-4 text-left shadow-xs transition-shadow duration-200 hover:shadow-md"
      {...rest}
      {...(target === undefined ? { onClick: onOpen } : opening(onOpen))}
      onContextMenu={
        onContextMenu ?? (target === undefined ? undefined : openMenu)
      }
      onPointerDown={(event) => {
        if (target !== undefined) {
          pressShortcut(event, { href: `/apps/${target}`, title: name });
        }
      }}
      type="button"
    >
      {/* No inset: the mark fills its box, and the tile is its surface. */}
      <AppIcon
        className="size-9 rounded-lg p-0"
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
  );
}

/** Tiles holding the directory's place, or the related services', while they are still on their way. */
function TileSkeletons({
  columns = 2,
  count = SKELETONS_SHOWN,
}: {
  columns?: 2 | 3;
  count?: number;
}) {
  return (
    <div className={columns === 3 ? THREE_COLUMNS : TWO_COLUMNS}>
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

/** A service the directory does not list, as a tile that asks Instrument for it in a chat. */
function UnlistedTile({
  name,
  onConnect,
}: {
  name: string;
  onConnect: () => void;
}) {
  return (
    <button
      className="flex min-h-18 w-full items-center gap-3 rounded-2xl bg-card px-5 py-3 text-left shadow-xs transition-shadow duration-200 hover:shadow-md @xl/apps:col-span-2"
      onClick={onConnect}
      type="button"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <PlusIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-snug font-medium">
          Connect {name}
        </span>
        <span className="block text-[13px] leading-snug text-muted-foreground">
          It isn’t listed here, but Instrument can try to set it up with you.
        </span>
      </span>
    </button>
  );
}

/** What an app not yet connected is waiting for, in a few words under its name. */
export function waitingLine(
  app: Pick<App, "status"> & { connection?: { error?: string | undefined } },
): string {
  switch (app.status) {
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
      return app.connection?.error ? "Sign in again" : "Needs a sign-in";
    }
    case "stale": {
      return "Changed since tested";
    }
    default: {
      return "Not tested yet";
    }
  }
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
