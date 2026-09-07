import {
  orchestratorRecentsAtom,
  pinsAtom,
  selectedChannelAtom,
  visitedPagesAtom,
} from "@/client/atoms/orchestrator";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { computerName } from "@/client/components/orchestrator/computer-name";
import {
  ComputerPage,
  RECENTS_ROOT,
} from "@/client/components/orchestrator/computer-page";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useOpenFileTab } from "@/client/components/orchestrator/file-tabs";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { RecentIcon, SiteIcon } from "@/client/components/orchestrator/sidebar";
import { ScreenIcon } from "@/client/components/orchestrator/window-tab-strip";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { siteFromWords } from "@/client/lib/site-from-words";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import uFuzzy from "@leeoniya/ufuzzy";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { CornersInIcon } from "@phosphor-icons/react/CornersIn";
import { CornersOutIcon } from "@phosphor-icons/react/CornersOut";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import ms from "ms";
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * A new tab: the apps this workspace reaches, then one box that reaches every
 * screen, every app and any site and, failing those, asks Instrument; under it
 * the places the user kept and the computer in a box. Whatever is picked, this
 * tab becomes it.
 */
export const Route = createFileRoute("/orchestrator/home")({
  component: HomeRoute,
});

const SCREENS: {
  icon: ComponentType<{ className?: string }>;
  name: string;
  open: (navigate: ReturnType<typeof useNavigate>) => void;
}[] = [
  {
    icon: LaptopIcon,
    name: computerName(),
    open: (navigate) =>
      void navigate({
        search: { path: "", root: "~" },
        to: "/orchestrator/computer",
      }),
  },
  {
    icon: InstrumentGlyph,
    name: "Tasks",
    open: (navigate) => void navigate({ to: "/orchestrator/tasks" }),
  },
  {
    icon: AppWindowIcon,
    name: "Apps",
    open: (navigate) => void navigate({ to: "/orchestrator/apps" }),
  },
];

/**
 * How many apps and how many bookmarks the page shows before the rest are
 * behind the tile at the end of the row. Both rows are one line and never two:
 * the computer below them should stay in view in a small window, and a row
 * that wraps is the one thing on this page that can grow without being asked.
 */
const APPS_SHOWN = 8;
const PINS_SHOWN = 6;

const RECENTS_SHOWN = 6;
const TASKS_SHOWN = 5;
const SCREENS_SHOWN = 4;

/**
 * How often the Finder in the box re-reads what it is showing. Slower than the
 * screen's own clock: this page can sit open all day beside the work, and what
 * it shows is a glance rather than a folder being worked in.
 */
const FINDER_REFRESH_MS = ms("30 seconds");

const fuzzy = new uFuzzy({ intraMode: 1 });

interface OmniRow {
  group: string;
  icon: ReactNode;
  name: string;
  note: string;
  run: () => void;
}

