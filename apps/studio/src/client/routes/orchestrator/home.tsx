import {
  orchestratorRecentsAtom,
  visitedPagesAtom,
} from "@/client/atoms/orchestrator";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { computerName } from "@/client/components/orchestrator/computer-name";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { RecentIcon, SiteIcon } from "@/client/components/orchestrator/sidebar";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { siteFromWords } from "@/client/lib/site-from-words";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import uFuzzy from "@leeoniya/ufuzzy";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { type ComponentType, type ReactNode, useState } from "react";

/**
 * A new tab: the mark, one box that reaches every screen, every app, and any
 * site and, failing those, asks Instrument; under it the doors that stay
 * (This Mac, the apps, the tasks) and where the user was last. Whatever is
 * picked, this tab becomes it.
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

const RECENTS_SHOWN = 6;
const TASKS_SHOWN = 5;
const SCREENS_SHOWN = 4;

const fuzzy = new uFuzzy({ intraMode: 1 });

interface OmniRow {
  group: string;
  icon: ReactNode;
  name: string;
  note: string;
  run: () => void;
}

function HomeRoute() {
  const { ask, openPage, taskId } = useOrchestrator();
  useOnScreen({ screen: "home" });
  const navigate = useNavigate();
  const router = useRouter();
  const recents = useAtomValue(orchestratorRecentsAtom);
  const visited = useAtomValue(visitedPagesAtom);
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const words = query.trim().toLowerCase();

  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: taskId },
    }),
  );
  const appList = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
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
    // What the words can be used with, whatever else matched: the way a
    // launcher offers its fallbacks under the results rather than as an "or".
    ...(words
      ? [
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
        ]
      : []),
  ];
  const current = Math.min(highlight, Math.max(0, rows.length - 1));

  return (
    <div className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-8 pt-16 pb-10">
      <InstrumentGlyph className="size-9 text-foreground" />
      <div className="relative mt-6 w-full max-w-xl">
        <div className="flex h-11 items-center gap-2 rounded-full border border-border bg-card px-4 shadow-sm focus-within:border-foreground/30">
          <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            aria-label="Search or ask"
            autoFocus
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

      <div className="mt-10 grid w-full max-w-3xl gap-4 sm:grid-cols-2">
        <button
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm hover:bg-accent/30"
          onClick={() => {
            void navigate({
              search: { path: "", root: "~" },
              to: "/orchestrator/computer",
            });
          }}
          type="button"
        >
          <LaptopIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{computerName()}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {places.data?.favorites.map((place) => place.name).join(", ") ??
                "Your folders"}
            </span>
          </span>
        </button>
        <button
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm hover:bg-accent/30"
          onClick={() => {
            void navigate({ to: "/orchestrator/apps" });
          }}
          type="button"
        >
          <AppWindowIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Apps</span>
            <span className="block truncate text-xs text-muted-foreground">
              {(appList.data?.apps ?? []).some(
                (app) => app.standing === "connected",
              )
                ? (appList.data?.apps ?? [])
                    .filter((app) => app.standing === "connected")
                    .map((app) => app.name)
                    .join(", ")
                : "Connect the services you use"}
            </span>
          </span>
        </button>
        <button
          className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-2.5 text-left text-muted-foreground hover:bg-accent/30 sm:col-span-2"
          onClick={() => {
            void navigate({ to: "/orchestrator/tasks" });
          }}
          type="button"
        >
          <InstrumentGlyph className="size-4 shrink-0" />
          <span className="text-sm">
            Tasks
            {children.data && children.data.length > 0
              ? ` · ${children.data.length}`
              : ""}
          </span>
        </button>
      </div>

      {wasAt.length > 0 ? (
        <div className="mt-10 w-full max-w-3xl">
          <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
            Recent
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {wasAt.slice(0, RECENTS_SHOWN).map((entry) => (
              <li key={`${entry.note}:${entry.title}:${entry.at}`}>
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent/50"
                  onClick={entry.run}
                  type="button"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                    {entry.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry.note}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