function HomeRoute() {
  const { ask, openPage, openScreen, taskId } = useOrchestrator();
  useOnScreen({ screen: "home" });
  const navigate = useNavigate();
  const router = useRouter();
  const openFileTab = useOpenFileTab();
  const recents = useAtomValue(orchestratorRecentsAtom);
  const selectedChannel = useAtomValue(selectedChannelAtom);
  const pins = useAtomValue(pinsAtom);
  const visited = useAtomValue(visitedPagesAtom);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const words = query.trim().toLowerCase();
  // The folder the Finder in the box has open. Held here rather than in the
  // address, so walking the folders leaves this tab a new tab. It opens on
  // what was touched last, which is what a tab opened to find something is
  // most often opened to find.
  const [finderAt, setFinderAt] = useState({ path: "", root: RECENTS_ROOT });
  const [isFinderOpen, setFinderOpen] = useState(false);
  // Whether the box's size is the user's to keep: it grows the first time
  // they do something in it, and from then on stays whatever they leave it.
  const finderTouched = useRef(false);
  const growFinder = () => {
    if (finderTouched.current) {
      return;
    }
    finderTouched.current = true;
    setFinderOpen(true);
  };
  const omnibox = useRef<HTMLInputElement>(null);
  // A new tab the user opened should be ready to type in, but this page also
  // appears when a channel with no tabs is switched to, and there the caret
  // belongs in that channel's composer. So the box takes the keyboard as the
  // page arrives and only while nothing else is holding it; from then on
  // whatever the user gives it to, the Finder included, keeps it.
  useEffect(() => {
    if (!isTypingTarget(document.activeElement)) {
      omnibox.current?.focus();
    }
  }, []);

  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: taskId },
    }),
  );
  const channels = useQuery(
    rpcClient.workspace.orchestrator.channels.list.queryOptions({
      input: { id: taskId },
    }),
  );
  // Work spans every channel, so the way into it belongs in the one channel
  // that is about the app itself rather than repeated at the foot of every
  // new tab, where it sat beside the user's own things and read as one.
  const isHomeChannel =
    channels.data?.[0]?.id !== undefined &&
    channels.data[0].id === selectedChannel;
  const appList = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
  const appsBySlug = new Map(
    (appList.data?.apps ?? []).map((app) => [
      app.slug,
      { name: app.name, site: app.site },
    ]),
  );
  // The matcher the model picker uses: typed letters in order, close
  // together, so "lsbn" finds lisbon.md and "pel news" the pelican task.
  const matches = (name: string) =>
    !words || (fuzzy.filter([name], query.trim())?.length ?? 0) > 0;
  const typedSite = siteFromWords(query.trim());

  const screens = SCREENS.filter((screen) => matches(screen.name)).slice(
    0,
    words ? SCREENS_SHOWN : SCREENS.length,
  );
  // The apps this workspace has, each opening its page; then what the
  // directory knows, each a request to connect it.
  const known = new Set((appList.data?.apps ?? []).map((app) => app.slug));
  const apps = [
    ...(appList.data?.apps ?? []).map((app) => ({
      name: app.name,
      note: app.standing === "connected" ? "App" : "Setting up",
      run: () => {
        void navigate({
          params: { slug: app.slug },
          to: "/orchestrator/apps/$slug",
        });
      },
      site: app.site,
    })),
    ...(catalog.data ?? [])
      .filter((entry) => !known.has(entry.slug))
      .map((entry) => ({
        name: entry.name,
        note: "Connect",
        run: () => {
          ask(`Connect ${entry.name}`);
          setQuery("");
        },
        site: `https://${entry.domain}`,
      })),
  ].filter((app) => matches(app.name));
  // A task's id is made from its brief, so words in the brief find it too.
  const tasks = (children.data ?? [])
    .filter(
      (child) => matches(child.title) || matches(child.id.replaceAll("-", " ")),
    )
    .slice(0, words ? TASKS_SHOWN : 0);
  const openSite = (url: string) => {
    openPage(url);
  };
  // Where the window has been: the screens it landed on and the pages the
  // browser showed, newest first, as one list.
  const wasAt = [
    ...recents.map((entry) => ({
      at: entry.at,
      hint: entry.title,
      icon: <RecentIcon recent={entry} />,
      note: { browser: "Page", file: "File", folder: "Folder", task: "Task" }[
        entry.kind
      ],
      run: () => {
        router.history.push(entry.href);
      },
      title: entry.title,
    })),
    ...visited.map((page) => ({
      at: page.at,
      hint: page.url,
      icon: <SiteIcon favicon={page.favicon} url={page.url} />,
      note: "Page",
      run: () => {
        openSite(page.url);
      },
      title: page.title || page.url,
    })),
  ].sort((a, b) => b.at - a.at);
  const recentRows = wasAt
    .filter((entry) => matches(entry.title))
    .slice(0, words ? RECENTS_SHOWN : 0);
  const rows: OmniRow[] = [
    ...(typedSite
      ? [
          {
            group: "Site",
            icon: <GlobeIcon className="size-4" />,
            name: `Open ${typedSite.host}`,
            note: "Site",
            run: () => {
              openSite(typedSite.url);
            },
          },
        ]
      : []),
    // What the words can be used with, first: searching the web and asking
    // the conversation are what typed words most often mean, and the rows
    // that matched them follow.
    ...(words
      ? [
          {
            group: `Use “${query.trim()}” with`,
            icon: <MagnifyingGlassIcon className="size-4" />,
            name: "Search the web",
            note: "Browser",
            run: () => {
              openSite(
                `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`,
              );
              setQuery("");
            },
          },
          {
            group: `Use “${query.trim()}” with`,
            icon: <InstrumentGlyph className="size-4" />,
            name: "Ask Instrument",
            note: "Agent",
            run: () => {
              ask(query.trim());
              setQuery("");
            },
          },
        ]
      : []),
    ...screens.map((screen) => ({
      group: "Screens",
      icon: <screen.icon className="size-4" />,
      name: screen.name,
      note: "Screen",
      run: () => {
        screen.open(navigate);
      },
    })),
    ...tasks.map((child) => ({
      group: "Tasks",
      icon: <InstrumentGlyph className="size-4" />,
      name: child.title,
      note: "Task",
      run: () => {
        void navigate({
          params: { id: child.id },
          to: "/orchestrator/tasks/$id",
        });
      },
    })),
    ...recentRows.map((entry) => ({
      group: "Recent",
      icon: entry.icon,
      name: entry.title,
      note: entry.note,
      run: entry.run,
    })),
    ...apps.map((app) => ({
      group: "Apps",
      icon: <AppIcon site={app.site} size="sm" />,
      name: app.name,
      note: app.note,
      run: app.run,
    })),
  ];
  const current = Math.min(highlight, Math.max(0, rows.length - 1));

  return (
    <div className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-8 pt-6 pb-8">
      <div className="relative w-full max-w-xl">
        <div className="flex h-11 items-center gap-2 rounded-full border border-border bg-card px-4 shadow-sm focus-within:border-foreground/30">
          <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            aria-label="Search or ask"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              switch (event.key) {
                case "ArrowDown": {
                  event.preventDefault();
                  setHighlight((value) => Math.min(rows.length - 1, value + 1));

                  break;
                }
                case "ArrowUp": {
                  event.preventDefault();
                  setHighlight((value) => Math.max(0, value - 1));

                  break;
                }
                case "Enter": {
                  event.preventDefault();
                  rows[current]?.run();

                  break;
                }
                case "Escape": {
                  setQuery("");

                  break;
                }
                // No default
              }
            }}
            placeholder="Search, open, or ask Instrument"
            ref={omnibox}
            spellCheck={false}
            type="text"
            value={query}
          />
        </div>
        {words ? (
          <div className="absolute inset-x-0 top-full z-10 mt-2 max-h-[calc(60vh/var(--app-zoom))] overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
            {rows.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Nothing by that name.
              </p>
            ) : (
              rows.map((row, index) => (
                <div key={`${row.group}:${row.name}`}>
                  {index === 0 || rows[index - 1]?.group !== row.group ? (
                    <p className="px-4 pt-3 pb-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                      {row.group}
                    </p>
                  ) : null}
                  <button
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-left text-sm",
                      index === current ? "bg-accent" : "hover:bg-accent/50",
                    )}
                    onClick={row.run}
                    onMouseEnter={() => {
                      setHighlight(index);
                    }}
                    // The arrows move the highlight past the list's fold; the
                    // list follows, so the row picked is the row seen.
                    ref={(element) => {
                      if (index === current) {
                        element?.scrollIntoView({ block: "nearest" });
                      }
                    }}
                    type="button"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                      {row.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.note}
                    </span>
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* The services the workspace reaches, under the box: marks with names,
          small enough that the row reads as a strip of faces rather than as
          cards. One line and never two, since a page that grows a row per
          handful of apps pushes the computer under the fold; the rest are
          behind the tile at the end, which is also where a new one is added.
          An app still being connected is drawn faint, since it is not yet a
          way in to anything. */}
      <section className="mt-5 w-full max-w-3xl">
        <div className="flex flex-nowrap justify-center gap-1">
          {(appList.data?.apps ?? []).slice(0, APPS_SHOWN).map((app) => (
            <button
              className="flex w-20 shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 hover:bg-accent/40"
              key={app.slug}
              onClick={() => {
                void navigate({
                  params: { slug: app.slug },
                  to: "/orchestrator/apps/$slug",
                });
              }}
              type="button"
            >
              <AppIcon
                className={
                  app.standing === "connected" ? undefined : "opacity-50"
                }
                site={app.site}
              />
              <span className="w-full truncate text-center text-xs">
                {app.name}
              </span>
            </button>
          ))}
          <button
            className="flex w-20 shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 hover:bg-accent/40"
            onClick={() => {
              void navigate({ to: "/orchestrator/apps" });
            }}
            type="button"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-dashed border-border text-muted-foreground">
              <PlusIcon className="size-4" />
            </span>
            <span className="w-full truncate text-center text-xs">
              All apps
            </span>
          </button>
        </div>
      </section>

      {/* The places the user kept, which is what a bookmark is: their own
          choice, before anything the app has to offer. What the row is comes
          after the row itself, small and under it, since the names the user
          chose are the thing and the word for them is only a caption. */}
      <section className="mt-3 w-full max-w-3xl">
        {pins.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            Right-click a tab to pin it here.
          </p>
        ) : (
          <>
            <div className="flex flex-nowrap justify-center gap-1.5">
              {pins.slice(0, PINS_SHOWN).map((pin) => (
                <button
                  className="flex min-w-0 shrink items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-left shadow-sm hover:bg-accent/30"
                  key={pin.id}
                  onClick={() => {
                    if (pin.kind === "page") {
                      openPage(pin.target);
                    } else {
                      openScreen(pin.target);
                    }
                  }}
                  type="button"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {pin.kind === "page" ? (
                      <SiteIcon favicon={pin.favicon} url={pin.target} />
                    ) : (
                      <ScreenIcon appsBySlug={appsBySlug} href={pin.target} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {pin.title}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
              Bookmarks
            </p>
          </>
        )}
      </section>

      {/* The computer itself, in a window on the page: the Finder whole, with
          its places, its columns and its keyboard, opening folders without
          taking the tab anywhere. It is small enough to glance at until the
          user reaches into it, and then it takes the room a window takes; the
          control in its own bar says the same thing by hand. */}
      <section className="mt-5 w-full max-w-5xl">
        <div
          className={cn(
            // One width, whatever the height: a box that widened under the
            // pointer would move the row being clicked out from under it.
            "flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-md",
            isFinderOpen
              ? "h-[calc(75vh/var(--app-zoom))]"
              : "h-[calc(50vh/var(--app-zoom))]",
          )}
        >
          <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {computerName()}
            </span>
            <button
              aria-label={isFinderOpen ? "Shrink" : "Expand"}
              className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              onClick={() => {
                // Sized by hand is sized for good: the box stops growing on
                // its own once the user has said how big they want it.
                finderTouched.current = true;
                setFinderOpen((open) => !open);
              }}
              type="button"
            >
              {isFinderOpen ? (
                <CornersInIcon className="size-3.5" />
              ) : (
                <CornersOutIcon className="size-3.5" />
              )}
            </button>
          </div>
          {/* Reached into, the box grows, and stays grown for as long as the
              tab lives. The keyboard landing on a row of the listing is not
              that: the browser puts it there itself when a folder opens, and
              every way a person arrives here is a press or lands on a control
              of the browser's own first. */}
          <div
            className="min-h-0 flex-1"
            onFocus={(event) => {
              if (!event.target.closest('[role="option"]')) {
                growFinder();
              }
            }}
            onKeyDown={growFinder}
            onPointerDown={growFinder}
          >
            <ComputerPage
              onLocationChange={setFinderAt}
              onOpenFile={openFileTab}
              path={finderAt.path}
              refreshInterval={FINDER_REFRESH_MS}
              root={finderAt.root}
            />
          </div>
        </div>
      </section>

      {isHomeChannel && (
        <div className="mt-auto w-full max-w-3xl pt-8">
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent/30"
            onClick={() => {
              void navigate({ to: "/orchestrator/tasks" });
            }}
            type="button"
          >
            <InstrumentGlyph className="size-3.5 shrink-0" />
            <span>
              Tasks
              {children.data && children.data.length > 0
                ? ` · ${children.data.length}`
                : ""}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
